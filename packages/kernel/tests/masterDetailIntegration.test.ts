import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

/**
 * Master / detail through the public API.
 *
 * The worker is faked (as in the other integration tests here), which is the
 * point: master/detail is a MAIN-THREAD feature, and what these pin is that
 * expanding a row changes the displayed row count and the row heights without
 * the worker's row count moving at all — plus the `isRowMaster` gate, the
 * event, and that collapsing puts everything back.
 */

beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      postedMessages: any[] = [];
      constructor(public url: URL) {}
      postMessage(msg: any): void { this.postedMessages.push(msg); }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => { this.listeners.push(cb); };
      terminate = vi.fn();
    };
    HTMLCanvasElement.prototype.getContext = (() => {
      const ctx: any = {
        fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(),
        restore: vi.fn(), rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(),
        stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), setTransform: vi.fn(),
        clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
        measureText: () => ({ width: 50 }),
        fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
        lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
        miterLimit: 10, lineDashOffset: 0, shadowOffsetX: 0, shadowBlur: 0,
        shadowOffsetY: 0, shadowColor: '', globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: true, direction: 'inherit', filter: 'none',
      };
      return () => ctx as any;
    })() as any;
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

interface Row { id: string; desk: string; qty: number }

const ROWS: Row[] = [
  { id: 'a', desk: 'FX', qty: 10 },
  { id: 'b', desk: 'Rates', qty: 20 },
  { id: 'c', desk: 'Credit', qty: 30 },
  { id: 'd', desk: 'Equity', qty: 40 },
];

/** Base visible order the fake worker reports — index into ROWS by id. */
const BASE_ORDER = ROWS.map((r) => r.id);

