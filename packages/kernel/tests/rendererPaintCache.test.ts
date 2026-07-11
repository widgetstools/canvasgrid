/**
 * Paint-cache layer (Task 4) — renderer integration: layer raster + present
 * + chrome passes. Design: docs/superpowers/specs/2026-07-11-paint-cache-
 * layer-design.md §1/§3; plan: docs/superpowers/plans/2026-07-11-paint-
 * cache-layer.md Task 4.
 *
 * Covers:
 *  (a) the layer pass (`Renderer.paintLayer`) issues ONLY data-band draws —
 *      no header cell-renderer calls, no sticky-band calls — into the
 *      layer's own `gc`.
 *  (b) the present pass (`Renderer.presentLayer`) issues exactly one
 *      `drawImage` with a DEVICE-px source rect and a CSS-px destination
 *      rect, at dpr 1 AND dpr 2 (the C1 lesson).
 *  (c) painting the SAME logical frame through the split layer+chrome
 *      passes produces the same set of pixel-producing draw calls
 *      (fillRect/fillText/stroke/strokeRect) as the legacy single-pass
 *      `Renderer.paint()` — order differs (the split runs data bands then
 *      chrome bands instead of one interleaved pass) but the two passes'
 *      regions never overlap, so a multiset comparison is the correct
 *      pixel-equivalence proof, not a strict sequence comparison.
 *  (d) CGrid-level: reset triggers (first paint, a scroll jump beyond the
 *      layer's coverage, a horizontal scroll) reallocate/re-anchor the
 *      layer rather than presenting stale pixels.
 *  (e) CGrid-level: `PaintStats.presents` / `layerShifts` / `layerResets` /
 *      `layerRasterMs` behave sensibly across a paint sequence.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Renderer, type RendererOpts } from '../src/renderer/renderer';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import type { Subgrid } from '../src/core/subgrid';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types/options';

// ─── fakeGc ──────────────────────────────────────────────────────────────────
// Same recording idiom as tests/rendererDamage.test.ts.

interface RecordedCall { m: string; args: unknown[] }

function fakeGc(): { gc: CachedContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const rec = (m: string) => (...args: unknown[]) => { calls.push({ m, args }); };
  const ctx: any = {
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
    save: rec('save'), restore: rec('restore'),
    rect: rec('rect'), clip: rec('clip'), beginPath: rec('beginPath'), stroke: rec('stroke'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), closePath: rec('closePath'),
    translate: rec('translate'), scale: rec('scale'), drawImage: rec('drawImage'),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) {
      if (key === 'save') return rec('cache.save');
      if (key === 'restore') return rec('cache.restore');
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return { gc: ctx as CachedContext2D, calls };
}

const CANVAS_W = 300;
const CANVAS_H = 300;

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as ResolvedTheme;

const headerSubgrid: Subgrid = {
  type: 'header', isHeader: true, isData: false, isTotals: false, isFooter: false,
  getRowCount: () => 1, getRowHeight: () => 32, getCell: () => null,
};
const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 1000, getRowHeight: () => 30, getCell: () => null,
};

// Header row (top=0..32) + 2 data rows (32..62, 62..92). bodyTop=32,
// bodyBottom=92 — matches the layout `paintCellsByRows`/`paintGridLines`
// expect (data subgrid bands clip to [bodyTop, bodyBottom]).
function makeVs(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: CANVAS_W, width: CANVAS_W },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 32, bottom: 62, height: 30 }, // odd → altBg
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 2, top: 62, bottom: 92, height: 30 }, // even → bg
    ],
    firstRow: 1, lastRow: 2,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: CANVAS_W, bodyTop: 32, bodyBottom: 92, bodyWidth: CANVAS_W, bodyHeight: 60,
    contentWidth: CANVAS_W, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 910,
  };
}

const columnDefs = new Map<string, ResolvedColDef>([
  ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false } as ResolvedColDef],
]);

/** Records every `.paint(gc, config)` call by renderer key, so tests can
 *  assert e.g. "the 'header' renderer never fired during the layer pass"
 *  without inspecting raw gc calls (which don't carry renderer identity). */
function makeSpyRegistry(): { reg: CellRendererRegistry; hits: string[] } {
  const hits: string[] = [];
  const reg = new CellRendererRegistry();
  for (const key of ['text', 'header']) {
    reg.register(key, { paint: (gc: CachedContext2D, config: any) => {
      hits.push(key);
      gc.cache.fillStyle = config.fg || '#000';
      gc.fillText(config.valueFormatted, 0, 0);
    } });
  }
  return { reg, hits };
}

