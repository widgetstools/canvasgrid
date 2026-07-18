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

  // Column-group header chevrons call drawIcon → Path2D; happy-dom lacks it.
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }

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
    // Cycle 22 / Task 2 — one ctx PER CANVAS (browser-faithful: the raster
    // caches attach a gc cache onto every scratch canvas they pool; a single
    // shared ctx object would have its cache closure clobbered mid-paint,
    // corrupting the main canvas's save/restore stack).
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) {
        ctx = { ...fakeCtx, canvas: this };
        perCanvas.set(this, ctx);
      }
      return ctx;
    };
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
 * Damage-region rendering (Task 5) — scroll paint policy through the real
 * `ViewportManager.onScrollerScroll` → `afterScrollTick` path.
 *
 * With `paintCache: false` (ext-demo / `qualityMode: 'performance'`), scroll
 * is Deephaven-style: FULL viewport redraw, never legacy canvas self-blit
 * (overlapping drawImage tore mid-body rows under fast wheel). With an
 * anchored retained layer, small vertical scrolls still resolve to present-
 * only frames (tracked via `presents`, not `blits`).
 */
describe('Damage-region rendering — scroll paint policy (paint stats)', () => {
  it('paintCache:false — one-row scroll is a full redraw (no self-blit)', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    const rowHeight = (grid as any).theme.rowHeight as number;
    (grid as any).onScrollerScroll(0, rowHeight);
    // Tick paint SYNCHRONOUSLY before the viewport-fetch chunk can land
    // and clobber damage with its own full/window-diff paint.
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);
    expect(stats.blits).toBe(0);

    grid.destroy();
    restore();
  });

  it('a full-page scroll jump paints live immediately (Deephaven — no freeze)', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    const bodyHeight = (grid as any).viewport.bodyHeight as number;
    (grid as any).onScrollerScroll(0, Math.ceil(bodyHeight) + 200);
    // Live paint every scroll tick — may briefly show empty cells until
    // the covering chunk lands (Deephaven ViewportDataGridModel returns '').
    canvas.tickPaint(performance.now() + 1000);
    expect(grid.getPaintStats().fullPaints).toBeGreaterThanOrEqual(1);
    expect(grid.getPaintStats().blits).toBe(0);

    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now() + 2000);
    expect(grid.getPaintStats().blits).toBe(0);

    grid.destroy();
    restore();
  });
});

/**
 * Horizontal-scroll + lean path (`paintCache: false`).
 *
 * Lean `afterScrollTick` syncs `this.viewport` from ViewportManager before
 * the full redraw (Deephaven paints from live view metrics), so the first
 * paint is already at the new scrollLeft — no stale-window burn.
 */
