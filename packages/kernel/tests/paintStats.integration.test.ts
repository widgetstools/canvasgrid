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