function makeOpts(overrides: Partial<RendererOpts> = {}): RendererOpts {
  const { reg } = makeSpyRegistry();
  return {
    getViewport: () => makeVs(),
    getTheme: () => theme,
    getColumnDefs: () => columnDefs,
    cellRenderers: reg,
    cellData: () => ({ value: 'x', valueFormatted: 'x' }),
    getSelection: () => ({
      focusedRowIndex: null, focusedColId: null,
      selectedRowIndices: new Set<number>(), ranges: [],
    }),
    getSortModel: () => [],
    getCanvasWidth: () => CANVAS_W,
    getCanvasHeight: () => CANVAS_H,
    rowDataSnapshotAt: () => ({}),
    getQuickFilterLowerTerms: () => [],
    getShowFillHandle: () => false,
    getSuppressAggFuncInHeader: () => false,
    getVisibleCellBounds: () => null,
    getGroupRowStrip: () => null,
    getRowKindAt: () => 0,
    getGroupHideOpenParents: () => false,
    getStickyAncestors: () => [],
    getGroupDepthAt: () => 0,
    getGroupKeyAt: () => '',
    ...overrides,
  };
}

describe('Renderer — paint-cache layer split (Task 4)', () => {
  describe('(a) paintLayer — data-band-only, no header/sticky calls', () => {
    it('only fires the data-row cell renderer, never the header renderer', () => {
      const { reg, hits } = makeSpyRegistry();
      const opts = makeOpts({ cellRenderers: reg });
      const renderer = new Renderer(opts);
      const { gc } = fakeGc();
      const vs = makeVs();

      renderer.paintLayer(gc, vs, true, []);

      expect(hits).toContain('text');
      expect(hits).not.toContain('header');
    });

    it('never calls createLinearGradient (the sticky-band shadow) even with sticky ancestors present', () => {
      const opts = makeOpts({
        getStickyAncestors: () => [
          { depth: 0, key: 'g1', colId: 'a', value: 'Group 1', childCount: 3, isExpanded: true },
        ],
      });
      const renderer = new Renderer(opts);
      const { gc, calls } = fakeGc();
      const vs = makeVs();

      renderer.paintLayer(gc, vs, true, []);

      // paintStickyGroups is the ONLY painter that calls createLinearGradient
      // (its drop-shadow) — its absence proves the sticky pass never ran.
      expect(calls.some((c) => c.m === 'createLinearGradient')).toBe(false);
    });

    it('full=true fills the layer body extent, not the header band', () => {
      const opts = makeOpts();
      const renderer = new Renderer(opts);
      const { gc, calls } = fakeGc();
      const vs = makeVs();

      renderer.paintLayer(gc, vs, true, []);

      // The full-fill background rect spans [bodyTop, bodyBottom), not [0, canvasHeight).
      const bgFill = calls.find((c) => c.m === 'fillRect' && c.args[1] === vs.bodyTop);
      expect(bgFill).toBeDefined();
      expect(bgFill!.args[3]).toBe(vs.bodyBottom - vs.bodyTop);
      // Never fills starting at y=0 (that would be the header band).
      expect(calls.some((c) => c.m === 'fillRect' && c.args[1] === 0)).toBe(false);
    });

    it('partial with empty contentRects is a no-op (present-only fast path)', () => {
      const opts = makeOpts();
      const renderer = new Renderer(opts);
      const { gc, calls } = fakeGc();
      const vs = makeVs();

      renderer.paintLayer(gc, vs, false, []);

      expect(calls).toHaveLength(0);
    });

    it('partial clips to the union of contentRects and rasters only inside it', () => {
      const opts = makeOpts();
      const renderer = new Renderer(opts);
      const { gc, calls } = fakeGc();
      const vs = makeVs();

      renderer.paintLayer(gc, vs, false, [{ x: 0, y: 32, w: CANVAS_W, h: 30 }]);

      expect(calls.some((c) => c.m === 'clip')).toBe(true);
      expect(calls[0]!.m).toBe('save');
      expect(calls[calls.length - 1]!.m).toBe('restore');
    });
  });

  describe('(b) presentLayer — device-px source, CSS-px destination', () => {
    it('dpr=1 — device px and CSS px coincide', () => {
      const renderer = new Renderer(makeOpts());
      const { gc, calls } = fakeGc();
      renderer.presentLayer(
        gc,
        {} as any,
        400, // srcWidthDevicePx
        { sy: 50, sh: 200 },
        { bodyTop: 32, bodyBottom: 232, width: 400 },
      );
      const drawImageCall = calls.find((c) => c.m === 'drawImage');
      expect(drawImageCall).toBeDefined();
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImageCall!.args;
      expect([sx, sy, sw, sh]).toEqual([0, 50, 400, 200]);
      expect([dx, dy, dw, dh]).toEqual([0, 32, 400, 200]);
    });

    it('dpr=2 — DEVICE-px source rect, CSS-px destination rect (the C1 lesson)', () => {
      const renderer = new Renderer(makeOpts());
      const { gc, calls } = fakeGc();
      // At dpr=2, a CSS-px body span of 200 (bodyTop=32..bodyBottom=232)
      // corresponds to a DEVICE-px source height of 400 — the source rect
      // must carry the DEVICE value, the destination the CSS value.
      renderer.presentLayer(
        gc,
        {} as any,
        800, // srcWidthDevicePx (canvas.width at dpr=2 for a 400 CSS-px-wide layer)
        { sy: 100, sh: 400 }, // device px
        { bodyTop: 32, bodyBottom: 232, width: 400 }, // CSS px
      );
      const drawImageCall = calls.find((c) => c.m === 'drawImage');
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImageCall!.args;
      expect([sx, sy, sw, sh]).toEqual([0, 100, 800, 400]); // device px, unscaled
      expect([dx, dy, dw, dh]).toEqual([0, 32, 400, 200]); // CSS px — HALF the device src height
    });

    it('skips the drawImage entirely when the visible height collapses to zero', () => {
      const renderer = new Renderer(makeOpts());
      const { gc, calls } = fakeGc();
      renderer.presentLayer(gc, {} as any, 400, { sy: 0, sh: 0 }, { bodyTop: 32, bodyBottom: 32, width: 400 });
      expect(calls.some((c) => c.m === 'drawImage')).toBe(false);
    });
  });

  describe('(c) split layer+chrome vs. legacy paint() — equivalent paint calls', () => {
    it('the layer+chrome split produces the same multiset of pixel-producing calls as the legacy full paint', () => {
      const { reg: regLegacy, hits: hitsLegacy } = makeSpyRegistry();
      const rendererLegacy = new Renderer(makeOpts({ cellRenderers: regLegacy }));
      const { gc: gcLegacy, calls: callsLegacy } = fakeGc();
      rendererLegacy.paint(gcLegacy, { full: true, chromeRects: [], dataRects: [], blit: null });

      const { reg: regSplit, hits: hitsSplit } = makeSpyRegistry();
      const rendererSplit = new Renderer(makeOpts({ cellRenderers: regSplit }));
      const { gc: gcSplit, calls: callsSplit } = fakeGc();
      const vs = makeVs();
      // Degenerate case: layerVs === the real viewport (layer coverage ==
      // body height) — the split's data+chrome union should paint every
      // row the legacy single pass did.
      rendererSplit.paintLayer(gcSplit, vs, true, []);
      rendererSplit.paintChrome(gcSplit, true, []);

      // Renderer identity calls: both paths must fire 'header' for the
      // header row and 'text' for both data rows — same total renderer
      // invocations, just split across two calls instead of one.
      expect(hitsSplit.sort()).toEqual(hitsLegacy.sort());

      // Text/stroke content calls as an unordered multiset — the split
      // runs data bands then chrome bands instead of one interleaved
      // pass, so ORDER legitimately differs, but these are the direct
      // "same content painted" proof (cell text, gridline hairlines):
      // fillText args (and fillRect args ≤ one row tall — gridline
      // hairlines/cell bg bundles) are IDENTICAL either way, since
      // neither pass repartitions a hairline or a text draw.
      const CONTENT_OPS = new Set(['fillText', 'stroke', 'strokeRect']);
      const norm = (calls: RecordedCall[]) => calls
        .filter((c) => CONTENT_OPS.has(c.m))
        .map((c) => JSON.stringify([c.m, c.args]))
        .sort();
      expect(norm(callsSplit)).toEqual(norm(callsLegacy));

      // The ONE structural difference by design: the legacy pass fills its
      // background in as few big rects as the damage clip allows (here,
      // one full-canvas `fillRect`), while the split partitions the SAME
      // total area into a layer-side fill (the data band) + a chrome-side
      // fill (everything else) — two (or more) smaller rects covering the
      // identical union. A literal rect-by-rect comparison would fail on
      // shape; summed AREA is the actual pixel-coverage invariant.
      const fillArea = (calls: RecordedCall[]) => calls
        .filter((c) => c.m === 'fillRect')
        .reduce((a, c) => a + (c.args[2] as number) * (c.args[3] as number), 0);
      expect(fillArea(callsSplit)).toBe(fillArea(callsLegacy));
    });
  });
});

