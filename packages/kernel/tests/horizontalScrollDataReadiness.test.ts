/**
 * Cycle 26 (W3) — horizontal-scroll data readiness.
 *
 * SYMPTOM: horizontal scrolling visibly painted columns in as they entered
 * the viewport — entering columns rendered BLANK, then filled a scroll
 * throttle period + worker round-trip later. Three coupled causes, locked
 * separately here:
 *
 *   1. The viewport fetch requested EXACTLY the visible columns — rows get
 *      velocity/jump/page buffering (Deephaven ROW_BUFFER_PAGES), columns
 *      got none (COLUMN_BUFFER_PAGES was never ported). Now the fetch
 *      window is visible ∪ one bodyWidth of center columns per side.
 *   2. The scroll throttle's uncovered-viewport bypass checked ROWS only —
 *      scrolling into an unfetched column sat out the 150ms throttle.
 *      Now visible columns outside the last dispatched set bypass it.
 *   3. `cellAt` returned '' for a column absent from the chunk. For plain
 *      data rows the full row lives in the rowDataById mirror — it now
 *      serves field-backed columns through the memoized formatters, so
 *      even a fling that outruns the buffer paints real content.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ViewportManager, type ViewportManagerDeps } from '../src/core/viewportManager';
import { DisposableRegistry } from '../src/core/disposable';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import type { CGridEvent } from '../src/types';
import type { Subgrid } from '../src/core/subgrid';
import type { ColumnLayout } from '../src/core/layout';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types/options';

// ─── ViewportManager harness (columnFetchWindow + throttle bypass) ───────────

function header(height = 32): Subgrid {
  return {
    type: 'header',
    isHeader: true, isData: false, isTotals: false, isFooter: false,
    getRowCount: () => 1, getRowHeight: () => height, getCell: () => null,
  };
}
function data(rowCount = 1000, rowHeight = 30): Subgrid {
  return {
    type: 'data',
    isHeader: false, isData: true, isTotals: false, isFooter: false,
    getRowCount: () => rowCount, getRowHeight: () => rowHeight, getCell: () => null,
  };
}

function makeHarness(opts: {
  columns?: ColumnLayout[];
  containerWidth?: number;
  suppressColumnVirtualisation?: boolean;
} = {}) {
  const root = document.createElement('div');
  const scroller = document.createElement('div');
  const sizer = document.createElement('div');
  root.appendChild(scroller);
  scroller.appendChild(sizer);
  document.body.appendChild(root);
  const cw = opts.containerWidth ?? 300;
  const ch = 200;
  Object.defineProperty(scroller, 'clientWidth', { value: cw, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: ch, configurable: true });
  Object.defineProperty(root, 'clientWidth', { value: cw, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: ch, configurable: true });

  const state = {
    columnLayout: opts.columns ?? (Array.from({ length: 12 }, (_, i) => ({
      colId: `c${i}`, left: i * 100, width: 100,
    })) as ColumnLayout[]),
    subgrids: [header(32), data(1000, 30)],
    canvasBounds: { width: cw, height: ch },
    options: {
      rowHeight: 30,
      suppressColumnVirtualisation: opts.suppressColumnVirtualisation,
    } as Record<string, unknown>,
    rowHeight: 30,
    destroyed: false,
  };
  const events = new TypedEventEmitter<CGridEvent>();
  const dispatch = vi.fn(() => Promise.resolve());
  const deps: ViewportManagerDeps = {
    disposables: new DisposableRegistry(),
    events,
    scroller,
    sizer,
    root,
    getColumnLayout: () => state.columnLayout,
    getSubgrids: () => state.subgrids,
    getCanvasBounds: () => state.canvasBounds,
    getOptions: () => state.options,
    getRowHeightFallback: () => state.rowHeight,
    getRowHeightIndex: () => null,
    afterRecompute: vi.fn(),
    afterScrollTick: vi.fn(),
    isDestroyed: () => state.destroyed,
    dispatchViewportRequest: dispatch,
  };
  const manager = new ViewportManager(deps);
  manager.recompute();
  return { manager, dispatch, state };
}

function dispatchedCols(dispatch: ReturnType<typeof vi.fn>, call = -1): string[] {
  const calls = dispatch.mock.calls;
  const idx = call < 0 ? calls.length + call : call;
  return (calls[idx]![0] as { columns: string[] }).columns;
}

describe('column fetch buffer (Deephaven COLUMN_BUFFER_PAGES)', () => {
  it('the fetch window spans visible columns PLUS one bodyWidth per side', () => {
    // 300px container over 12×100px columns — ~3-4 visible; the buffered
    // window must ALSO cover one page (3 columns) each side.
    const h = makeHarness();
    h.manager.request('rowDataChanged'); // immediate data-affecting dispatch
    const cols = dispatchedCols(h.dispatch);
    // Visible plus the next page to the right (c3..c5 at least).
    expect(cols).toContain('c0');
    expect(cols).toContain('c4');
    expect(cols).toContain('c5');
    // But NOT the far end of the layout — the window is bounded.
    expect(cols).not.toContain('c10');
    expect(cols).not.toContain('c11');
  });

  it('after a horizontal scroll the window re-centers (buffer behind AND ahead)', () => {
    const h = makeHarness();
    h.manager.onScrollerScroll(500, 0); // center window now [500, 800)
    const cols = dispatchedCols(h.dispatch);
    // One page behind covers [200, 500): c2..c4. One page ahead: [800, 1100): c8..c10.
    expect(cols).toContain('c2');
    expect(cols).toContain('c8');
    expect(cols).toContain('c10');
    expect(cols).not.toContain('c0');
    expect(cols).not.toContain('c11');
  });

  it('suppressColumnVirtualisation keeps the all-columns fetch (union safety)', () => {
    const h = makeHarness({ suppressColumnVirtualisation: true });
    h.manager.request('rowDataChanged');
    const cols = dispatchedCols(h.dispatch);
    for (let i = 0; i < 12; i++) expect(cols).toContain(`c${i}`);
  });
});

describe('scroll-throttle bypass covers columns', () => {
  it('scrolling a NOT-yet-fetched column into view dispatches immediately (no 150ms wait)', async () => {
    const h = makeHarness();
    // Prime: a scroll-driven dispatch establishes the throttle window and
    // the dispatched column set around scrollLeft 0.
    h.manager.onScrollerScroll(30, 0);
    const afterPrime = h.dispatch.mock.calls.length;
    expect(afterPrime).toBeGreaterThanOrEqual(1);
    // Jump far right within the throttle period — the columns at 900+ are
    // outside the primed fetch window, so the bypass must fire now (it
    // coalesces behind the still-pending prime dispatch — flush the
    // microtask queue, NOT the 150ms throttle timer, before asserting).
    h.manager.onScrollerScroll(900, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.dispatch.mock.calls.length).toBeGreaterThan(afterPrime);
    const cols = dispatchedCols(h.dispatch);
    expect(cols).toContain('c9');
  });

  it('a small scroll INSIDE the buffered window stays throttled (no extra dispatch)', async () => {
    const h = makeHarness();
    h.manager.onScrollerScroll(30, 0);
    const afterPrime = h.dispatch.mock.calls.length;
    // 60px further — still deep inside the buffered column window AND the
    // row window; the trailing throttle should absorb it. Same microtask
    // flush as above so the comparison is apples-to-apples.
    h.manager.onScrollerScroll(90, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.dispatch.mock.calls.length).toBe(afterPrime);
  });
});

// ─── cellAt mirror fallback (wired CGrid) ────────────────────────────────────

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
  (globalThis as any).requestAnimationFrame = (() => { let id = 0; return () => ++id; })();
  (globalThis as any).cancelAnimationFrame = () => {};
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) { ctx = { ...fakeCtx, canvas: this }; perCanvas.set(this, ctx); }
      return ctx;
    };
  })() as any;
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('cellAt — mirror fallback for columns missing from the chunk', () => {
  function buildWiredGrid() {
    const container = document.createElement('div');
    container.style.cssText = 'width:400px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const prevWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      host = createWorkerHost((msg) => {
        queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
      });
      constructor(public url: URL) {}
      postMessage(msg: any) { this.host.handle(msg); }
      addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
      terminate() {}
    };
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`, a: `A${i}`, far: 1000 + i, gettered: i,
    }));
    const grid = new CGrid(container, {
      columnDefs: [
        { field: 'id' },
        { field: 'a' },
        {
          field: 'far', type: 'number',
          valueFormatter: ({ value }: { value: number }) => `#${value}`,
        },
        { colId: 'g', field: 'gettered', valueGetter: () => 'computed' },
      ] as CGridOptions<Record<string, unknown>>['columnDefs'],
      getRowId: (r: { id: string }) => r.id,
      rowData: rows,
    } as CGridOptions<Record<string, unknown>>);
    const g = grid as any;
    Object.defineProperty(g.scroller, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(g.scroller, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(g.root, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(g.root, 'clientHeight', { value: 600, configurable: true });
    g.cgridCanvas.resize();
    const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
    return { grid, g, restore };
  }

  /** Strip a column's payload from the live chunk, simulating a column
   *  the fetch hasn't delivered yet. */
  function dropColFromChunk(g: any, colId: string) {
    delete g.chunk.numericCols[colId];
    delete g.chunk.textCols[colId];
    g.decodedTextCols.delete(colId);
  }

  it('serves a field-backed NUMBER column from the mirror, formatted', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await tick();
    expect(g.cellAt(3, 'far')?.valueFormatted).toBe('#1003'); // sanity: from chunk
    dropColFromChunk(g, 'far');
    const cell = g.cellAt(3, 'far');
    expect(cell?.value).toBe(1003);
    expect(cell?.valueFormatted).toBe('#1003'); // memoized formatter applies
    grid.destroy();
    restore();
  });

  it('serves a field-backed TEXT column from the mirror', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await tick();
    dropColFromChunk(g, 'a');
    expect(g.cellAt(7, 'a')?.value).toBe('A7');
    grid.destroy();
    restore();
  });

  it('valueGetter columns stay blank (worker-computed — never guessed from the mirror)', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await tick();
    dropColFromChunk(g, 'g');
    expect(g.cellAt(2, 'g')?.value).toBe('');
    grid.destroy();
    restore();
  });
});
