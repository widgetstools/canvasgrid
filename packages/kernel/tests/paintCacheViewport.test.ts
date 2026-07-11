/**
 * Paint-cache layer (Task 3) — widened viewport layout + fetch-window
 * coupling. Design: docs/superpowers/specs/2026-07-11-paint-cache-layer-
 * design.md §1 "Layer layout" / "Fetch window coupling".
 *
 * Covers:
 *  (a) `CGrid.buildLayerViewport` lays out rows that span the requested
 *      layer coverage, and its content-space mapping agrees with the real
 *      viewport's for rows visible in both.
 *  (b) `paintCache` (default true) widens the row overscan that drives
 *      `firstRow`/`lastRow` — and therefore the worker fetch window
 *      (`ViewportManager.request()`, viewportManager.ts:406) — so it
 *      covers the layer's intended coverage, not just the on-screen rows.
 *  (c) `paintCache: false` reproduces today's (pre-widening) overscan
 *      exactly — proven by re-deriving the "today" value via a direct
 *      `computeViewport` call mirroring `ViewportManager`'s own argument
 *      construction, independent of the widening code path.
 *  (d) `buildLayerViewport` memoizes on (live viewport identity, layerTop,
 *      layerHeight) — same geometry against the same viewport snapshot
 *      returns the SAME object; a geometry change or a fresh
 *      `recomputeViewport()` invalidates the cache.
 *
 * `buildWiredGrid` idiom (real `createWorkerHost`, not a stub) copied from
 * `tests/paintStats.integration.test.ts` — needed here because `firstRow`/
 * `lastRow`/row spans are only meaningful against a real row count, which
 * only lands once the worker reports it via the initial chunk.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import { computeViewport } from '../src/core/viewport';
import type { CGridOptions } from '../src/types/options';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
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
    return () => fakeCtx as any;
  })() as any;
});

// Wired to the real createWorkerHost (same idiom as
// tests/paintStats.integration.test.ts) — exercises the real setRowData →
// viewport-fetch → chunk-reply round trip, so `rowCount` (and therefore
// `firstRow`/`lastRow`) reflects the real dataset rather than a stub's 0.
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
  const g = grid as any;
  Object.defineProperty(g.scroller, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(g.root, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.root, 'clientHeight', { value: 600, configurable: true });
  g.cgridCanvas.resize();
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, restore };
}

function rows(n: number): Array<{ id: string; v: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: i }));
}

const cols = [{ field: 'id' }, { field: 'v', type: 'number' }];

// Real timers — the worker round-trip resolves via `queueMicrotask` +
// (for the internal `TransactionQueue`-free initial fetch) a plain
// microtask chain, so a short real wait lets the first chunk land, same
// as `paintStats.integration.test.ts`.
async function waitForFirstChunk(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe('buildLayerViewport — layer row layout (Task 3)', () => {
  it('lays out data rows that span the requested layer coverage', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    await waitForFirstChunk();
    const g = grid as any;

    (g as any).onScrollerScroll(0, 5000);
    const vs = g.viewport;
    expect(vs.lastRow).toBeGreaterThan(vs.firstRow);

    const layerTop = 4700;
    const layerHeight = vs.bodyHeight + 600;
    const layerVs = grid.buildLayerViewport({ layerTop, layerHeight });

    expect(layerVs.bodyHeight).toBeCloseTo(layerHeight, 5);

    const dataRows = layerVs.visibleRows.filter((r: any) => r.subgrid.isData);
    expect(dataRows.length).toBeGreaterThan(0);

    const first = dataRows[0];
    const last = dataRows[dataRows.length - 1];
    const firstContentTop = first.top - layerVs.bodyTop + layerTop;
    const lastContentBottom = last.bottom - layerVs.bodyTop + layerTop;

    // The layer's own row window (overscanRows: 0) is exactly the rows
    // whose bands intersect [layerTop, layerTop + layerHeight] — so the
    // first row's content top can't be past layerTop, and the last row's
    // content bottom can't fall short of the coverage's far edge.
    expect(firstContentTop).toBeLessThanOrEqual(layerTop + 0.001);
    expect(lastContentBottom).toBeGreaterThanOrEqual(layerTop + layerHeight - 0.001);

    grid.destroy();
    restore();
  });

  it('agrees with the real viewport on content-space row position for overlapping rows', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    await waitForFirstChunk();
    const g = grid as any;

    g.onScrollerScroll(0, 5000);
    // `CGrid.viewport` intentionally lags a native scroll event until the
    // async chunk round-trip re-syncs it (see the comment at cgrid.ts
    // ~1496) — `ViewportManager.onScrollerScroll` already recomputed its
    // OWN state (used for the fetch/damage paths), but `buildLayerViewport`
    // reads `this.viewport`, so force the same explicit resync the chunk
    // handler performs in production before comparing against it.
    g.recomputeViewport();
    const vs = g.viewport;

    const layerTop = 4700;
    const layerHeight = vs.bodyHeight + 600;
    const layerVs = grid.buildLayerViewport({ layerTop, layerHeight });

    const realByLocal = new Map<number, any>();
    for (const r of vs.visibleRows) {
      if (r.subgrid.isData) realByLocal.set(r.localRowIndex, r);
    }
    const layerDataRows = layerVs.visibleRows.filter((r: any) => r.subgrid.isData);
    let overlapCount = 0;
    for (const layerRow of layerDataRows) {
      const realRow = realByLocal.get(layerRow.localRowIndex);
      if (!realRow) continue;
      overlapCount++;
      const realContentTop = realRow.top - vs.bodyTop + vs.scrollTop;
      const layerContentTop = layerRow.top - layerVs.bodyTop + layerTop;
      expect(layerContentTop).toBeCloseTo(realContentTop, 5);
    }
    // The layer's coverage (bodyHeight + 600px each side) strictly
    // contains the real viewport's own visible range, so every real data
    // row must show up in the layer's row set too.
    expect(overlapCount).toBe(realByLocal.size);
    expect(overlapCount).toBeGreaterThan(0);

    grid.destroy();
    restore();
  });
});

describe('fetch-window coupling (Task 3)', () => {
  it('paintCache (default true) widens firstRow/lastRow to cover the layer range vs paintCache:false', async () => {
    const { grid: gridOn, restore: restoreOn } = buildWiredGrid(rows(2000), cols);
    const { grid: gridOff, restore: restoreOff } = buildWiredGrid(rows(2000), cols, { paintCache: false });
    await waitForFirstChunk();

    (gridOn as any).onScrollerScroll(0, 5000);
    (gridOff as any).onScrollerScroll(0, 5000);

    // Read `ViewportManager.state` directly rather than `CGrid.viewport`
    // — the latter intentionally lags a native scroll event until the
    // async chunk round-trip re-syncs it (cgrid.ts ~1496), but the fetch
    // window (what this test cares about) is driven off the manager's own
    // freshly-recomputed state, synchronously within `onScrollerScroll`.
    const on = (gridOn as any).viewportManager.state;
    const off = (gridOff as any).viewportManager.state;

    // Widened (cache on) range must fully contain the un-widened (cache
    // off) range and be strictly larger — the default paintCacheOverscan
    // (0.5 × bodyHeight) banks far more than the default 3-row overscan
    // for an ordinary row height.
    expect(on.firstRow).toBeLessThanOrEqual(off.firstRow);
    expect(on.lastRow).toBeGreaterThanOrEqual(off.lastRow);
    expect(on.lastRow - on.firstRow).toBeGreaterThan(off.lastRow - off.firstRow);

    gridOn.destroy();
    gridOff.destroy();
    restoreOn();
    restoreOff();
  });

  it('posts a worker fetch range (rowStart..rowEnd) matching the widened firstRow..lastRow+1', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    await waitForFirstChunk();
    const g = grid as any;

    const spy = vi.spyOn(g.workerCoord, 'dispatchViewportRequest');
    g.onScrollerScroll(0, 5000);

    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[spy.mock.calls.length - 1]![0] as { rowStart: number; rowEnd: number };
    const vs = g.viewportManager.state;
    // A single scroll call samples zero velocity (no prior sample within
    // the 200ms window), so `expandRangeForVelocity` is a no-op and the
    // posted range is exactly [firstRow, lastRow + 1).
    expect(call.rowStart).toBe(vs.firstRow);
    expect(call.rowEnd).toBe(vs.lastRow + 1);

    grid.destroy();
    restore();
  });

  it('paintCache: false reproduces today\'s exact (pre-widening) overscan', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols, { paintCache: false });
    await waitForFirstChunk();
    const g = grid as any;

    g.onScrollerScroll(0, 5000);
    const vs = g.viewportManager.state;

    // Re-derive "today's" value independently via a direct computeViewport
    // call mirroring ViewportManager.computeCurrentViewport's own argument
    // construction, with `rowBuffer` left undefined (the pre-widening
    // default) — proves paintCache:false takes the widening branch's early
    // return rather than merely computing the same number by coincidence.
    const expected = computeViewport({
      columnLayout: g.columnLayout,
      subgrids: g.subgrids,
      containerWidth: g.canvasBounds.width || g.scroller.clientWidth || g.root.clientWidth || 800,
      containerHeight: g.canvasBounds.height || g.scroller.clientHeight || g.root.clientHeight || 600,
      scrollLeft: 0,
      scrollTop: 5000,
      suppressColumnVirtualisation: false,
      suppressRowVirtualisation: false,
      dataRowHeightIndex: g.rowHeightIndex ?? undefined,
    });

    expect(vs.firstRow).toBe(expected.firstRow);
    expect(vs.lastRow).toBe(expected.lastRow);
    expect(vs.bodyHeight).toBeCloseTo(expected.bodyHeight, 5);
    expect(vs.visibleRows.length).toBe(expected.visibleRows.length);

    grid.destroy();
    restore();
  });
});

describe('buildLayerViewport memoization (Task 3)', () => {
  it('returns the same object for the same geometry against the same viewport snapshot', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    await waitForFirstChunk();
    const g = grid as any;
    g.onScrollerScroll(0, 5000);

    const geo = { layerTop: 4700, layerHeight: g.viewport.bodyHeight + 600 };
    const a = grid.buildLayerViewport(geo);
    const b = grid.buildLayerViewport(geo);
    expect(b).toBe(a);

    grid.destroy();
    restore();
  });

  it('invalidates on a geometry change', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    await waitForFirstChunk();
    const g = grid as any;
    g.onScrollerScroll(0, 5000);

    const bodyHeight = g.viewport.bodyHeight;
    const a = grid.buildLayerViewport({ layerTop: 4700, layerHeight: bodyHeight + 600 });
    const c = grid.buildLayerViewport({ layerTop: 4700, layerHeight: bodyHeight + 650 });
    expect(c).not.toBe(a);

    grid.destroy();
    restore();
  });

  it('invalidates whenever recomputeViewport runs, even with unchanged geometry', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    await waitForFirstChunk();
    const g = grid as any;
    g.onScrollerScroll(0, 5000);

    const geo = { layerTop: 4700, layerHeight: g.viewport.bodyHeight + 600 };
    const a = grid.buildLayerViewport(geo);

    // Force a fresh recompute (computeViewport always returns a new
    // object) without changing scroll position or geometry.
    g.recomputeViewport();
    const d = grid.buildLayerViewport(geo);
    expect(d).not.toBe(a);
    // ...but the underlying layout is equivalent, since nothing else
    // actually changed.
    expect(d.firstRow).toBe(a.firstRow);
    expect(d.lastRow).toBe(a.lastRow);

    // And the cache hits again for the same (new) snapshot + geometry.
    const e = grid.buildLayerViewport(geo);
    expect(e).toBe(d);

    grid.destroy();
    restore();
  });
});