describe('Horizontal-scroll — lean path syncs viewport before full redraw', () => {
  // Wide layout so scrollLeft 150 is a real horizontal scroll (the shared
  // 2-column `cols` fits inside the 800px container — maxScrollLeft 0).
  const wideCols = Array.from({ length: 10 }, (_, i) => ({
    colId: `c${i}`,
    field: i === 0 ? 'id' : 'v',
    headerName: `C${i}`,
    width: 200,
  }));

  it('scroll full-paint before the chunk paints at the NEW scrollLeft (metrics already synced)', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), wideCols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    // Arm defined-empty touchedRows (off-screen tick).
    grid.applyTransactionAsync({ update: [{ id: 'r150', v: 999 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    grid.resetPaintStats();
    const t0 = performance.now();
    (grid as any).onScrollerScroll(150, 0);
    // Lean afterScrollTick copies ViewportManager.state → this.viewport
    // before requesting the repaint.
    expect((grid as any).viewport.scrollLeft).toBe(150);
    canvas.tickPaint(t0 + 1000);
    expect(grid.getPaintStats().fullPaints).toBeGreaterThanOrEqual(1);
    expect((grid as any).lastPaintedViewportScrollLeft).toBe(150);

    // Chunk may queue another full; surface must stay at scrollLeft 150.
    await new Promise((r) => setTimeout(r, 20));
    expect((grid as any).viewport.scrollLeft).toBe(150);
    canvas.tickPaint(t0 + 2000);
    expect((grid as any).lastPaintedViewportScrollLeft).toBe(150);

    grid.destroy();
    restore();
  });

  it('the fast path (chunk lands before the paint) still paints exactly one full — no double repaint', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), wideCols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    // Same off-screen-tick arming as the race test above.
    grid.applyTransactionAsync({ update: [{ id: 'r150', v: 999 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    grid.resetPaintStats();
    const t0 = performance.now();
    (grid as any).onScrollerScroll(150, 0);
    // Let the chunk land FIRST (the common fast path)...
    await new Promise((r) => setTimeout(r, 20));
    expect((grid as any).viewport.scrollLeft).toBe(150);
    // ...then paint: the scroll's full damage and the recompute's re-queued
    // full coalesce on the ledger into ONE full paint at the new position.
    canvas.tickPaint(t0 + 1000);
    const stats = grid.getPaintStats();
    expect(stats.fullPaints).toBe(1);
    // Settled: nothing left dirty — the mismatch check must not re-fire
    // once the painted scrollLeft caught up.
    canvas.tickPaint(t0 + 2000);
    expect(grid.getPaintStats().fullPaints).toBe(1);

    grid.destroy();
    restore();
  });
});

/**
 * Column layout / style mutation staleness (user-reported staggered cells
 * after resize, column move, or alignment change). Race:
 *   1. Live ticks leave PARTIAL row/cell damage on the ledger.
 *   2. A geometry mutation used to call bare `requestRepaint()` — so the
 *      next paint resolved as partial and only re-rastered those rows at
 *      the new column lefts; neighbors kept stale x until scroll.
 * Fix: layout mutation sites call `repaintFull()` so queued partial damage
 * is cleared and the whole surface re-rasters at the new geometry.
 */
describe('Column layout mutation — forces full paint over queued partial damage', () => {
  it('sizeColumnsToFit after a partial tick paints full (not staggered partial)', async () => {
    const fitCols = [
      { field: 'id', width: 100 },
      { field: 'v', type: 'number', width: 100 },
    ];
    const { grid, restore } = buildWiredGrid(rows(40), fitCols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    // Queue real partial damage the way a live blotter does.
    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 999 }, { id: 'r1', v: 998 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));
    // Do NOT paint yet — leave the partial damage on the ledger, then
    // mutate column widths (the bug: bare requestRepaint let partial win).
    grid.resetPaintStats();
    grid.sizeColumnsToFit();
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.fullPaints,
      'layout mutation must clear queued partial damage and full-paint').toBeGreaterThanOrEqual(1);
    expect(stats.partialPaints,
      'partial must not win over a column-geometry change').toBe(0);

    // Geometry itself must be consistent (monotonic lefts) after the fit.
    const layout = (grid as any).columnLayout as Array<{ left: number; width: number }>;
    for (let i = 1; i < layout.length; i++) {
      expect(layout[i]!.left).toBe(layout[i - 1]!.left + layout[i - 1]!.width);
    }

    grid.destroy();
    restore();
  });

  it('setColumnWidths after queued cell damage also full-paints', async () => {
    const { grid, restore } = buildWiredGrid(rows(40), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    grid.applyTransactionAsync({ update: [{ id: 'r2', v: 42 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));

    grid.resetPaintStats();
    grid.setColumnWidths([{ key: 'v', newWidth: 220 }]);
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);
    expect(stats.partialPaints).toBe(0);

    grid.destroy();
    restore();
  });

  it('layoutPaintEpoch mismatch after a burned paint keeps re-queuing full until a full lands', async () => {
    // Same class as horizontal-scroll staleness: a full can be spent while
    // the canvas/layer still shows the previous column geometry; later
    // partials only refresh some rows. The epoch guard must keep forcing
    // full until a damage.full paint catches lastPaintedLayoutPaintEpoch up.
    const { grid, restore } = buildWiredGrid(rows(40), cols);
    const canvas = (grid as any).cgridCanvas;
    const g = grid as any;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    expect(g.lastPaintedLayoutPaintEpoch).toBe(g.layoutPaintEpoch);

    grid.setColumnWidths([{ key: 'v', newWidth: 240 }]);
    // Simulate a burned paint: epoch advanced (setter wipe) but the stamp
    // never caught up (as if a partial or pre-layout full consumed damage).
    g.lastPaintedLayoutPaintEpoch = g.layoutPaintEpoch - 1;
    grid.resetPaintStats();
    g.recomputeViewport();
    canvas.tickPaint(performance.now() + 1000);

    expect(grid.getPaintStats().fullPaints).toBeGreaterThanOrEqual(1);
    expect(g.lastPaintedLayoutPaintEpoch).toBe(g.layoutPaintEpoch);

    grid.destroy();
    restore();
  });

  it('resizeColumn coalesces to one layout flush per animation frame', async () => {
    const { grid, restore } = buildWiredGrid(rows(40), cols);
    const canvas = (grid as any).cgridCanvas;
    const g = grid as any;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    const widthBefore = (g.columnLayout as Array<{ colId: string; width: number }>)
      .find((c) => c.colId === 'v')!.width;
    const widths: number[] = [];
    grid.addEventListener('columnResized', (e: any) => {
      if (e.finished === false) widths.push(e.width);
    });

    // Many pointer-sized updates in one turn — only the rAF flush should
    // emit finished:false (and apply layout once).
    g.resizeColumn('v', 10);
    g.resizeColumn('v', 10);
    g.resizeColumn('v', 10);
    expect(widths.length, 'no finished:false until rAF flush').toBe(0);
    expect(g.columnResizeDragActive).toBe(true);

    // Manual RAF queue (see beforeAll) — one flush applies all three dx.
    flushFrame();
    expect(widths.length).toBe(1);
    expect(widths[0]).toBe(widthBefore + 30);

    g.finishColumnResize('v');
    expect(g.columnResizeDragActive).toBe(false);

    grid.destroy();
    restore();
  });

  it('partial paint must not stamp lastPaintedLayoutPaintEpoch after a width change', async () => {
    const { grid, restore } = buildWiredGrid(rows(40), cols, { enableCellChangeFlash: true });
    const canvas = (grid as any).cgridCanvas;
    const g = grid as any;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    const epochBefore = g.layoutPaintEpoch;
    grid.setColumnWidths([{ key: 'v', newWidth: 260 }]);
    expect(g.layoutPaintEpoch).toBeGreaterThan(epochBefore);

    // Leave the healing full on the ledger, then also land a tick. The
    // coalesced paint must still be full (and stamp the epoch) — never a
    // partial that would silence further healing.
    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 1 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));
    grid.resetPaintStats();
    canvas.tickPaint(performance.now() + 1000);

    expect(grid.getPaintStats().fullPaints).toBeGreaterThanOrEqual(1);
    expect(g.lastPaintedLayoutPaintEpoch).toBe(g.layoutPaintEpoch);

    grid.destroy();
    restore();
  });
});

/**
 * Side-bar open/close (and any canvas resize) wipes the backing store via
 * `canvas.width` assignment. With fixed-width columns the resolved layout
 * often does not change, so the columnLayout setter used to skip
 * invalidate — queued partial tick damage then painted only those rows
 * over black (user-visible gaps between row clusters).
 */
describe('Canvas resize — forces full paint over queued partial damage', () => {
  it('width shrink with unchanged fixed-width layout full-paints (side-bar class)', async () => {
    const fixedCols = [
      { field: 'id', width: 110 },
      { field: 'v', type: 'number', width: 110 },
    ];
    const { grid, restore } = buildWiredGrid(rows(40), fixedCols);
    const g = grid as any;
    const canvas = g.cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    const layoutBefore = g.columnLayout.map((c: { left: number; width: number }) => ({
      left: c.left, width: c.width,
    }));

    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 999 }, { id: 'r5', v: 998 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));

    grid.resetPaintStats();
    // Mimic side-bar open: scroller clientWidth shrinks; resize wipes the
    // canvas. Fixed widths → identical columnLayout lefts/widths.
    Object.defineProperty(g.scroller, 'clientWidth', { value: 520, configurable: true });
    canvas.resize();

    const layoutAfter = g.columnLayout.map((c: { left: number; width: number }) => ({
      left: c.left, width: c.width,
    }));
    expect(layoutAfter).toEqual(layoutBefore);

    const stats = grid.getPaintStats();
    expect(stats.fullPaints,
      'canvas wipe must full-paint even when column layout is unchanged').toBeGreaterThanOrEqual(1);
    expect(stats.partialPaints,
      'partial must not paint over a wiped backing store').toBe(0);

    grid.destroy();
    restore();
  });
});