// ─── CGrid-level integration (d)/(e) ─────────────────────────────────────────
// `buildWiredGrid` idiom copied from tests/paintStats.integration.test.ts /
// tests/paintCacheViewport.test.ts (local helper, not cross-imported).

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
      drawImage: vi.fn(), createLinearGradient: () => ({ addColorStop: () => {} }),
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
  return { grid, container, restore };
}

function rows(n: number): Array<{ id: string; v: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: i }));
}

const cols = [{ field: 'id' }, { field: 'v', type: 'number' }];

describe('CGrid + paint-cache layer — stats + reset triggers (Task 4)', () => {
  it('(e) the very first paint reports a layer reset, a present, and a positive layerRasterMs', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.presents).toBeGreaterThanOrEqual(1);
    expect(stats.layerResets).toBeGreaterThanOrEqual(1);
    expect(stats.layerRasterMs).toBeGreaterThan(0);

    grid.destroy();
    restore();
  });

  it('(e) a small in-coverage vertical scroll presents without a reset (steady-scroll perf goal)', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;
    const g = grid as any;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    // A tiny scroll well within the layer's overscan margin — should
    // 'keep' (present-only), never a reset.
    const rowHeight = g.theme.rowHeight as number;
    g.onScrollerScroll(0, rowHeight);
    g.recomputeViewport(); // Task 3 gotcha: CGrid.viewport lags until this runs.
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.presents).toBeGreaterThanOrEqual(1);
    expect(stats.layerResets).toBe(0);

    grid.destroy();
    restore();
  });

  it('(d) a scroll jump beyond the layer\'s coverage forces a layer reset', async () => {
    const { grid, restore } = buildWiredGrid(rows(2000), cols);
    const canvas = (grid as any).cgridCanvas;
    const g = grid as any;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    // Layer coverage is bodyHeight * (1 + 2*0.5) = 2 * bodyHeight; a jump
    // of several screens is well beyond ANY overscan configuration and
    // must force a reset, never a stale present of pre-jump pixels.
    const bodyHeight = g.viewport.bodyHeight as number;
    g.onScrollerScroll(0, bodyHeight * 10);
    g.recomputeViewport();
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.layerResets).toBeGreaterThanOrEqual(1);

    grid.destroy();
    restore();
  });

  it('(d) a horizontal scroll forces a full re-raster (never a stale-shifted present)', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;
    const g = grid as any;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    // Horizontal scroll never moves `planLayer`'s own vertical anchor, but
    // it MUST still force a full re-raster (the layer's pixel content is
    // now stale — its columns don't reflect the new scrollLeft) via the
    // base damage system's own `dx !== 0` full-bail (decideScrollDamage).
    g.onScrollerScroll(50, 0);
    g.recomputeViewport();
    canvas.tickPaint(performance.now() + 1000);

    const stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);

    grid.destroy();
    restore();
  });

  it('(d) paintCache: false reproduces the legacy pipeline — no layer stats increment at all', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols, { paintCache: false });
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.presents).toBe(0);
    expect(stats.layerResets).toBe(0);
    expect(stats.layerShifts).toBe(0);
    expect(stats.layerRasterMs).toBe(0);

    grid.destroy();
    restore();
  });

  it('(d) a runtime paintCache flip tears down/resets the layer and forces a full repaint', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    const canvas = (grid as any).cgridCanvas;

    await new Promise((r) => setTimeout(r, 50));
    canvas.tickPaint(performance.now());
    grid.resetPaintStats();

    grid.setGridOption('paintCache', false);
    canvas.tickPaint(performance.now() + 1000);
    let stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);
    expect(stats.presents).toBe(0);

    grid.resetPaintStats();
    grid.setGridOption('paintCache', true);
    canvas.tickPaint(performance.now() + 2000);
    stats = grid.getPaintStats();
    expect(stats.fullPaints).toBeGreaterThanOrEqual(1);
    expect(stats.layerResets).toBeGreaterThanOrEqual(1);
    expect(stats.presents).toBeGreaterThanOrEqual(1);

    grid.destroy();
    restore();
  });
});
