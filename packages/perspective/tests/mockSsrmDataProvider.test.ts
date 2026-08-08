import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockSSRMDataProvider } from '../src/mockSsrmDataProvider';
import type { AttachableGrid } from '../src/provider';

function makeProvider(overrides: ConstructorParameters<typeof MockSSRMDataProvider>[0] = {}) {
  return new MockSSRMDataProvider({
    rowCount: 200,
    latency: [0, 0],
    enableUpdates: false,
    softRefreshIntervalMs: 0,
    ...overrides,
  });
}

describe('MockSSRMDataProvider', () => {
  it('builds a deterministic book of the requested size', () => {
    const a = makeProvider({ rowCount: 50 });
    const b = makeProvider({ rowCount: 50 });
    expect(a.bookSize).toBe(50);
    expect(b.bookSize).toBe(50);
    // Same seed → identical first row
    let firstA: unknown;
    let firstB: unknown;
    a.getRows({
      request: { startRow: 0, endRow: 1, sortModel: [], filterModel: {} },
      success: (r) => { firstA = r.rowData[0]; },
      fail: () => { throw new Error('fail'); },
    } as any);
    b.getRows({
      request: { startRow: 0, endRow: 1, sortModel: [], filterModel: {} },
      success: (r) => { firstB = r.rowData[0]; },
      fail: () => { throw new Error('fail'); },
    } as any);
    expect(firstA).toEqual(firstB);
    expect((firstA as { positionId: string }).positionId).toBe('POS-000000');
  });

  it('serves getRows with rowCount and grandTotals', () => {
    const p = makeProvider({ rowCount: 100 });
    let result: any;
    p.getRows({
      request: { startRow: 0, endRow: 10, sortModel: [], filterModel: {} },
      success: (r) => { result = r; },
      fail: () => { throw new Error('fail'); },
    } as any);
    expect(result.rowData).toHaveLength(10);
    expect(result.rowCount).toBe(100);
    expect(result.grandTotals).toMatchObject({
      notional: expect.any(Number),
      marketValue: expect.any(Number),
      pnl: expect.any(Number),
      dailyPnl: expect.any(Number),
    });
  });

  it('serves getGroupSkeleton with grand-total root and desk/region paths', () => {
    const p = makeProvider({ rowCount: 100 });
    let groups: any[] = [];
    p.getGroupSkeleton({
      request: {
        rowGroupCols: ['desk', 'region'],
        sortModel: [],
        filterModel: {},
      },
      success: (r) => { groups = r.groups; },
      fail: () => { throw new Error('fail'); },
    } as any);
    expect(groups[0]).toMatchObject({ path: [], leafCount: 100 });
    expect(groups.some((g) => g.path.length === 1)).toBe(true);
    expect(groups.some((g) => g.path.length === 2)).toBe(true);
  });

  it('serves getLeafRows under a group path', () => {
    const p = makeProvider({ rowCount: 100 });
    let skeleton: any[] = [];
    p.getGroupSkeleton({
      request: { rowGroupCols: ['desk'], sortModel: [], filterModel: {} },
      success: (r) => { skeleton = r.groups; },
      fail: () => { throw new Error('fail'); },
    } as any);
    const deskPath = skeleton.find((g) => g.path.length === 1)!;
    let leaves: any;
    p.getLeafRows({
      request: {
        groupPath: deskPath.path,
        rowGroupCols: ['desk'],
        startRow: 0,
        endRow: 50,
        sortModel: [],
        filterModel: {},
      },
      success: (r) => { leaves = r; },
      fail: () => { throw new Error('fail'); },
    } as any);
    expect(leaves.rowData.length).toBeGreaterThan(0);
    expect(leaves.rowData.length).toBeLessThanOrEqual(50);
    expect(leaves.rowData.every((r: any) => r.desk === deskPath.path[0])).toBe(true);
  });

  it('serves getGroupLeafIds', () => {
    const p = makeProvider({ rowCount: 80 });
    let ids: string[] = [];
    p.getGroupLeafIds({
      request: {
        groupPath: [],
        rowGroupCols: ['desk'],
        sortModel: [],
        filterModel: {},
      },
      success: (r) => { ids = r.ids; },
      fail: () => { throw new Error('fail'); },
    } as any);
    expect(ids).toHaveLength(80);
    expect(ids[0]).toMatch(/^POS-/);
  });

  it('applyEdit updates the book and derived marketValue', () => {
    const p = makeProvider({ rowCount: 10 });
    const updated = p.applyEdit('POS-000000', 'price', 200);
    expect(updated).not.toBeNull();
    expect(updated!.price).toBe(200);
    expect(updated!.marketValue).toBe(Math.round(updated!.notional * 2));
  });

  describe('live ticks', () => {
    let tickCbs: Array<() => void>;
    let setTicker: ReturnType<typeof vi.fn>;
    let clearTicker: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      tickCbs = [];
      setTicker = vi.fn((cb: () => void) => {
        tickCbs.push(cb);
        return tickCbs.length;
      });
      clearTicker = vi.fn();
    });

    afterEach(() => {
      tickCbs = [];
    });

    it('enableUpdates: false never starts the ticker on attach', () => {
      const p = makeProvider({
        enableUpdates: false,
        setTicker,
        clearTicker,
      });
      const grid = fakeGrid();
      p.attach(grid);
      expect(setTicker).not.toHaveBeenCalled();
      p.destroy();
    });

    it('attach fires applyServerSideTransaction via injected ticker', () => {
      const p = makeProvider({
        enableUpdates: true,
        updateIntervalMs: 100,
        updatesPerTick: 3,
        softRefreshIntervalMs: 0,
        setTicker,
        clearTicker,
      });
      const grid = fakeGrid();
      p.attach(grid);
      expect(setTicker).toHaveBeenCalled();
      expect(tickCbs.length).toBeGreaterThanOrEqual(1);
      tickCbs[0]!();
      expect(grid.applyServerSideTransaction).toHaveBeenCalled();
      const tx = (grid.applyServerSideTransaction as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(tx.update).toHaveLength(3);
      p.destroy();
      expect(clearTicker).toHaveBeenCalled();
    });

    it('destroy clears the ticker', () => {
      const p = makeProvider({
        enableUpdates: true,
        softRefreshIntervalMs: 0,
        setTicker,
        clearTicker,
      });
      const grid = fakeGrid();
      p.attach(grid);
      p.destroy();
      expect(clearTicker).toHaveBeenCalled();
    });

    it('defers ticks while scrolling and flushes on bodyScrollEnd', () => {
      const p = makeProvider({
        enableUpdates: true,
        updatesPerTick: 2,
        softRefreshIntervalMs: 0,
        setTicker,
        clearTicker,
      });
      const grid = fakeGrid();
      p.attach(grid);
      // Simulate scroll start
      scrollHandlers(grid).bodyScroll();
      tickCbs[0]!();
      expect(grid.applyServerSideTransaction).not.toHaveBeenCalled();
      scrollHandlers(grid).bodyScrollEnd();
      expect(grid.applyServerSideTransaction).toHaveBeenCalled();
      p.destroy();
    });
  });

  it('gridOptions bundles SSRM v2 datasource pointing at itself', () => {
    const p = makeProvider();
    const opts = p.gridOptions();
    expect(opts.rowModelType).toBe('serverSide');
    expect(opts.serverSideDatasource).toBe(p);
    expect(opts.columnDefs?.length).toBeGreaterThan(0);
    expect(opts.getRowId?.({ positionId: 'POS-1' } as any)).toBe('POS-1');
  });
});

function fakeGrid(): AttachableGrid & {
  applyServerSideTransaction: ReturnType<typeof vi.fn>;
  refreshServerSide: ReturnType<typeof vi.fn>;
  _handlers: Map<string, Array<(e: unknown) => void>>;
} {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  return {
    applyServerSideTransaction: vi.fn(),
    refreshServerSide: vi.fn(),
    getRowGroupColumns: () => [],
    _handlers: handlers,
    on(type: string, handler: (event: unknown) => void) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const next = (handlers.get(type) ?? []).filter((h) => h !== handler);
        handlers.set(type, next);
      };
    },
  };
}

function scrollHandlers(grid: ReturnType<typeof fakeGrid>) {
  return {
    bodyScroll: () => {
      for (const h of grid._handlers.get('bodyScroll') ?? []) h({});
    },
    bodyScrollEnd: () => {
      for (const h of grid._handlers.get('bodyScrollEnd') ?? []) h({});
    },
  };
}