/**
 * Column-group expand + live-feed empty `touchedRows`:
 * Expanding paints immediately (headers + blank body for new leaves), then
 * `updateColumns` → `getViewport`. On a blotter whose worker diff-tracking
 * is armed (defined `touchedRows`, often `[]`), `resolveWindowDamage` used
 * to return `[]` because row identity was unchanged — so the chunk with
 * the revealed column's values never triggered a paint and blanks stuck.
 * The column-set check forces `'full'` when numeric/text colIds change.
 */
describe('Column-group expand — column-set change forces full paint', () => {
  it('expanding with a diff-armed empty touchedRows reply still full-paints revealed columns', async () => {
    const groupCols = [
      { colId: 'id', field: 'id', width: 80 },
      {
        groupId: 'G',
        headerName: 'Grp',
        openByDefault: false,
        children: [
          { colId: 'b', field: 'v', headerName: 'B', width: 100, type: 'number' },
          { colId: 'c', field: 'w', headerName: 'C', width: 100, type: 'number', columnGroupShow: 'open' },
        ],
      },
    ];
    const data = Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, v: i, w: i * 10 }));
    const { grid, restore } = buildWiredGrid(data, groupCols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    // Arm defined-empty touchedRows (off-screen tick).
    grid.applyTransactionAsync({ update: [{ id: 'r70', v: 999, w: 9990 }] });
    await new Promise((r) => setTimeout(r, 120));
    flushFrame();
    await new Promise((r) => setTimeout(r, 20));
    canvas.tickPaint(performance.now());

    // Expand: layout full paint runs BEFORE the worker chunk (blank new
    // columns). Burn that paint the same way the scroll-staleness test
    // burns the early full — then assert the chunk reply heals.
    const t0 = performance.now();
    const api = (grid as any).makeApi();
    api.setColumnGroupState([{ groupId: 'G', open: true }]);
    canvas.tickPaint(t0 + 1000); // burns the immediate layout full paint
    expect(grid.getPaintStats().fullPaints).toBeGreaterThanOrEqual(1);

    grid.resetPaintStats();
    // updateColumns → requestViewport → chunk that adds col `c`
    await new Promise((r) => setTimeout(r, 100));
    flushFrame();
    await new Promise((r) => setTimeout(r, 40));

    const chunk = (grid as any).chunk as { numericCols: Record<string, unknown> };
    expect(Object.keys(chunk.numericCols)).toContain('c');

    canvas.tickPaint(t0 + 2000);
    expect(grid.getPaintStats().fullPaints,
      'revealed columns must force a full paint even when touchedRows is []').toBeGreaterThanOrEqual(1);

    const cell = (grid as any).cellAt(0, 'c');
    expect(cell).toBeTruthy();
    expect(cell.value).toBe(0);

    grid.destroy();
    restore();
  });
});
