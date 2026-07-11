/**
 * Damage-region rendering (Task 3) — end-to-end proof that an async
 * transaction's worker-reported `touchedRows` drives a PARTIAL repaint
 * through `CGrid.repaintRows`, not a full one. Also the empirical check
 * flagged by the task brief: does `chunk.rowStart + r` (the touchedRows
 * index space) land in the same coordinate space as the viewport's
 * `ViewportRow.localRowIndex` (the `rowBand()` resolver's input)? If the
 * spaces differed, `buildDamageResolveCtx().rowBand` would return `null`
 * for every touched row, the ledger would find zero paintable rects, and
 * `partialPaints` would still increment (an empty-but-non-full resolution)
 * while `lastAreaPct` stayed at 0 rather than reflecting real row bands —
 * this test's `lastAreaPct` assertion (a small but non-zero fraction) is
 * what actually pins the index-space claim down.
 *
 * `buildWiredGrid` idiom + canvas/context stubs copied from
 * `tests/cgrid.integration.test.ts` (local helper, not cross-imported).
 * The RAF queue + manual `flushFrame()` idiom is copied from
 * `tests/workerClientCoalesce.test.ts` — `WorkerClient` coalesces its
 * `modelUpdated` push (the async transaction's `requestViewport` trigger)
 * behind a `requestAnimationFrame` callback, so the test needs full manual
 * control over when that callback fires rather than racing a real RAF
 * against explicit `canvas.tickPaint()` calls.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types/options';

let rafQueue: Array<() => void> = [];

function flushFrame(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
}

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };

  // Manual RAF queue (same idiom as tests/workerClientCoalesce.test.ts) —
  // both `CGridCanvas`'s background paint loop AND `WorkerClient`'s
  // modelUpdated-push coalescing schedule through `requestAnimationFrame`.
  // Driving it manually via `flushFrame()` keeps the test deterministic:
  // paints only ever happen via the explicit `canvas.tickPaint()` calls
  // below (the canvas loop's own re-scheduled callback runs with no `now`
  // argument here, so its internal `elapsed > interval` gate never opens).
  (globalThis as any).requestAnimationFrame = (cb: () => void) => { rafQueue.push(cb); return rafQueue.length; };
  (globalThis as any).cancelAnimationFrame = () => {};

  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      // Task 5 — scroll self-blit calls `gc.drawImage(canvas, ...)`. A real
      // browser 2D context always has this; the fake mock below needs an
      // explicit stub so the new scroll-blit tests don't throw.
      drawImage: vi.fn(),
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
});

// Wired to the real createWorkerHost — exercises the full main → worker →
// main round-trip (setRowData, the async TransactionQueue flush, and the
// getViewport reply carrying `touchedRows`), not a fake stub.
function buildWiredGrid<T extends { id: string }>(
  rows: T[],
  cols: any[],
  options: Partial<CGridOptions<T>> = {},
) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    host = createWorkerHost((msg) => {
      // Microtask delay mirrors the real Worker postMessage boundary.
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: any) { this.host.handle(msg); }
    addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
    terminate() {}
  };
  const grid = new CGrid<T>(container, {
    columnDefs: cols,
    getRowId: (r) => r.id,
    rowData: rows,
    // Task 4 (paint-cache layer) — this suite exercises the BASE damage-
    // region system's own mechanics (blit counting, row-index-space
    // resolution, area percentages against the single screen-space rect
    // union) — the retained paint-cache layer (default-on since Task 4)
    // repartitions that same damage into a layer raster + a separate
    // chrome raster, which shifts these exact numbers without changing
    // anything about the base system under test. `paintCache: false`
    // pins this suite to the unchanged legacy/escape-hatch pipeline the
    // assertions below were written against; the layer's own behavior
    // has dedicated coverage in `tests/rendererPaintCache.test.ts`.
    paintCache: false,
    ...options,
  });
  // happy-dom reports 0 for clientWidth/clientHeight without a real layout
  // engine (same workaround as tests/virtualColumnsChanged.test.ts) — the
  // grid's `measureSize` reads these, so without the stub `canvasBounds`
  // (and thus every damage rect) collapses to 0×0 and the `lastAreaPct`
  // assertion below can't distinguish "a small real fraction" from "an
  // empty resolution that happens to report 0%".
  const g = grid as any;
  Object.defineProperty(g.scroller, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(g.root, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.root, 'clientHeight', { value: 600, configurable: true });
  g.cgridCanvas.resize();
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, container, restore };
}

function rows(n: number): Array<{ id: string; v: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: i }));
}

const cols = [{ field: 'id' }, { field: 'v', type: 'number' }];

describe('Damage-region rendering — tick + flash damage (paint stats)', () => {
  it('an async transaction updating 2 rows drives a partial repaint via touchedRows', async () => {
    const { grid, restore } = buildWiredGrid(rows(20), cols);
    const canvas = (grid as any).cgridCanvas;

    // Let the first chunk land (setRowData's viewport fetch is a direct
    // request/response — no RAF gating), then tick the canvas
    // deterministically. `tickPaint` respects the same `dirty` gate the
    // real RAF loop does, so it only paints when the chunk actually
    // recorded damage (`repaintFull()` on arrival — there's no prior
    // window to compare against yet).
    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    expect(grid.getPaintStats().fullPaints).toBeGreaterThanOrEqual(1);

    grid.resetPaintStats();
    // Async transaction — routes through the worker's TransactionQueue
    // (waitMs: 50), which is where `pendingTouched` is staged (Task 3).
    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 999 }, { id: 'r1', v: 998 }] });
    // Real wait past the queue's 50ms batching window, whose flush posts
    // the `modelUpdated` push main is waiting on.
    await new Promise((r) => setTimeout(r, 120));
    // Release the coalesced `modelUpdated` push → `onModelUpdated` →
    // `requestViewport('rowDataChanged')`.
    flushFrame();
    // The resulting getViewport round-trip is request/response (microtask
    // chain, no further RAF gating) — a short real wait lets it land.
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.partialPaints).toBeGreaterThanOrEqual(1);
    expect(stats.fullPaints).toBe(0);
    // A non-zero-but-small area is the actual proof that `chunk.rowStart + r`
    // resolved to REAL row bands (see file-header comment) — an index-space
    // mismatch would silently resolve every touched row to `null` and the
    // merged rect list would be empty (0%), not a couple of row bands.
    expect(stats.lastAreaPct).toBeGreaterThan(0);
    expect(stats.lastAreaPct).toBeLessThan(30);

    grid.destroy();
    restore();
  });

  it('suppressPartialRepaint: true degrades the same transaction to a full repaint', async () => {
    const { grid, restore } = buildWiredGrid(rows(20), cols, { suppressPartialRepaint: true });
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 999 }, { id: 'r1', v: 998 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.partialPaints).toBe(0);
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);

    grid.destroy();
    restore();
  });
});

/**
 * Damage-region rendering (Task 4) — hover, selection, and focus damage.
 *
 * Hover-index-space check: `HitTester.locate` resolves a cell hit's
 * `rowIndex` from `ViewportRow.localRowIndex` on a `DataSubgrid` row (see
 * `src/interaction/hitTester.ts`, "Hits only count when they land in a
 * DataSubgrid row — `localRowIndex` is the data-row index"). That's the
 * SAME index space `CGrid.repaintRows` expects (`cellAt`'s `rowIndex` /
 * the chunk's `rowStart`-relative local index — confirmed by Task 3's
 * report). So `OnHover` can forward `hit.rowIndex` straight into
 * `ctx.grid.repaintRows` with no conversion. These tests dispatch a real
 * `mousemove` at the canvas element (not a synthetic feature-level ctx)
 * so the whole hit-test → OnHover → CGrid.repaintRows → paint path is
 * exercised end-to-end, the same way the touchedRows test above exercises
 * the worker → chunk → repaintRows path.
 */
