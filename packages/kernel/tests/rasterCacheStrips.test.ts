/**
 * Cycle 22 / Task 3 — Tier-2 row-strip cache integration: capture/consume
 * in the retained layer's band raster (`Renderer.paintLayer`) + CGrid
 * wiring (eligibility, rowVersionByRowId, layoutEpoch bump sites,
 * patch-on-tick from the cell-damage path, PaintStats strip counters).
 *
 * Renderer-level tests use the recorded-gc idiom from
 * tests/rendererPaintCache.test.ts plus the fake canvas factory from
 * tests/rasterCacheCore.test.ts. CGrid-level tests use the buildWiredGrid
 * idiom (real worker host, mocked canvases).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { Renderer, type RendererOpts } from '../src/renderer/renderer';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import type { Subgrid } from '../src/core/subgrid';
import type { PaintCacheCanvasFactory } from '../src/core/paintCache';
import type { RasterStripsCtx } from '../src/renderer/painters/types';
import { RasterBudget, RowStripCache } from '../src/renderer/rasterCache';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types/options';

// ─── fakeGc (rendererPaintCache.test.ts idiom + setTransform + .canvas) ──────

interface RecordedCall { m: string; args: unknown[] }

function fakeGc(canvas?: { width: number; height: number }): { gc: CachedContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const rec = (m: string) => (...args: unknown[]) => { calls.push({ m, args }); };
  const ctx: any = {
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
    save: rec('save'), restore: rec('restore'),
    rect: rec('rect'), clip: rec('clip'), beginPath: rec('beginPath'), stroke: rec('stroke'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), closePath: rec('closePath'),
    translate: rec('translate'), scale: rec('scale'), drawImage: rec('drawImage'),
    setTransform: rec('setTransform'),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  if (canvas) ctx.canvas = canvas;
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

// ─── fake canvas factory (rasterCacheCore.test.ts idiom) ─────────────────────

function makeFakeFactory(): { factory: PaintCacheCanvasFactory } {
  const factory = (): any => {
    const canvas: any = { width: 0, height: 0 };
    const ctx: any = {
      canvas,
      setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(),
      clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
    };
    canvas.getContext = () => ctx;
    return canvas;
  };
  return { factory: factory as unknown as PaintCacheCanvasFactory };
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

// Header row (0..32) + 2 data rows (32..62, 62..92); bodyTop=32, bodyBottom=92.
function makeVs(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: CANVAS_W, width: CANVAS_W },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 32, bottom: 62, height: 30 },
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 2, top: 62, bottom: 92, height: 30 },
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

function makeStrips(over: Partial<RasterStripsCtx> = {}): { ctx: RasterStripsCtx; cache: RowStripCache } {
  const { factory } = makeFakeFactory();
  const cache = new RowStripCache(new RasterBudget(64 * 1024 * 1024), factory);
  const ctx: RasterStripsCtx = {
    cache,
    dpr: 1,
    rowVersionOf: () => 0,
    stringRowIdAt: (ri) => `r${ri}`,
    eligible: () => true,
    layoutEpoch: () => 0,
    stats: { stripHits: 0, stripMisses: 0, stripCaptures: 0, stripPatches: 0 },
    ...over,
  };
  return { ctx, cache };
}

describe('Renderer.paintLayer — Tier-2 strip capture/consume (Task 3)', () => {
  it('capture-then-consume round trip: second raster blits untransformed device-px strips and skips the painter rows + their gridlines', () => {
    const { reg, hits } = makeSpyRegistry();
    const { ctx: strips } = makeStrips();
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterStrips: () => strips } as Partial<RendererOpts>));

    // Pass 1 — full layer raster: both data rows paint live and get captured.
    const { gc: gc1 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc1, makeVs(), true, []);
    expect(hits.filter((h) => h === 'text')).toHaveLength(2);
    expect(strips.stats!.stripCaptures).toBe(2);
    expect(strips.cache.stats().entries).toBe(2);

    // Pass 2 — same versions/epoch: both rows consume from the cache.
    const before = hits.length;
    const { gc: gc2, calls: calls2 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc2, makeVs(), true, []);
    expect(hits.length).toBe(before); // no live cell paints
    expect(strips.stats!.stripHits).toBe(2);

    // The blits are untransformed device-px copies: setTransform(identity)
    // then drawImage with device-space dest y (row.top - bodyTop) * dpr.
    const st = calls2.findIndex((c) => c.m === 'setTransform'
      && c.args.join(',') === '1,0,0,1,0,0');
    expect(st).toBeGreaterThanOrEqual(0);
    const blits = calls2.filter((c) => c.m === 'drawImage');
    expect(blits).toHaveLength(2);
    expect(blits.map((b) => b.args[6])).toEqual([0, 30]); // dest y device px
    expect(blits.map((b) => b.args[8])).toEqual([30, 30]); // dest h device px

    // Blitted rows' horizontal gridlines are skipped (they come WITH the
    // strip): no 1px hairline fillRect at round(row.bottom)-1 (61 / 91).
    const hairlines = calls2.filter((c) => c.m === 'fillRect' && c.args[3] === 1);
    expect(hairlines.some((c) => c.args[1] === 61 || c.args[1] === 91)).toBe(false);
  });

  it('dpr=2 — capture src and blit dest are DEVICE px (the C1 lesson applied to strips)', () => {
    const { ctx: strips, cache } = makeStrips({ dpr: 2 });
    const captureSpy = vi.spyOn(cache, 'capture');
    const renderer = new Renderer(makeOpts({ getRasterStrips: () => strips } as Partial<RendererOpts>));

    const { gc: gc1 } = fakeGc({ width: CANVAS_W * 2, height: 400 });
    renderer.paintLayer(gc1, makeVs(), true, []);
    // Row 1: srcY (32-32)*2 = 0, h 60; Row 2: srcY 60, h 60. Width = the
    // layer backing store's own device width.
    expect(captureSpy).toHaveBeenCalledTimes(2);
    expect(captureSpy.mock.calls.map((c) => [c[2], c[3], c[4]])).toEqual([
      [0, CANVAS_W * 2, 60],
      [60, CANVAS_W * 2, 60],
    ]);

    const { gc: gc2, calls: calls2 } = fakeGc({ width: CANVAS_W * 2, height: 400 });
    renderer.paintLayer(gc2, makeVs(), true, []);
    const blits = calls2.filter((c) => c.m === 'drawImage');
    expect(blits.map((b) => b.args[6])).toEqual([0, 60]); // dest y device px
  });

  it('overlays are never captured: capture runs strictly after gridlines and strictly before the overlay bake', () => {
    const { ctx: strips, cache } = makeStrips({
      // Focused row (1) is ineligible — the contract cgrid enforces; row 2
      // stays eligible so a capture happens in the same pass as the overlay.
      eligible: (ri) => ri !== 1,
    });
    const { gc, calls } = fakeGc({ width: CANVAS_W, height: 200 });
    const origCapture = cache.capture.bind(cache);
    vi.spyOn(cache, 'capture').mockImplementation((...args: any[]) => {
      calls.push({ m: 'CAPTURE', args: [] });
      return (origCapture as any)(...args);
    });
    const renderer = new Renderer(makeOpts({
      getRasterStrips: () => strips,
      getSelection: () => ({
        focusedRowIndex: 1, focusedColId: 'a',
        selectedRowIndices: new Set<number>(), ranges: [],
      }),
      getVisibleCellBounds: () => ({ x: 0, y: 32, w: CANVAS_W, h: 30 }),
    } as Partial<RendererOpts>));

    renderer.paintLayer(gc, makeVs(), true, []);

    const capIdx = calls.findIndex((c) => c.m === 'CAPTURE');
    const ringIdx = calls.findIndex((c) => c.m === 'strokeRect'); // focus ring
    const lastText = calls.map((c) => c.m).lastIndexOf('fillText'); // cell paints
    expect(capIdx).toBeGreaterThanOrEqual(0);
    expect(ringIdx).toBeGreaterThanOrEqual(0);
    expect(capIdx).toBeGreaterThan(lastText); // after cells (and gridlines)
    expect(capIdx).toBeLessThan(ringIdx); // before the overlay bake
  });

  it('ineligible rows bypass BOTH capture and consume', () => {
    const { reg, hits } = makeSpyRegistry();
    const { ctx: strips } = makeStrips({ eligible: (ri) => ri !== 1 });
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterStrips: () => strips } as Partial<RendererOpts>));

    const { gc: gc1 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc1, makeVs(), true, []);
    expect(strips.cache.stats().entries).toBe(1); // only row 2 captured

    // Seed a strip for row 1 manually — even with a strip present, an
    // ineligible row must never consume it.
    strips.cache.capture({ rowId: 'r1', rowVersion: 0, layoutEpoch: 0 }, {} as any, 0, CANVAS_W, 30);
    const before = hits.filter((h) => h === 'text').length;
    const { gc: gc2 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc2, makeVs(), true, []);
    // Row 1 painted live again; row 2 consumed.
    expect(hits.filter((h) => h === 'text').length).toBe(before + 1);
    expect(strips.stats!.stripHits).toBe(1);
  });

  it('a row-version bump forces a miss + live repaint + fresh capture; the next raster hits at the new version', () => {
    const { reg, hits } = makeSpyRegistry();
    const versions = new Map<number, number>();
    const { ctx: strips } = makeStrips({ rowVersionOf: (ri) => versions.get(ri) ?? 0 });
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterStrips: () => strips } as Partial<RendererOpts>));

    const { gc: gc1 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc1, makeVs(), true, []);
    versions.set(1, 1); // row 1 damaged (tick) — version advances

    const before = hits.filter((h) => h === 'text').length;
    const { gc: gc2 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc2, makeVs(), true, []);
    expect(hits.filter((h) => h === 'text').length).toBe(before + 1); // row 1 live
    expect(strips.cache.get('r1', 1, 0)).not.toBeNull(); // re-captured at v1

    const before2 = hits.filter((h) => h === 'text').length;
    const { gc: gc3 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc3, makeVs(), true, []);
    expect(hits.filter((h) => h === 'text').length).toBe(before2); // both consume now
  });

  it('layoutEpochBump forces a full live re-raster and re-capture at the new epoch', () => {
    const { reg, hits } = makeSpyRegistry();
    let epoch = 0;
    const { ctx: strips, cache } = makeStrips({ layoutEpoch: () => epoch });
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterStrips: () => strips } as Partial<RendererOpts>));

    const { gc: gc1 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc1, makeVs(), true, []);
    expect(cache.stats().entries).toBe(2);

    epoch = 1;
    cache.layoutEpochBump();
    const before = hits.filter((h) => h === 'text').length;
    const { gc: gc2 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc2, makeVs(), true, []);
    expect(hits.filter((h) => h === 'text').length).toBe(before + 2); // all live
    expect(cache.get('r1', 0, 1)).not.toBeNull(); // re-captured at epoch 1
  });

  it('partial rasters only capture rows FULLY covered by a full-width rect (a cell-sized rect never captures)', () => {
    const { ctx: strips } = makeStrips();
    const renderer = new Renderer(makeOpts({ getRasterStrips: () => strips } as Partial<RendererOpts>));

    // Cell-sized damage (not full row width) — no capture.
    const { gc: gc1 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc1, makeVs(), false, [{ x: 10, y: 32, w: 50, h: 30 }]);
    expect(strips.stats!.stripCaptures).toBe(0);

    // Full-width single-row band — captures exactly that row.
    const { gc: gc2 } = fakeGc({ width: CANVAS_W, height: 200 });
    renderer.paintLayer(gc2, makeVs(), false, [{ x: 0, y: 32, w: CANVAS_W, h: 30 }]);
    expect(strips.stats!.stripCaptures).toBe(1);
    expect(strips.cache.get('r1', 0, 0)).not.toBeNull();
    expect(strips.cache.get('r2', 0, 0)).toBeNull();
  });

  it('strip-path-absent call sequences stay byte-identical: getRasterStrips undefined vs () => null', () => {
    const rendererA = new Renderer(makeOpts());
    const rendererB = new Renderer(makeOpts({ getRasterStrips: () => null } as Partial<RendererOpts>));
    const { gc: gcA, calls: callsA } = fakeGc({ width: CANVAS_W, height: 200 });
    const { gc: gcB, calls: callsB } = fakeGc({ width: CANVAS_W, height: 200 });
    rendererA.paintLayer(gcA, makeVs(), true, []);
    rendererB.paintLayer(gcB, makeVs(), true, []);
    expect(callsB).toEqual(callsA);

    const { gc: gcA2, calls: callsA2 } = fakeGc({ width: CANVAS_W, height: 200 });
    const { gc: gcB2, calls: callsB2 } = fakeGc({ width: CANVAS_W, height: 200 });
    rendererA.paintLayer(gcA2, makeVs(), false, [{ x: 0, y: 32, w: CANVAS_W, h: 30 }]);
    rendererB.paintLayer(gcB2, makeVs(), false, [{ x: 0, y: 32, w: CANVAS_W, h: 30 }]);
    expect(callsB2).toEqual(callsA2);
  });
});

// ─── CGrid-level integration ─────────────────────────────────────────────────

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

afterEach(() => {
  delete (window as any).devicePixelRatio;
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

async function settle(grid: CGrid<any>, ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  ((grid as any).cgridCanvas).tickPaint(performance.now());
}

describe('CGrid + Tier-2 strips — eligibility, versions, epochs, patch (Task 3)', () => {
  it('paints capture strips for plain data rows; PaintStats carries the four strip counters', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    const strips = g.rasterStrips;
    expect(strips).not.toBeNull();
    expect(strips.stats().entries).toBeGreaterThan(0);
    const stats = grid.getPaintStats();
    expect(stats.stripCaptures).toBeGreaterThan(0);
    expect(stats.stripHits).toBeGreaterThanOrEqual(0);
    expect(stats.stripMisses).toBeGreaterThan(0);
    expect(stats.stripPatches).toBe(0);
    grid.resetPaintStats();
    expect(grid.getPaintStats().stripCaptures).toBe(0);
    grid.destroy();
    restore();
  });

  it('eligible() enforces the full contract: hover, selection, focus, flash, quick-filter', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    const ctx = g.getRasterStripsCtx();
    expect(ctx).not.toBeNull();

    expect(ctx.eligible(4)).toBe(true);

    g.hoveredRowIndex = 4;
    expect(ctx.eligible(4)).toBe(false);
    g.hoveredRowIndex = null;

    g.selection.state.selectedRowIndices.add(5);
    expect(ctx.eligible(5)).toBe(false);
    g.selection.state.selectedRowIndices.delete(5);

    g.selection.state.focusedRowIndex = 6;
    expect(ctx.eligible(6)).toBe(false);
    g.selection.state.focusedRowIndex = null;

    const nid = g.chunk.rowIds[7];
    g.options.enableCellChangeFlash = true;
    g.flashRegistry.flash(nid, 'v');
    expect(ctx.eligible(7)).toBe(false);
    expect(ctx.eligible(8)).toBe(true); // other rows unaffected
    g.flashRegistry.destroy();

    g.quickFilterLowerTerms = ['zz'];
    expect(ctx.eligible(9)).toBe(false); // active quick filter → global bypass
    g.quickFilterLowerTerms = [];

    grid.destroy();
    restore();
  });

  it("'rows' damage bumps rowVersionByRowId for each damaged row", async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    g.repaintRows([3, 4]);
    expect(g.rowVersionByRowId.get('r3')).toBe(1);
    expect(g.rowVersionByRowId.get('r4')).toBe(1);
    expect(g.rowVersionByRowId.get('r5')).toBeUndefined();
    grid.destroy();
    restore();
  });

  it('patch-on-tick: cell damage bumps the version, patches the strip in place, and the next consume hits', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    const strips = g.rasterStrips;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(strips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    // 'id' is NOT the last column in its band → patchable.
    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(g.rowVersionByRowId.get(sid)).toBe(1);
    expect(grid.getPaintStats().stripPatches).toBeGreaterThanOrEqual(1);
    // Patch advanced the stored version — the next consume hits.
    expect(strips.get(sid, 1, g.stripLayoutEpoch)).not.toBeNull();
    grid.destroy();
    restore();
  });

  it('an unpatchable cell (last column in its band) invalidates the strip instead of leaving it stale', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    const strips = g.rasterStrips;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(strips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    // 'v' is the LAST center-band column — its right edge is the band
    // boundary, not an interior gridline → conservative bypass: the strip
    // must be dropped, never patched or left claiming any version.
    g.repaintCells([{ rowId: nid, colId: 'v' }]);
    expect(g.rowVersionByRowId.get(sid)).toBe(1);
    expect(strips.get(sid, 0, g.stripLayoutEpoch)).toBeNull();
    expect(strips.get(sid, 1, g.stripLayoutEpoch)).toBeNull();
    grid.destroy();
    restore();
  });

  it('patch is called with the LIVE dpr (carry-forward: dpr=2 strips corrupt without it)', async () => {
    (window as any).devicePixelRatio = 2;
    const { RowStripCache: RSC } = await import('../src/renderer/rasterCache');
    const patchSpy = vi.spyOn(RSC.prototype, 'patch');
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(g.rasterStrips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(patchSpy).toHaveBeenCalled();
    const lastCall = patchSpy.mock.calls[patchSpy.mock.calls.length - 1]!;
    expect(lastCall[5]).toBe(2); // trailing dpr arg — LIVE dpr, not the default 1
    patchSpy.mockRestore();
    grid.destroy();
    restore();
  });

  it('patch paint closure flattens the span over the opaque surface bg before the row bg (Task 4)', async () => {
    // Cycle 22 / Task 4 — same flatten contract the Tier-1 miss scratch
    // follows (see rasterCacheCells.test.ts): `RowStripCache.patch` CLEARS
    // the span to transparent before invoking the closure, so a closure
    // that opens with a translucent row bg (cursor-dark's 2%-alpha zebra)
    // would store double-composited premultiplied pixels — up to ~5 LSB
    // off the live raster at consume time. The closure must fill the
    // opaque `theme.bg` first, then the row bg only when it differs —
    // the exact op order the live layer raster uses (band theme.bg fill,
    // then the row-bg bundle, then the painter).
    const { RowStripCache: RSC } = await import('../src/renderer/rasterCache');
    const patchSpy = vi.spyOn(RSC.prototype, 'patch');
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(g.rasterStrips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    g.repaintCells([{ rowId: nid, colId: 'id' }]); // row 3 is odd → rowBg = rowAltBg ≠ theme.bg
    expect(patchSpy).toHaveBeenCalled();
    const paintClosure = patchSpy.mock.calls[patchSpy.mock.calls.length - 1]![4] as (sgc: any) => void;

    // Replay the captured closure against a color-logging gc.
    const fills: Array<{ color: string; args: number[] }> = [];
    let fillStyle = '';
    const sgc: any = {
      fillRect: (...a: number[]) => { fills.push({ color: fillStyle, args: a }); },
      fillText: () => {}, save: () => {}, restore: () => {},
      beginPath: () => {}, rect: () => {}, clip: () => {}, stroke: () => {},
      moveTo: () => {}, lineTo: () => {}, setTransform: () => {}, clearRect: () => {},
      drawImage: () => {}, translate: () => {}, scale: () => {},
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
    };
    Object.defineProperty(sgc, 'fillStyle', { get: () => fillStyle, set: (v: string) => { fillStyle = v; } });
    sgc.cache = new Proxy(sgc, {
      get(target, key) { return target[key]; },
      set(target, key, value) { target[key] = value; return true; },
    });
    paintClosure(sgc);

    const themeBg = g.theme.bg;
    const rowAltBg = g.theme.rowAltBg;
    expect(rowAltBg).not.toBe(themeBg); // fixture sanity — the two-fill case is actually exercised
    // Fill order: opaque surface base first, then the row bg — both
    // full-span — before anything else lands.
    expect(fills.length).toBeGreaterThanOrEqual(2);
    expect(fills[0]!.color).toBe(themeBg);
    expect(fills[1]!.color).toBe(rowAltBg);
    expect(fills[0]!.args).toEqual(fills[1]!.args);
    patchSpy.mockRestore();
    grid.destroy();
    restore();
  });

  it('layoutEpoch bumps on: column resize, quick-filter term change, sort change, theme param change', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;

    let e = g.stripLayoutEpoch;
    g.resizeColumn('id', 10);
    expect(g.stripLayoutEpoch).toBeGreaterThan(e);

    e = g.stripLayoutEpoch;
    grid.setGridOption('quickFilterText', 'zz');
    expect(g.stripLayoutEpoch).toBeGreaterThan(e);

    e = g.stripLayoutEpoch;
    grid.setSortModel([{ colId: 'v', direction: 'desc' }]);
    expect(g.stripLayoutEpoch).toBeGreaterThan(e);

    e = g.stripLayoutEpoch;
    grid.setThemeParams({ '--cg-bg-color': '#123456' });
    expect(g.stripLayoutEpoch).toBeGreaterThan(e);

    grid.destroy();
    restore();
  });

  it('layoutEpoch bumps on column-group open/close (Task 1 carry-forward #2)', async () => {
    const groupedCols = [
      {
        groupId: 'g', headerName: 'G',
        children: [{ field: 'id' }, { field: 'v', columnGroupShow: 'open' }],
      },
    ];
    const { grid, restore } = buildWiredGrid(rows(50), groupedCols);
    await settle(grid);
    const g = grid as any;
    const e = g.stripLayoutEpoch;
    g.toggleColumnGroup('g');
    expect(g.stripLayoutEpoch).toBeGreaterThan(e);
    grid.destroy();
    restore();
  });

  it('an unknown-diff chunk (windowDamage full — e.g. setRowData) wipes every strip', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    expect(g.rasterStrips.stats().entries).toBeGreaterThan(0);
    const oldEpoch = g.stripLayoutEpoch;
    expect(g.rasterStrips.get('r3', 0, oldEpoch)).not.toBeNull();
    g.rowVersionByRowId.set('r3', 5);

    grid.setRowData(rows(50));
    await new Promise((r) => setTimeout(r, 100));

    // The wipe advanced the epoch and cleared the version map — any strip
    // present NOW is a fresh post-wipe capture of the NEW data (happy-dom's
    // own rAF repaints during the wait), never a pre-setRowData survivor.
    expect(g.stripLayoutEpoch).toBeGreaterThan(oldEpoch);
    expect(g.rasterStrips.get('r3', 5, oldEpoch)).toBeNull();
    expect(g.rowVersionByRowId.get('r3')).toBeUndefined();
    grid.destroy();
    restore();
  });

  it('version bookkeeping keeps tracking damage while suppressPartialRepaint is active (no stale strips after flipping it back off)', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    g.options.suppressPartialRepaint = true;
    g.repaintRows([3]);
    const nid = g.chunk.rowIds[4];
    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(g.rowVersionByRowId.get('r3')).toBe(1);
    expect(g.rowVersionByRowId.get('r4')).toBe(1);
    grid.destroy();
    restore();
  });

  it('a cellIcon fn that returns null (format-compiled columns synthesize one on EVERY def) does not bail the patch (closeout I-3)', async () => {
    // Root cause of stripPatches=0 in production: resolveColDefWithFormat
    // synthesizes a `cellIcon` FUNCTION for every format-compiled column
    // (it returns null unless the format carries an icon()), and the patch
    // path bailed on mere function EXISTENCE — so every ticking numeric
    // column dropped its row's strip on first tick, and cell-sized rasters
    // can never recapture. The bail must use byRows' ACTUAL decision:
    // does the icon fn resolve to something that WILL DRAW for this cell?
    const iconCols = [
      { field: 'id', cellIcon: () => null },
      { field: 'v', type: 'number' },
    ];
    const { grid, restore } = buildWiredGrid(rows(200), iconCols as any);
    await settle(grid);
    const g = grid as any;
    const strips = g.rasterStrips;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(strips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(g.rowVersionByRowId.get(sid)).toBe(1);
    expect(grid.getPaintStats().stripPatches, 'a null-returning cellIcon fn must not kill the patch').toBeGreaterThanOrEqual(1);
    expect(strips.get(sid, 1, g.stripLayoutEpoch), 'strip must be patched, not dropped').not.toBeNull();
    grid.destroy();
    restore();
  });

  it('a cellIcon that WOULD draw still bails the patch and drops the strip (closeout I-3, conservative arm)', async () => {
    const iconCols = [
      { field: 'id', cellIcon: () => ({ emoji: '▲' }) },
      { field: 'v', type: 'number' },
    ];
    const { grid, restore } = buildWiredGrid(rows(200), iconCols as any);
    await settle(grid);
    const g = grid as any;
    const strips = g.rasterStrips;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(strips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(g.rowVersionByRowId.get(sid)).toBe(1);
    expect(grid.getPaintStats().stripPatches, 'a drawable icon must never be patched over').toBe(0);
    expect(strips.get(sid, 0, g.stripLayoutEpoch)).toBeNull();
    expect(strips.get(sid, 1, g.stripLayoutEpoch)).toBeNull();
    grid.destroy();
    restore();
  });

  it('flash-fade rAF ticks do not churn strip versions or re-patch settled spans (closeout I-4)', async () => {
    // Every fading cell re-enters the cell-damage path per animation frame
    // (~90 frames per 1.5s fade). Fade frames carry NO content change — the
    // original tick's damage already bumped the version and patched the
    // strip — so per-rAF version bumps + re-patches of the same settled
    // span are pure hot-path waste (and a bump without a patch would force
    // a needless full-row re-raster at fade settle).
    const { grid, restore } = buildWiredGrid(rows(200), cols, { enableCellChangeFlash: true });
    await settle(grid);
    const g = grid as any;
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(g.rasterStrips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();

    // The tick itself: flash + content damage → version 1, strip patched.
    g.flashRegistry.flash(nid, 'id');
    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(g.rowVersionByRowId.get(sid)).toBe(1);
    const patchesAfterTick = grid.getPaintStats().stripPatches;
    expect(patchesAfterTick).toBeGreaterThanOrEqual(1);

    // Fade animation: rAF ticks re-request repaints for the fading cell.
    for (let i = 0; i < 10; i++) g.flashRegistry.tick(performance.now());
    expect(g.rowVersionByRowId.get(sid), 'fade frames must not bump row versions').toBe(1);
    expect(grid.getPaintStats().stripPatches, 'fade frames must not re-patch the settled span').toBe(patchesAfterTick);
    grid.destroy();
    restore();
  });

  it('a live transaction tick patches retained strips at the chunk-arrival seam (closeout I-3, production wiring)', async () => {
    // The instrumented live-feed run showed the fade rAF loop was the ONLY
    // caller of the patch path (and I-4 rightly removed it): the tick
    // itself — the worker's diff-armed chunk reply — never attempted a
    // patch, so `stripPatches` was 0 in production by wiring, not by bail.
    // The chunk's flashMask IS the tick's cell-granular diff; the seam in
    // `handleViewportChunk` must patch retained strips from it, AFTER
    // `repaintRows` bumped the touched rows, so the patched strip is
    // current at the row's final post-tick version.
    const cols3 = [{ field: 'id' }, { field: 'v', type: 'number' }, { field: 'w', type: 'number' }];
    const data = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, v: i, w: i }));
    const { grid, restore } = buildWiredGrid(data, cols3, { enableCellChangeFlash: true });
    await settle(grid);
    const g = grid as any;
    const canvas = g.cgridCanvas;
    expect(g.rasterStrips.get('r3', 0, g.stripLayoutEpoch)).not.toBeNull();

    // Tick a MIDDLE column (v — not last-in-band, no icon) through the
    // real async-transaction path: worker TransactionQueue (50ms) →
    // modelUpdated push → getViewport round-trip → handleViewportChunk.
    grid.applyTransactionAsync({ update: [{ id: 'r3', v: 999, w: 3 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());

    expect(grid.getPaintStats().stripPatches, 'the tick itself must patch the retained strip').toBeGreaterThanOrEqual(1);
    const ver = g.rowVersionByRowId.get('r3') as number;
    expect(ver).toBeGreaterThanOrEqual(1);
    expect(g.rasterStrips.get('r3', ver, g.stripLayoutEpoch),
      'strip must be current at the final post-tick version (patch AFTER the repaintRows bump)').not.toBeNull();
    grid.destroy();
    restore();
  });

  it('a row whose tick-time patch bailed re-captures once its flash settles (closeout I-3, recapture seam)', async () => {
    // When the damaged span can't be patched (here: the LAST center-band
    // column — band-edge line, conservative bypass) the strip is dropped.
    // While the row flashes it is strip-ineligible, and after settling
    // nothing ever damages it full-width again — without the settle seam
    // it would paint live at every subsequent raster forever (the exact
    // cold-strips shape the closeout measured). The flash registry's
    // `onRowsSettled` must trigger ONE row repaint whose raster
    // re-captures the settled row.
    const cols3 = [{ field: 'id' }, { field: 'v', type: 'number' }, { field: 'w', type: 'number' }];
    const data = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, v: i, w: i }));
    const { grid, restore } = buildWiredGrid(data, cols3, { enableCellChangeFlash: true });
    await settle(grid);
    const g = grid as any;
    const canvas = g.cgridCanvas;
    expect(g.rasterStrips.get('r3', 0, g.stripLayoutEpoch)).not.toBeNull();

    // Tick the LAST center-band column (w) — the patch must bail and drop
    // the strip (a band-edge span is a conservative bypass, not patchable).
    grid.applyTransactionAsync({ update: [{ id: 'r3', v: 3, w: 999 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());
    expect(g.rasterStrips.has('r3'), 'last-in-band tick must drop the strip, not patch it').toBe(false);
    const verAfterTick = g.rowVersionByRowId.get('r3') as number;

    // Flash expiry: drive the registry past flash+fade. `onRowsSettled`
    // fires for r3 (strip missing) → one row-level repaint is queued.
    g.flashRegistry.tick(performance.now() + 60_000);
    expect(g.flashRegistry.hasRow(g.chunk.rowIds[3]!)).toBe(false);
    canvas.tickPaint(performance.now() + 60_100);

    const verSettled = g.rowVersionByRowId.get('r3') as number;
    expect(verSettled, 'the settle repaint must bump the row version').toBeGreaterThan(verAfterTick);
    expect(g.rasterStrips.get('r3', verSettled, g.stripLayoutEpoch),
      'the settled full-width raster must re-capture the row').not.toBeNull();
    grid.destroy();
    restore();
  });

  it('a tick on a raw field feeding a VISIBLE calc column drops the strip instead of patching (closeout N-1)', async () => {
    // The tick seam's damage is RAW-FIELD-granular (flashMask =
    // diffRowFields ∧ column.field), yet a committed patch advances the
    // strip to FULL-ROW validity. A calc column computed from the ticked
    // field is fieldless — NEVER flagged by construction — so its span
    // would survive the patch with PRE-TICK pixels, and the settle
    // recapture (which skips "patched & current" strips) would let the
    // next consume serve them at rest. With a calc provider registered
    // and ≥1 calc column visible, the patch must bail: drop the strip
    // (versions keep tracking; the settle recapture heals the row).
    const cols3 = [{ field: 'id' }, { field: 'v', type: 'number' }, { field: 'w', type: 'number' }];
    const data = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, v: i, w: i }));
    const { grid, restore } = buildWiredGrid(data, cols3, { enableCellChangeFlash: true });
    grid.registerCalcProvider({
      // A visible calc column derived from `v` (the field we tick). The
      // program itself is irrelevant to the strip bookkeeping — the
      // hazard is structural: fieldless ⇒ never in the flashMask.
      synthesizedColDefs: () => [{
        colId: 'vTotal', headerName: 'V total', cellDataType: 'number',
        editable: false, __calcColumn: true,
      }],
      resolvedPatchFor: () => null,
      workerProgram: () => null,
      onColumnsChanged: () => () => {},
    });
    await settle(grid, 200); // registration → rebuild + updateColumns → recapture
    const g = grid as any;
    const canvas = g.cgridCanvas;
    expect(g.viewport.visibleColumns.some((c: any) => c.colId === 'vTotal'),
      'precondition: the calc column must be VISIBLE').toBe(true);
    expect(g.rasterStrips.get('r3', g.rowVersionByRowId.get('r3') ?? 0, g.stripLayoutEpoch),
      'precondition: r3 must be strip-cached').not.toBeNull();
    grid.resetPaintStats();

    // Tick v — a MIDDLE raw column that WOULD patch (see the I-3
    // production-wiring test) were the calc hazard absent — through the
    // real async-transaction path.
    grid.applyTransactionAsync({ update: [{ id: 'r3', v: 999, w: 3 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());

    expect(grid.getPaintStats().stripPatches,
      'no patch may commit while a visible calc column is live — its span would go stale').toBe(0);
    expect(g.rasterStrips.has('r3'),
      'the strip must be DROPPED — a patched strip would serve the pre-tick calc span at rest').toBe(false);
    const verAfterTick = g.rowVersionByRowId.get('r3') as number;
    expect(verAfterTick, 'versions must keep tracking through the bail').toBeGreaterThanOrEqual(1);

    // The heal path the bail relies on: flash expiry → onRowsSettled →
    // one full-width row repaint re-captures the settled row (calc span
    // included, painted live from current data).
    g.flashRegistry.tick(performance.now() + 60_000);
    canvas.tickPaint(performance.now() + 60_100);
    const verSettled = g.rowVersionByRowId.get('r3') as number;
    expect(g.rasterStrips.get('r3', verSettled, g.stripLayoutEpoch),
      'the settle recapture must heal the dropped strip').not.toBeNull();

    const { _resetCalcProvider_forTests } = await import('../src/core/calcSlot');
    _resetCalcProvider_forTests();
    grid.destroy();
    restore();
  });

  it('a rule engine with ≥1 rule (or an unknown rule set) bails the patch; an EMPTY rule set keeps patch-on-tick alive (closeout N-1)', async () => {
    // Row-scope rule STYLES can repaint spans whose own field never
    // ticked (the ruleIndicator bail covers indicators only), so any
    // registered engine with ≥1 rule must bail the patch. An engine that
    // doesn't expose getRules has an UNKNOWN rule set — ambiguous, and
    // ambiguous means BYPASS. An engine with ZERO rules is provably
    // hazard-free and must NOT kill patch-on-tick (the perf win stays).
    const cols3 = [{ field: 'id' }, { field: 'v', type: 'number' }, { field: 'w', type: 'number' }];
    const data = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, v: i, w: i }));
    const { grid, restore } = buildWiredGrid(data, cols3, { enableCellChangeFlash: true });
    await settle(grid);
    const g = grid as any;
    const canvas = g.cgridCanvas;
    let rules: any[] = [];
    grid.registerRuleEngine({
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => null,
      getRules: () => rules,
      setRules: (r: any[]) => { rules = r; },
    });
    await settle(grid); // registration epoch bump → recapture

    // Arm 1 — ZERO rules: the tick must still patch (no over-bail).
    expect(g.rasterStrips.get('r3', g.rowVersionByRowId.get('r3') ?? 0, g.stripLayoutEpoch)).not.toBeNull();
    grid.resetPaintStats();
    grid.applyTransactionAsync({ update: [{ id: 'r3', v: 999, w: 3 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());
    expect(grid.getPaintStats().stripPatches,
      'an empty rule set is hazard-free — the tick must still patch').toBeGreaterThanOrEqual(1);

    // Arm 2 — ≥1 rule: the tick must bail and drop.
    grid.addRule({ id: 'n1', enabled: true }); // epoch bump + wipe (C-2)
    g.repaintFull(); // full-width damage → the settle paint re-captures
    await settle(grid);
    const ver0 = g.rowVersionByRowId.get('r5') ?? 0;
    expect(g.rasterStrips.get('r5', ver0, g.stripLayoutEpoch)).not.toBeNull();
    grid.resetPaintStats();
    grid.applyTransactionAsync({ update: [{ id: 'r5', v: 999, w: 5 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());
    expect(grid.getPaintStats().stripPatches,
      'no patch may commit with a live rule — row-scope styles can repaint unflagged spans').toBe(0);
    expect(g.rasterStrips.has('r5'), 'the strip must be dropped, not patched').toBe(false);

    // Arm 3 — engine WITHOUT getRules: unknown rule set → ambiguous → bail.
    grid.registerRuleEngine({
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => null,
    });
    g.repaintFull();
    await settle(grid);
    const ver7 = g.rowVersionByRowId.get('r7') ?? 0;
    expect(g.rasterStrips.get('r7', ver7, g.stripLayoutEpoch)).not.toBeNull();
    grid.resetPaintStats();
    grid.applyTransactionAsync({ update: [{ id: 'r7', v: 999, w: 7 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());
    expect(grid.getPaintStats().stripPatches,
      'an unknown rule set is ambiguous — ambiguous means BYPASS').toBe(0);
    expect(g.rasterStrips.has('r7')).toBe(false);

    const { _resetRuleEngine_forTests } = await import('../src/core/ruleEngineSlot');
    _resetRuleEngine_forTests();
    grid.destroy();
    restore();
  });

  it('a tick on a raw field feeding a VISIBLE compiled format program drops the strip instead of patching (closeout format-program adjudication)', async () => {
    // Every compiled format program evaluates against the FULL row
    // (`FormatEvalCtxShape.row`): a program on column w reading field v
    // means a tick on v changes w's formatted pixels while the flashMask
    // flags only v — a committed patch would advance the strip to
    // full-row validity with w's PRE-TICK formatted span, and the settle
    // recapture (which skips "patched & current" strips) would let the
    // next consume serve it at rest. The `tiers` flags cannot prove
    // row-independence (`=expr` is tier0-flagged yet row-reading), so
    // ANY visible compiled program must bail the patch: drop the strip
    // (versions keep tracking; the settle recapture heals the row).
    const { registerFormatCompiler, _resetFormatCompiler_forTests } =
      await import('../src/core/formatCompilerSlot');
    // Structural compiler double — column w's TEXT is derived from
    // row.v, the exact cross-field shape of the finding.
    registerFormatCompiler((src) => ({
      ok: true,
      program: {
        formatText: (ctx) => `${String((ctx.row as Record<string, unknown> | undefined)?.v ?? '')}|${String(ctx.value)}`,
        resolveStyle: () => null,
        resolveIcon: () => null,
        resolveFragments: () => null,
        source: src,
        tiers: { tier0: true, tier1: false, tier2: false },
      },
    }));
    const cols3 = [
      { field: 'id' },
      { field: 'v', type: 'number' },
      { field: 'w', type: 'number', valueFormatter: '=[v] cross-field' },
    ];
    const data = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, v: i, w: i }));
    const { grid, restore } = buildWiredGrid(data, cols3, { enableCellChangeFlash: true });
    await settle(grid);
    const g = grid as any;
    const canvas = g.cgridCanvas;
    expect(g.rasterStrips.get('r3', g.rowVersionByRowId.get('r3') ?? 0, g.stripLayoutEpoch),
      'precondition: r3 must be strip-cached').not.toBeNull();
    grid.resetPaintStats();

    // Tick v — a MIDDLE raw column that WOULD patch (see the I-3
    // production-wiring test) were the format hazard absent. w's
    // formatted text (derived from v) changes; w is never flagged.
    grid.applyTransactionAsync({ update: [{ id: 'r3', v: 999, w: 3 }] });
    await new Promise((r) => setTimeout(r, 200));
    canvas.tickPaint(performance.now());

    expect(grid.getPaintStats().stripPatches,
      'no patch may commit while a visible compiled format program is live — the cross-field span would go stale').toBe(0);
    expect(g.rasterStrips.has('r3'),
      'the strip must be DROPPED — never servable at the post-tick version with the stale formatted span').toBe(false);
    const verAfterTick = g.rowVersionByRowId.get('r3') as number;
    expect(verAfterTick, 'versions must keep tracking through the bail').toBeGreaterThanOrEqual(1);

    // The heal path the bail relies on: flash expiry → onRowsSettled →
    // one full-width row repaint re-captures the settled row with w's
    // CURRENT formatted pixels.
    g.flashRegistry.tick(performance.now() + 60_000);
    canvas.tickPaint(performance.now() + 60_100);
    const verSettled = g.rowVersionByRowId.get('r3') as number;
    expect(g.rasterStrips.get('r3', verSettled, g.stripLayoutEpoch),
      'the settle recapture must heal the dropped strip').not.toBeNull();

    _resetFormatCompiler_forTests();
    grid.destroy();
    restore();
  });

  it('fractional dpr (1.5): Tier-1 fully dormant, patch bails to invalidateRow, strip capture/consume stay on (closeout I-2)', async () => {
    // The adjudicated BYPASS: at non-integer dpr a Tier-1 hit blit's CSS-px
    // dest rect maps to fractional device coordinates (drawImage resamples
    // — not byte-identical to a live paint), and the strip PATCH rounds its
    // span origin (sub-pixel shift vs the live raster). Strip capture and
    // consume are pure integer-device-px copies of the layer's OWN raster,
    // round-tripped through the same rounding — they cannot diverge and
    // stay enabled at any dpr.
    (window as any).devicePixelRatio = 1.5;
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;

    // Tier-1 dormant.
    expect(g.getRasterCellsCtx(), 'Tier-1 must be dormant at fractional dpr').toBeNull();

    // Tier-2 capture/consume live.
    expect(g.getRasterStripsCtx()).not.toBeNull();
    expect(g.rasterStrips.stats().entries).toBeGreaterThan(0);

    // Patch path: version still tracks, but the strip is DROPPED (never
    // patched — a sub-pixel-shifted patch is a stale-pixels bug).
    const sid = g.chunk.stringRowIds[3];
    const nid = g.chunk.rowIds[3];
    expect(g.rasterStrips.get(sid, 0, g.stripLayoutEpoch)).not.toBeNull();
    g.repaintCells([{ rowId: nid, colId: 'id' }]);
    expect(g.rowVersionByRowId.get(sid)).toBe(1);
    expect(grid.getPaintStats().stripPatches, 'no patch may land at fractional dpr').toBe(0);
    expect(g.rasterStrips.get(sid, 0, g.stripLayoutEpoch)).toBeNull();
    expect(g.rasterStrips.get(sid, 1, g.stripLayoutEpoch)).toBeNull();
    grid.destroy();
    restore();
  });

  it('integer dpr (2): the I-2 gate is fractional-only — Tier-1 ctx stays live', async () => {
    (window as any).devicePixelRatio = 2;
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    expect(g.getRasterCellsCtx()).not.toBeNull();
    expect(g.getRasterCellsCtx().dpr).toBe(2);
    grid.destroy();
    restore();
  });

  it('runtime rule CRUD bumps the strip layout epoch and wipes the store (closeout C-2)', async () => {
    // A rule mutation changes matching cells' resolved fg/bg/indicator with
    // NO data change / column rebuild / geometry change — rowVersionByRowId
    // and the strip keys all stand still, so without an epoch bump the
    // strip pre-pass would keep CONSUMING pre-rule pixels at rest.
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    let rules: any[] = [];
    grid.registerRuleEngine({
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => null,
      getRules: () => rules,
      setRules: (r: any[]) => { rules = r; },
    });
    await settle(grid); // re-captures strips after the registration repaint
    expect(g.rasterStrips.stats().entries).toBeGreaterThan(0);

    let e = g.stripLayoutEpoch;
    grid.addRule({ id: 'r1', enabled: true });
    expect(g.stripLayoutEpoch, 'addRule must bump the strip layout epoch').toBeGreaterThan(e);
    expect(g.rasterStrips.stats().entries, 'addRule must wipe the strip store').toBe(0);

    e = g.stripLayoutEpoch;
    grid.updateRule('r1', { priority: 5 });
    expect(g.stripLayoutEpoch, 'updateRule must bump the strip layout epoch').toBeGreaterThan(e);

    e = g.stripLayoutEpoch;
    grid.setRuleEnabled('r1', false);
    expect(g.stripLayoutEpoch, 'setRuleEnabled must bump the strip layout epoch').toBeGreaterThan(e);

    grid.addRule({ id: 'r2', enabled: true });
    e = g.stripLayoutEpoch;
    grid.reorderRules(['r2', 'r1']);
    expect(g.stripLayoutEpoch, 'reorderRules must bump the strip layout epoch').toBeGreaterThan(e);

    e = g.stripLayoutEpoch;
    grid.deleteRule('r1');
    expect(g.stripLayoutEpoch, 'deleteRule must bump the strip layout epoch').toBeGreaterThan(e);

    const { _resetRuleEngine_forTests } = await import('../src/core/ruleEngineSlot');
    _resetRuleEngine_forTests();
    grid.destroy();
    restore();
  });

  it('runtime renderer re-registration and rule-engine registration bump the strip layout epoch (closeout I-1)', async () => {
    // Retained strips hold the OLD painter's pixels at unchanged keys —
    // "the override applies on the next repaint" must extend to strips.
    const { grid, restore } = buildWiredGrid(rows(200), cols);
    await settle(grid);
    const g = grid as any;
    expect(g.rasterStrips.stats().entries).toBeGreaterThan(0);

    let e = g.stripLayoutEpoch;
    grid.registerCellRenderer('text', { paint: () => {} } as any);
    expect(g.stripLayoutEpoch, 'registerCellRenderer must bump the strip layout epoch').toBeGreaterThan(e);
    expect(g.rasterStrips.stats().entries, 'registerCellRenderer must wipe the strip store').toBe(0);

    await settle(grid); // re-capture
    e = g.stripLayoutEpoch;
    grid.registerRuleEngine({
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => null,
    });
    expect(g.stripLayoutEpoch, 'registerRuleEngine must bump the strip layout epoch').toBeGreaterThan(e);

    const { _resetRuleEngine_forTests } = await import('../src/core/ruleEngineSlot');
    _resetRuleEngine_forTests();
    grid.destroy();
    restore();
  });

  it('rasterCache: false — no strips ctx, no version bookkeeping, zero strip stats', async () => {
    const { grid, restore } = buildWiredGrid(rows(200), cols, { rasterCache: false });
    await settle(grid);
    const g = grid as any;
    expect(g.getRasterStripsCtx()).toBeNull();
    g.repaintRows([3]);
    expect(g.rowVersionByRowId.size).toBe(0);
    const stats = grid.getPaintStats();
    expect(stats.stripHits).toBe(0);
    expect(stats.stripMisses).toBe(0);
    expect(stats.stripCaptures).toBe(0);
    expect(stats.stripPatches).toBe(0);
    grid.destroy();
    restore();
  });
});
