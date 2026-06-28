import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { INITIAL_ONLY_OPTIONS } from '../src/core/runtimeOptions';

// ---------------------------------------------------------------------------
// Shared happy-dom stubs — mirror cgrid.integration.test.ts so both files can
// run in the same Vitest pass without colliding on globals.
// ---------------------------------------------------------------------------
beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      postedMessages: any[] = [];
      constructor(public url: URL) {}
      postMessage(msg: any): void { this.postedMessages.push(msg); }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => {
        this.listeners.push(cb);
      };
      terminate = vi.fn();
    };
    HTMLCanvasElement.prototype.getContext = (() => {
      const fakeCtx: any = {
        fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
        save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
        beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
        measureText: () => ({ width: 50 }),
        fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
        textAlign: '', lineWidth: 1, globalAlpha: 1,
        lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
        shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
        globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
        direction: 'inherit', filter: 'none',
      };
      return () => fakeCtx as any;
    })() as any;
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

function mountGrid(extra: Record<string, unknown> = {}): {
  grid: CGrid<any>;
  host: HTMLDivElement;
  worker: any;
} {
  const host = document.createElement('div');
  host.style.cssText = 'width:800px; height:600px;';
  host.className = 'cg-theme-quartz';
  document.body.appendChild(host);
  const grid = new CGrid<{ id: string; a: number; b: number }>(host, {
    columnDefs: [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
    ...extra,
  });
  const worker = (grid as any).workerClient.worker;
  // Drain the init handshake so subsequent requests resolve cleanly.
  worker.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid, host, worker };
}

function teardown(grid: CGrid<any>, host: HTMLDivElement): void {
  try { grid.destroy(); } catch { /* swallow */ }
  host.remove();
}

describe('INITIAL_ONLY_OPTIONS', () => {
  it('flags getRowId, columnDefs, and worker as initial-only', () => {
    expect(INITIAL_ONLY_OPTIONS.has('getRowId')).toBe(true);
    expect(INITIAL_ONLY_OPTIONS.has('columnDefs')).toBe(true);
    expect(INITIAL_ONLY_OPTIONS.has('worker')).toBe(true);
  });
  it('does NOT include known runtime options', () => {
    for (const k of [
      'theme', 'rowHeight', 'headerHeight', 'defaultColDef', 'animateRows',
      'rowSelection', 'suppressColumnVirtualisation', 'enableCellChangeFlash',
      'cellFlashDuration', 'cellFadeDuration', 'asyncTransactionWaitMillis',
      'rowBuffer', 'context', 'loading', 'debug',
    ] as const) {
      expect(INITIAL_ONLY_OPTIONS.has(k)).toBe(false);
    }
  });
});

describe('CGrid.setGridOption — initial-only gating', () => {
  it('throws when setting `getRowId` at runtime', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    expect(() => api.setGridOption('getRowId', (r: any) => r.id))
      .toThrow(/initial-only/);
    teardown(grid, host);
  });

  it('throws when setting `worker` at runtime', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    expect(() => api.setGridOption('worker', { url: 'x' }))
      .toThrow(/initial-only/);
    teardown(grid, host);
  });

  it('throws when calling setGridOption(`columnDefs`) — use updateGridOptions', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    expect(() => api.setGridOption('columnDefs', [{ field: 'id' }]))
      .toThrow(/initial-only/);
    teardown(grid, host);
  });
});