describe('Damage-region rendering — hover, selection, and focus damage (paint stats)', () => {
  /** happy-dom's canvas `getBoundingClientRect()` reports an all-zero rect,
   *  so `FeatureChain.toLocal` maps `clientX/clientY` directly onto
   *  canvas-local CSS px with no offset — `dataRowPoint` just needs to
   *  land inside a real DataSubgrid row's painted band + a visible
   *  column's span, read live off `grid.viewport` so the test doesn't
   *  hard-code theme row/header heights. */
  function dataRowPoint(grid: any, localRowIndex: number): { x: number; y: number } {
    const vs = grid.viewport;
    const row = vs.visibleRows.find(
      (r: any) => r.subgrid.isData && r.localRowIndex === localRowIndex,
    );
    if (!row) throw new Error(`row ${localRowIndex} not in viewport`);
    const col = vs.visibleColumns[0];
    return { x: col.left + 5, y: row.top + 5 };
  }

  function moveTo(grid: any, point: { x: number; y: number }): void {
    grid.cgridCanvas.canvas.dispatchEvent(
      new MouseEvent('mousemove', { clientX: point.x, clientY: point.y, bubbles: true }),
    );
  }

  it('a hovered-row change drives a partial repaint with a small area', async () => {
    const { grid, restore } = buildWiredGrid(rows(20), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    // Enter row 0, then move to row 1 — the second move is the "steady
    // state" hover transition (prevRow=0, nextRow=1) most representative
    // of ordinary pointer travel.
    moveTo(grid, dataRowPoint(grid, 0));
    moveTo(grid, dataRowPoint(grid, 1));
    // `tickPaint` is fps-gated on real elapsed time since the last paint
    // (`canvas.ts`'s `elapsed > interval` check) — a real wait is needed
    // between the two `tickPaint` calls or the second one no-ops even
    // though `dirty` is true.
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.partialPaints).toBeGreaterThanOrEqual(1);
    expect(stats.fullPaints).toBe(0);
    expect(stats.lastAreaPct).toBeGreaterThan(0);
    expect(stats.lastAreaPct).toBeLessThan(30);

    grid.destroy();
    restore();
  });

  it('focusing a cell via setFocusedCell drives a partial repaint', async () => {
    const { grid, restore } = buildWiredGrid(rows(20), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    grid.setFocusedCell('r5', 'v');
    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.partialPaints).toBeGreaterThanOrEqual(1);
    expect(stats.fullPaints).toBe(0);
    expect(stats.lastAreaPct).toBeGreaterThan(0);
    expect(stats.lastAreaPct).toBeLessThan(30);

    grid.destroy();
    restore();
  });

  it('selectAll on a large row set drives a FULL repaint, never enumerating every row into the ledger', async () => {
    const { grid, restore } = buildWiredGrid(rows(5000), cols, { rowSelection: 'multiple' } as any);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    (grid as any).selectAll();
    // See the fps-gate note above — a real wait is required before the
    // next `tickPaint` actually re-paints.
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);
    expect(stats.partialPaints).toBe(0);
    // A full paint always reports 100% — the actual proof that select-all
    // did NOT resolve through the row-delta path (which would report a
    // small `lastAreaPct` even for a 5,000-row delta, since `repaintRows`
    // would still just be handed a huge array; the assertion that matters
    // is `partialPaints === 0` above, i.e. `repaintRows` was never called
    // at all for this change).
    expect(stats.lastAreaPct).toBe(100);

    grid.destroy();
    restore();
  });
});