function mount(opts: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'width:900px; height:600px;';
  host.className = 'vg-theme-quartz';
  document.body.appendChild(host);
  const grid = new VelocityGrid<Row>(host, {
    columnDefs: [
      { colId: 'desk', field: 'desk', cellRenderer: 'group' },
      { colId: 'qty', field: 'qty', cellDataType: 'number' },
    ],
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
    rowHeight: 30,
    ...opts,
  } as never);
  const worker = (grid as any).workerClient.worker;
  const reply = (msg: any) => worker.listeners.forEach((cb: any) => cb({ data: msg }));
  reply({ id: 1, type: 'ready' });

  /** Answer every worker request the grid has posted but not had answered.
   *  Only the handful master/detail actually depends on need real payloads;
   *  the rest just have to resolve so nothing hangs. */
  let answered = 0;
  const drain = async (): Promise<void> => {
    for (let pass = 0; pass < 8; pass++) {
      while (answered < worker.postedMessages.length) {
        const msg = worker.postedMessages[answered++];
        if (msg?.id === undefined) continue;
        if (msg.type === 'getRowIndicesForIds') {
          const indices = Int32Array.from(
            (msg.payload.rowIds as string[]).map((id) => BASE_ORDER.indexOf(id)),
          );
          reply({ id: msg.id, type: 'rowIndices', indices });
        } else if (msg.type === 'setRowData') {
          reply({ id: msg.id, type: 'rowCount', count: ROWS.length, visibleCount: ROWS.length });
        } else if (msg.type === 'getViewport') {
          reply({
            id: msg.id,
            type: 'viewport',
            chunk: {
              rowStart: 0, rowCount: 0,
              rowIds: new Uint32Array(0), stringRowIds: [],
              rowKinds: new Uint8Array(0), groupDepth: new Uint8Array(0),
              heights: new Float32Array(0), numericCols: {}, textCols: {},
              groupValue: [], groupChildCount: new Uint32Array(0),
              isExpanded: new Uint8Array(0), groupKey: [],
            },
          });
        } else if (msg.type === 'applyTransaction') {
          reply({
            id: msg.id,
            type: 'transactionResult',
            results: { added: [], updated: [], removed: [] },
          });
        } else {
          reply({ id: msg.id, type: 'ack', visibleCount: ROWS.length, count: ROWS.length });
        }
      }
      // Let the promise chains each reply unblocks post their own follow-ups.
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { grid, host, worker, drain };
}

describe('master / detail — expansion', () => {
  it('adds one displayed row per expanded master, leaving the data alone', async () => {
    const { grid, host, drain } = mount({ masterDetail: true, detailRowHeight: 200 });
    grid.setRowData(ROWS);
    await drain();
    expect(grid.getDisplayedRowCount()).toBe(4);

    grid.setDetailExpanded('b', true);
    await drain();
    expect(grid.isDetailExpanded('b')).toBe(true);
    expect(grid.getExpandedDetailRowIds()).toEqual(['b']);
    // Five DISPLAYED rows; the worker still only knows about four.
    expect(grid.getDisplayedRowCount()).toBe(5);
    expect((grid as any).baseRowCount).toBe(4);

    grid.setDetailExpanded('b', false);
    await drain();
    expect(grid.getDisplayedRowCount()).toBe(4);
    grid.destroy(); host.remove();
  });

  it('sizes the band from detailRowHeight, even outside the fetched window', async () => {
    const { grid, host, drain } = mount({ masterDetail: true, detailRowHeight: 180 });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('a', true);
    await drain();
    // display: 0 = master 'a', 1 = its band, 2.. = the rest.
    const heightAt = (i: number) => (grid as any).rowHeightAt(i) as number;
    expect(heightAt(0)).toBe(30);
    expect(heightAt(1)).toBe(180);
    expect(heightAt(2)).toBe(30);
    // The Fenwick index is seeded from the same source, so the scroll extent
    // is right before any chunk covering the band has arrived — that seed is
    // what stops the thumb jumping as bands scroll into view.
    const seed = (i: number) => (grid as any).rowHeightSeed(i, 30) as number;
    let total = 0;
    for (let i = 0; i < grid.getDisplayedRowCount(); i++) total += seed(i);
    expect(total).toBe(30 * 4 + 180);
    grid.destroy(); host.remove();
  });

  it('lets getRowHeight override a band, the way ag-grid orders it', async () => {
    // AG's `_getRowHeightForNode` consults `getRowHeight` FIRST, for every
    // row including detail bands, and only falls through to
    // `detailRowHeight` when the callback declines. `node.detail` is how the
    // callback tells a band from a row.
    const seen: Array<{ detail: boolean; rowId: string }> = [];
    const { grid, host, drain } = mount({
      masterDetail: true,
      detailRowHeight: 180,
      getRowHeight: (p: any) => {
        if (p.node?.detail) {
          seen.push({ detail: true, rowId: p.rowId });
          // Size this band from the master's own data.
          return p.data.qty * 10;
        }
        return undefined;
      },
    });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('b', true);   // qty 20 → 200px, not the 180 default
    await drain();
    const heightAt = (i: number) => (grid as any).rowHeightAt(i) as number;
    expect(heightAt(2)).toBe(200);
    expect(seen.some((s) => s.detail && s.rowId === 'b')).toBe(true);

    grid.destroy(); host.remove();
  });

  it('falls back to detailRowHeight when getRowHeight declines the band', async () => {
    const { grid, host, drain } = mount({
      masterDetail: true,
      detailRowHeight: 180,
      getRowHeight: () => undefined,
    });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('a', true);
    await drain();
    expect((grid as any).rowHeightAt(1)).toBe(180);
    grid.destroy(); host.remove();
  });

  it('honours isRowMaster', async () => {
    const { grid, host, drain } = mount({
      masterDetail: true,
      isRowMaster: (r: Row) => r.desk !== 'Credit',
    });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('c', true);
    await drain();
    expect(grid.isDetailExpanded('c')).toBe(false);
    expect(grid.getDisplayedRowCount()).toBe(4);
    grid.setDetailExpanded('a', true);
    await drain();
    expect(grid.isDetailExpanded('a')).toBe(true);
    grid.destroy(); host.remove();
  });

  it('opens rows isMasterOpenByDefault asks for, when their data lands', async () => {
    const { grid, host, drain } = mount({
      masterDetail: true,
      isMasterOpenByDefault: ({ data }: { data: Row }) => data.desk === 'Rates',
    });
    grid.setRowData(ROWS);
    await drain();
    expect(grid.getExpandedDetailRowIds()).toEqual(['b']);
    expect(grid.getDisplayedRowCount()).toBe(5);
    grid.destroy(); host.remove();
  });

  it('fires rowGroupOpened carrying the row, not a group key', async () => {
    const { grid, host, drain } = mount({ masterDetail: true });
    const seen: any[] = [];
    grid.addEventListener('rowGroupOpened', (e: any) => seen.push(e));
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('d', true);
    await drain();
    expect(seen).toHaveLength(1);
    expect(seen[0].rowId).toBe('d');
    expect(seen[0].key).toBe('d');
    expect(seen[0].expanded).toBe(true);
    expect(seen[0].source).toBe('api');
    expect((seen[0].data as Row).desk).toBe('Equity');
    grid.destroy(); host.remove();
  });

  it('does nothing at all while masterDetail is off', async () => {
    const { grid, host, drain } = mount({});
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('a', true);
    await drain();
    expect(grid.isDetailExpanded('a')).toBe(false);
    expect(grid.getDisplayedRowCount()).toBe(4);
    // The index stays at the identity, so every mapping seam is a no-op.
    expect((grid as any).detailIndex.isEmpty).toBe(true);
    grid.destroy(); host.remove();
  });

  it('collapses everything when the feature is switched off at runtime', async () => {
    const { grid, host, drain } = mount({ masterDetail: true });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('a', true);
    grid.setDetailExpanded('c', true);
    await drain();
    expect(grid.getDisplayedRowCount()).toBe(6);
    grid.setGridOption('masterDetail', false);
    await drain();
    expect(grid.getExpandedDetailRowIds()).toEqual([]);
    expect(grid.getDisplayedRowCount()).toBe(4);
    grid.destroy(); host.remove();
  });

  it('drops a band when its master is removed', async () => {
    const { grid, host, drain } = mount({ masterDetail: true });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('c', true);
    await drain();
    expect(grid.getDisplayedRowCount()).toBe(5);
    grid.applyTransaction({ remove: [ROWS[2]!] });
    await drain();
    expect(grid.isDetailExpanded('c')).toBe(false);
    grid.destroy(); host.remove();
  });
});

describe('master / detail — cell payload', () => {
  it('wraps the toggle column so the chevron paints beside the value', async () => {
    const { grid, host, drain } = mount({ masterDetail: true });
    grid.setRowData(ROWS);
    await drain();
    grid.setDetailExpanded('a', true);
    await drain();
    // Stand in for a delivered chunk: `cellAt` reads the chunk directly.
    (grid as any).chunk = {
      rowStart: 0,
      rowCount: 2,
      rowIds: Uint32Array.from([1, 0]),
      stringRowIds: ['a', 'a'],
      rowKinds: Uint8Array.from([0, 4]),
      groupDepth: new Uint8Array(2),
      heights: Float32Array.from([30, 300]),
      numericCols: {},
      textCols: {},
    };
    const master = (grid as any).cellAt(0, 'desk');
    expect(master.value).toMatchObject({
      kind: 'group',
      rowKind: 0,
      masterDetail: true,
      isMaster: true,
      masterExpanded: true,
    });
    // A non-toggle column stays a plain value.
    expect(typeof (grid as any).cellAt(0, 'qty').value).not.toBe('object');
    // The band itself has no cells — the DOM grid over it owns that region.
    expect((grid as any).cellAt(1, 'desk')).toEqual({ value: '', valueFormatted: '' });
    grid.destroy(); host.remove();
  });
});