describe('CGrid.setGridOption — runtime options apply', () => {
  it('rowHeight propagates to the data subgrid and triggers viewport recompute', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    const before = (grid as any).viewport.contentHeight;
    api.setGridOption('rowHeight', 60);
    expect((grid as any).options.rowHeight).toBe(60);
    const after = (grid as any).viewport.contentHeight;
    expect(after).toBeGreaterThanOrEqual(before);
    teardown(grid, host);
  });

  it('headerHeight is read by the header subgrids at the next viewport tick', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('headerHeight', 48);
    expect((grid as any).options.headerHeight).toBe(48);
    // bodyTop must be at least the new header height (single-row header here).
    expect((grid as any).viewport.bodyTop).toBeGreaterThanOrEqual(48);
    teardown(grid, host);
  });

  it('theme delegates to setTheme (CSS class swap)', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('theme', 'cg-theme-balham');
    const root = (grid as any).root as HTMLDivElement;
    expect(root.classList.contains('cg-theme-balham')).toBe(true);
    expect(root.classList.contains('cg-theme-quartz')).toBe(false);
    teardown(grid, host);
  });

  it('rowSelection updates the SelectionModel mode', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('rowSelection', 'multiple');
    expect((grid as any).selection['mode']).toBe('multiple');
    teardown(grid, host);
  });

  it('suppressCount is runtime-mutable (Cycle 15.5 / Task 7) and stored on options', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    // Must be recognised as a runtime option — no "not a recognised runtime
    // option" throw — and store + flip cleanly.
    expect(() => api.setGridOption('suppressCount', true)).not.toThrow();
    expect((grid as any).options.suppressCount).toBe(true);
    api.setGridOption('suppressCount', false);
    expect((grid as any).options.suppressCount).toBe(false);
    teardown(grid, host);
  });

  it('rowBuffer is stored on options (read site lands in Task 5)', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('rowBuffer', 25);
    expect((grid as any).options.rowBuffer).toBe(25);
    teardown(grid, host);
  });

  it('storage-only flags (animateRows, debug, loading, context) round-trip', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('animateRows', false);
    api.setGridOption('debug', true);
    api.setGridOption('loading', true);
    api.setGridOption('context', { tenant: 'acme' });
    const o = (grid as any).options;
    expect(o.animateRows).toBe(false);
    expect(o.debug).toBe(true);
    expect(o.loading).toBe(true);
    expect(o.context).toEqual({ tenant: 'acme' });
    teardown(grid, host);
  });

  it('flash-related timing options are stored as numbers', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('enableCellChangeFlash', true);
    api.setGridOption('cellFlashDuration', 250);
    api.setGridOption('cellFadeDuration', 750);
    api.setGridOption('asyncTransactionWaitMillis', 100);
    const o = (grid as any).options;
    expect(o.enableCellChangeFlash).toBe(true);
    expect(o.cellFlashDuration).toBe(250);
    expect(o.cellFadeDuration).toBe(750);
    expect(o.asyncTransactionWaitMillis).toBe(100);
    teardown(grid, host);
  });

  it('suppressColumnVirtualisation / suppressRowVirtualisation persist as flags', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.setGridOption('suppressColumnVirtualisation', true);
    api.setGridOption('suppressRowVirtualisation', true);
    const o = (grid as any).options;
    expect(o.suppressColumnVirtualisation).toBe(true);
    expect(o.suppressRowVirtualisation).toBe(true);
    teardown(grid, host);
  });
});

describe('CGrid.updateGridOptions — batched updates', () => {
  it('applies every runtime key in one call', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    api.updateGridOptions({ rowHeight: 36, headerHeight: 40, rowBuffer: 12, debug: true });
    const o = (grid as any).options;
    expect(o.rowHeight).toBe(36);
    expect(o.headerHeight).toBe(40);
    expect(o.rowBuffer).toBe(12);
    expect(o.debug).toBe(true);
    teardown(grid, host);
  });

  it('rejects an initial-only key inside the partial', () => {
    const { grid, host } = mountGrid();
    const api = (grid as any).makeApi();
    expect(() => api.updateGridOptions({ getRowId: (r: any) => r.id, rowHeight: 30 }))
      .toThrow(/initial-only/);
    teardown(grid, host);
  });

  it('columnDefs swap rebuilds the tree and notifies the worker', () => {
    const { grid, host, worker } = mountGrid({
      columnDefs: [
        { field: 'id' },
        { groupId: 'metrics', children: [{ field: 'a' }, { field: 'b' }] },
      ],
      // override per-test
    });
    const api = (grid as any).makeApi();
    // Open the metrics group so we can verify state preservation after swap.
    api.setColumnGroupState([{ groupId: 'metrics', open: true }]);
    worker.postedMessages.length = 0;

    api.updateGridOptions({
      columnDefs: [
        { field: 'id' },
        {
          groupId: 'metrics',
          children: [
            { field: 'a' }, { field: 'b' }, { field: 'c' },
          ],
        },
      ],
    });

    const tree = (grid as any).columnTree;
    expect(tree.leaves.map((l: any) => l.colId)).toEqual(['id', 'a', 'b', 'c']);
    // Group state survives because the groupId still exists.
    const state = api.getColumnGroupState();
    expect(state.find((e: any) => e.groupId === 'metrics').open).toBe(true);
    // Worker got a column-metadata update message.
    const updateMsgs = worker.postedMessages.filter((m: any) => m.type === 'updateColumns');
    expect(updateMsgs.length).toBe(1);
    expect(updateMsgs[0].payload.columns.map((c: any) => c.colId))
      .toEqual(['id', 'a', 'b', 'c']);
    teardown(grid, host);
  });
});

describe('CGrid.getGridOption — readback', () => {
  it('returns the current value, falling back through setGridOption', () => {
    const { grid, host } = mountGrid({ rowHeight: 28 });
    const api = (grid as any).makeApi();
    expect(api.getGridOption('rowHeight')).toBe(28);
    api.setGridOption('rowHeight', 36);
    expect(api.getGridOption('rowHeight')).toBe(36);
    teardown(grid, host);
  });
});