/**
 * Damage-region rendering (Task 5) — scroll self-blit, end to end through
 * the real `ViewportManager.onScrollerScroll` → `afterScrollTick` →
 * `decideScrollDamage` → `DamageLedger` → `Renderer.paint` blit path (the
 * same idiom `tests/virtualColumnsChanged.test.ts` / `aggregationEvent.test.ts`
 * use to drive scroll: reach in via `(grid as any).onScrollerScroll(x, y)`,
 * the back-compat shim for the native 'scroll' listener registered inside
 * `ViewportManager`).
 */
describe('Damage-region rendering — scroll self-blit (paint stats)', () => {
  it('a one-row-height vertical scroll drives a blit with a small damaged area', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    const rowHeight = (grid as any).theme.rowHeight as number;
    (grid as any).onScrollerScroll(0, rowHeight);
    // Tick paint SYNCHRONOUSLY (same turn, no `await` in between) with a
    // synthetic `now` far enough past `lastRepaintTime` to clear the fps
    // gate WITHOUT any real wall-clock wait. That matters here: a real wait
    // (even `setTimeout(…, 0)`) lets the microtask queue drain, which is
    // where the async viewport-fetch chunk lands — `handleViewportChunk`
    // unconditionally `repaintFull()`s on a window move (a real scroll
    // virtualizes a different row window), which would clobber the scroll
    // damage before this assertion ever saw the blit. Ticking synchronously
    // proves the blit path fires for the frame BEFORE that chunk arrives —
    // exactly the frame the self-blit optimization exists for.
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.blits).toBeGreaterThanOrEqual(1);
    expect(stats.partialPaints).toBeGreaterThanOrEqual(1);
    expect(stats.fullPaints).toBe(0);
    expect(stats.lastAreaPct).toBeLessThan(30);

    grid.destroy();
    restore();
  });

  it('a full-page scroll jump (>= body height) bails to a full repaint, blits unchanged', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    const bodyHeight = (grid as any).viewport.bodyHeight as number;
    (grid as any).onScrollerScroll(0, Math.ceil(bodyHeight) + 200);
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);
    expect(stats.blits).toBe(0);

    grid.destroy();
    restore();
  });
});
