/**
 * Cycle 22 / Task 2 — Tier-1 cell-bitmap cache at the byRows cell-paint
 * seam. Recorded-gc style (tests/rendererPaintCache.test.ts idiom).
 *
 * Covers:
 *  (a) miss → hit round trip: the first paint rasterizes each distinct cell
 *      signature into the cache (painter runs against the SCRATCH gc with
 *      bounds rebased to (0,0,w,h), prefilled with `prefillColor`); the
 *      second paint blits (one `drawImage` per cell, ZERO painter calls).
 *  (b) the hit blit's destination is the cell's CSS-px origin/dims (the C1
 *      lesson — the dpr CTM scales it, drawImage args stay CSS px).
 *  (c) bypass matrix — flashAlpha, custom non-opted-in renderer, params,
 *      decorators, content, pending icon, pivotGroupExpand — all paint
 *      live on the main gc with untouched bounds and never touch the cache.
 *  (d) no-regression proof: with `rasterCells` absent (rasterCache:false),
 *      the recorded gc call sequence is byte-identical to the shipped
 *      pipeline — and an unavailable cache degrades to the same sequence.
 *  (e) stats counters (cellCacheHits/Misses/Bypasses) move.
 *  (f) CGrid-level wiring: construction, PaintStats fields, runtime
 *      `rasterCache` flip disposes both tiers, theme swap bumps the epoch,
 *      destroy releases the budget.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Renderer, type RendererOpts } from '../src/renderer/renderer';
import {
  CellRendererRegistry,
  type CellPaintConfig,
  type CellPainter,
} from '../src/renderer/cellRenderers/registry';
import { paintCellThroughCache } from '../src/renderer/painters/byRows';
import type { RasterCellsCtx } from '../src/renderer/painters/types';
import { RasterBudget, CellBitmapCache } from '../src/renderer/rasterCache';
import type { PaintCacheCanvasFactory } from '../src/core/paintCache';
import type { ViewportState } from '../src/core/viewport';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import type { Subgrid } from '../src/core/subgrid';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CGridOptions } from '../src/types/options';

// ─── fakeGc — same recording idiom as tests/rendererPaintCache.test.ts ──────

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
  ctx.clearFill = rec('clearFill');
  return { gc: ctx as CachedContext2D, calls };
}

// ─── fake canvas factory for the REAL CellBitmapCache (rasterCacheCore
//     idiom — attachGcCache attaches `.cache` onto this raw ctx) ────────────

interface FakeScratchCtx {
  canvas: FakeScratchCanvas;
  log: string[];
  setTransform: (...a: number[]) => void;
  clearRect: (...a: number[]) => void;
  fillRect: (...a: number[]) => void;
  fillText: (...a: unknown[]) => void;
  drawImage: (...a: unknown[]) => void;
  save: () => void;
  restore: () => void;
  beginPath: () => void;
  rect: (...a: number[]) => void;
  clip: () => void;
  stroke: () => void;
  moveTo: (...a: number[]) => void;
  lineTo: (...a: number[]) => void;
  measureText: (t: string) => { width: number };
  fillStyle: string;
}

interface FakeScratchCanvas {
  width: number;
  height: number;
  getContext(type: '2d', attrs?: unknown): FakeScratchCtx;
  __ctx: FakeScratchCtx;
}

function makeScratchFactory(): { factory: PaintCacheCanvasFactory; canvases: FakeScratchCanvas[] } {
  const canvases: FakeScratchCanvas[] = [];
  const factory = (): FakeScratchCanvas => {
    const log: string[] = [];
    const canvas = { width: 0, height: 0 } as FakeScratchCanvas;
    const ctx: FakeScratchCtx = {
      canvas, log,
      setTransform: (...a) => { log.push(`setTransform(${a.join(',')})`); },
      clearRect: (...a) => { log.push(`clearRect(${a.join(',')})`); },
      fillRect: (...a) => { log.push(`fillRect(${a.join(',')})`); },
      fillText: (...a) => { log.push(`fillText(${a.join(',')})`); },
      drawImage: () => { log.push('drawImage'); },
      save: () => { log.push('save'); },
      restore: () => { log.push('restore'); },
      beginPath: () => {}, rect: () => {}, clip: () => {}, stroke: () => {},
      moveTo: () => {}, lineTo: () => {},
      measureText: () => ({ width: 10 }),
      fillStyle: '',
    };
    canvas.__ctx = ctx;
    canvas.getContext = () => ctx;
    canvases.push(canvas);
    return canvas;
  };
  return { factory: factory as unknown as PaintCacheCanvasFactory, canvases };
}

// ─── viewport / theme fixture (rendererPaintCache.test.ts layout) ───────────

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

// Header row (0..32) + 2 data rows (32..62 odd→altBg, 62..92 even→bg).
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
  } as ViewportState;
}

function makeColumnDefs(extra: Partial<ResolvedColDef> = {}): Map<string, ResolvedColDef> {
  return new Map<string, ResolvedColDef>([
    ['a', {
      colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text',
      cellRenderer: 'text', sortable: true, resizable: true, editable: false,
      ...extra,
    } as ResolvedColDef],
  ]);
}

/** Spy registry: records renderer key + a bounds snapshot per paint call,
 *  and paints one fillRect + one fillText so recorded sequences have real
 *  pixel-producing calls to compare. */
function makeSpyRegistry(opts: { cacheable: boolean } = { cacheable: true }): {
  reg: CellRendererRegistry;
  paints: Array<{ key: string; bounds: { x: number; y: number; w: number; h: number } }>;
} {
  const paints: Array<{ key: string; bounds: { x: number; y: number; w: number; h: number } }> = [];
  const reg = new CellRendererRegistry();
  for (const key of ['text', 'header']) {
    const painter: CellPainter = {
      paint(gc: CachedContext2D, p: CellPaintConfig) {
        paints.push({ key, bounds: { ...p.bounds } });
        if (p.bg !== p.prefillColor) {
          gc.cache.fillStyle = p.bg;
          gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
        }
        gc.cache.fillStyle = p.fg;
        gc.fillText(p.valueFormatted, p.bounds.x + 6, p.bounds.y + p.bounds.h / 2);
      },
    };
    reg.register(key, painter, { cacheable: opts.cacheable });
  }
  return { reg, paints };
}

function makeOpts(overrides: Partial<RendererOpts> = {}): RendererOpts {
  const { reg } = makeSpyRegistry();
  return {
    getViewport: () => makeVs(),
    getTheme: () => theme,
    getColumnDefs: () => makeColumnDefs(),
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

const freshStats = () => ({ cellCacheHits: 0, cellCacheMisses: 0, cellCacheBypasses: 0 });

function makeCacheCtx(budgetBytes = 8 * 1024 * 1024): {
  rc: RasterCellsCtx;
  stats: { cellCacheHits: number; cellCacheMisses: number; cellCacheBypasses: number };
  canvases: FakeScratchCanvas[];
} {
  const { factory, canvases } = makeScratchFactory();
  const cache = new CellBitmapCache(new RasterBudget(budgetBytes), factory);
  const stats = freshStats();
  return { rc: { cache, dpr: 1, stats }, stats, canvases };
}

// ─── registry cacheable flag ────────────────────────────────────────────────

describe('CellRendererRegistry — cacheable opt-in', () => {
  it('defaults to NOT cacheable (custom renderers paint live unless opted in)', () => {
    const reg = new CellRendererRegistry();
    reg.register('custom', { paint() {} });
    expect(reg.isCacheable('custom')).toBe(false);
  });

  it('opt-in flag marks the renderer cacheable', () => {
    const reg = new CellRendererRegistry();
    reg.register('custom', { paint() {} }, { cacheable: true });
    expect(reg.isCacheable('custom')).toBe(true);
  });

  it('re-registering WITHOUT the flag resets cacheability (an override painter has unknown pixels)', () => {
    const reg = new CellRendererRegistry();
    reg.register('text', { paint() {} }, { cacheable: true });
    reg.register('text', { paint() {} });
    expect(reg.isCacheable('text')).toBe(false);
  });
});

// ─── (a) miss → hit round trip ──────────────────────────────────────────────

describe('seam — miss → hit round trip', () => {
  it('first paint rasterizes each cell (rebased bounds, prefilled scratch); second paint blits with ZERO painter calls', () => {
    const { reg, paints } = makeSpyRegistry();
    const { rc, stats, canvases } = makeCacheCtx();
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterCells: () => rc }));

    const { gc: gc1, calls: calls1 } = fakeGc();
    renderer.paint(gc1, undefined);

    // 3 distinct signatures (header, data altBg row, data base-bg row) —
    // each painted ONCE, against the scratch, with bounds rebased to (0,0).
    expect(paints.length).toBe(3);
    for (const p of paints) {
      expect(p.bounds.x).toBe(0);
      expect(p.bounds.y).toBe(0);
    }
    expect(stats.cellCacheMisses).toBe(3);
    expect(stats.cellCacheHits).toBe(0);
    // The main gc received one blit per cell on the miss path too.
    expect(calls1.filter((c) => c.m === 'drawImage').length).toBe(3);

    // The scratch was prefilled with the cell's prefillColor at (0,0,w,h)
    // BEFORE the painter ran (so painters' `bg !== prefillColor` skip-fill
    // logic behaves exactly as under the live bundle prefill).
    const scratchLogs = canvases.flatMap((c) => c.__ctx.log);
    expect(scratchLogs.some((l) => l.startsWith('fillRect(0,0,'))).toBe(true);

    // Second paint: every cell is a hit — zero painter calls, one blit each.
    const before = paints.length;
    const { gc: gc2, calls: calls2 } = fakeGc();
    renderer.paint(gc2, undefined);
    expect(paints.length).toBe(before);
    expect(stats.cellCacheHits).toBe(3);
    expect(calls2.filter((c) => c.m === 'drawImage').length).toBe(3);
  });

  it('(b) the hit blit destination is the cell CSS-px origin and dims (C1 lesson)', () => {
    const { reg } = makeSpyRegistry();
    const { rc } = makeCacheCtx();
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterCells: () => rc }));

    renderer.paint(fakeGc().gc, undefined); // warm
    const { gc, calls } = fakeGc();
    renderer.paint(gc, undefined);

    const blits = calls.filter((c) => c.m === 'drawImage');
    const dests = blits.map((c) => c.args.slice(1));
    // Header cell (top 0, h 32) + two data cells (tops 32 and 62, h 30),
    // full column width — all in CSS px (5-arg drawImage form).
    expect(dests).toContainEqual([0, 0, CANVAS_W, 32]);
    expect(dests).toContainEqual([0, 32, CANVAS_W, 30]);
    expect(dests).toContainEqual([0, 62, CANVAS_W, 30]);
  });

  it('shared config bounds are restored after a miss render (next cell sees real coords)', () => {
    const { reg, paints } = makeSpyRegistry();
    const rcCtx = makeCacheCtx();
    // Bypass every SECOND cell via flashAlpha on row 2 so a live paint
    // follows a cached one within the same paintBand run — its bounds
    // must be the REAL cell coords, proving the rebase was restored.
    const renderer = new Renderer(makeOpts({
      cellRenderers: reg,
      getRasterCells: () => rcCtx.rc,
      cellData: (rowIndex) => rowIndex === 2
        ? { value: 'x', valueFormatted: 'x', flashAlpha: 0.5 }
        : { value: 'x', valueFormatted: 'x' },
    }));
    renderer.paint(fakeGc().gc, undefined);
    const live = paints.filter((p) => p.bounds.y === 62);
    expect(live.length).toBe(1);
    expect(live[0]!.bounds).toEqual({ x: 0, y: 62, w: CANVAS_W, h: 30 });
  });
});

// ─── (c) bypass matrix ──────────────────────────────────────────────────────

describe('seam — bypass matrix paints live', () => {
  function paintTwiceCountBlits(overrides: Partial<RendererOpts>): {
    blits: number;
    paints: Array<{ key: string; bounds: { x: number; y: number; w: number; h: number } }>;
    stats: ReturnType<typeof freshStats>;
  } {
    const { reg, paints } = makeSpyRegistry();
    const { rc, stats } = makeCacheCtx();
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterCells: () => rc, ...overrides }));
    renderer.paint(fakeGc().gc, undefined);
    const { gc, calls } = fakeGc();
    renderer.paint(gc, undefined);
    return { blits: calls.filter((c) => c.m === 'drawImage').length, paints, stats };
  }

  it('flashAlpha → live paint at real coords, bypass counted', () => {
    const { paints, stats } = paintTwiceCountBlits({
      cellData: () => ({ value: 'x', valueFormatted: 'x', flashAlpha: 0.25 }),
    });
    // Data cells (2 per paint × 2 paints) always live; header still caches.
    const dataPaints = paints.filter((p) => p.key === 'text');
    expect(dataPaints.length).toBe(4);
    // Real (un-rebased) coords — data rows sit at y=32/62, never (0,0).
    for (const p of dataPaints) expect(p.bounds.y).toBeGreaterThanOrEqual(32);
    expect(stats.cellCacheBypasses).toBe(4);
  });

  it('custom (non-opted-in) renderer → live paint every time', () => {
    const { reg, paints } = makeSpyRegistry({ cacheable: false });
    const { rc, stats } = makeCacheCtx();
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, getRasterCells: () => rc }));
    renderer.paint(fakeGc().gc, undefined);
    renderer.paint(fakeGc().gc, undefined);
    expect(paints.length).toBe(6); // 3 cells × 2 paints, no caching
    expect(stats.cellCacheHits).toBe(0);
    expect(stats.cellCacheMisses).toBe(0);
    expect(stats.cellCacheBypasses).toBe(6);
  });

  it('cellRendererParams present → live paint (params bypass)', () => {
    const { paints } = paintTwiceCountBlits({
      getColumnDefs: () => makeColumnDefs({ cellRendererParams: { decimals: 2 } } as Partial<ResolvedColDef>),
    });
    // Data cells carry params → live both paints. Header has params
    // undefined → cached.
    expect(paints.filter((p) => p.key === 'text').length).toBe(4);
  });

  it('cellIcon (pending inline icon) → live paint (icon draws over the cell)', () => {
    const { paints } = paintTwiceCountBlits({
      getColumnDefs: () => makeColumnDefs({ cellIcon: () => ({ emoji: '★' }) } as unknown as Partial<ResolvedColDef>),
    });
    expect(paints.filter((p) => p.key === 'text').length).toBe(4);
  });
});

// ─── (c cont.) helper-level bypass unit coverage (decorators / content /
//     pivotGroupExpand — config states not reachable via the fixture) ───────

describe('paintCellThroughCache — direct bypass coverage', () => {
  function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
    return {
      value: 'v', valueFormatted: 'v',
      bounds: { x: 10, y: 20, w: 100, h: 24 },
      font: '12px Inter', fg: '#111', bg: '#fff', borderColor: '#eee',
      halign: 'left', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      ...overrides,
    };
  }
  function makePainter(): { painter: CellPainter; boundsSeen: Array<{ x: number; y: number }> } {
    const boundsSeen: Array<{ x: number; y: number }> = [];
    return {
      painter: { paint(_gc, p) { boundsSeen.push({ x: p.bounds.x, y: p.bounds.y }); } },
      boundsSeen,
    };
  }

  const bypassConfigs: Array<[string, Partial<CellPaintConfig>]> = [
    ['decorators (non-empty)', { decorators: [{ kind: 'dot', color: '#f00', position: 'tr' } as never] }],
    ['content slot', { content: { kind: 'text', value: 'slot' } as never }],
    ['pivotGroupExpand (group-header caret — outside the signature)', { pivotGroupExpand: 'open' }],
    ['flashAlpha', { flashAlpha: 0.5 }],
    ['params', { params: { a: 1 } }],
  ];
  for (const [name, patch] of bypassConfigs) {
    it(`${name} → live paint on the main gc at real coords`, () => {
      const { rc, stats } = makeCacheCtx();
      const { painter, boundsSeen } = makePainter();
      const { gc, calls } = fakeGc();
      paintCellThroughCache(gc, rc, painter, true, 'text', baseConfig(patch), false);
      expect(boundsSeen).toEqual([{ x: 10, y: 20 }]);
      expect(calls.some((c) => c.m === 'drawImage')).toBe(false);
      expect(stats.cellCacheBypasses).toBe(1);
      expect(rc.cache.stats().entries).toBe(0);
    });
  }

  it('liveOnly=true (pending icon at the seam) → live paint even for a cacheable renderer', () => {
    const { rc, stats } = makeCacheCtx();
    const { painter, boundsSeen } = makePainter();
    const { gc } = fakeGc();
    paintCellThroughCache(gc, rc, painter, true, 'text', baseConfig(), true);
    expect(boundsSeen).toEqual([{ x: 10, y: 20 }]);
    expect(stats.cellCacheBypasses).toBe(1);
  });

  it('render() returning null (budget exhaustion) → live paint exactly as today, bounds untouched', () => {
    const { rc, stats } = makeCacheCtx(16); // 16 bytes — nothing fits
    const { painter, boundsSeen } = makePainter();
    const { gc, calls } = fakeGc();
    paintCellThroughCache(gc, rc, painter, true, 'text', baseConfig(), false);
    expect(boundsSeen).toEqual([{ x: 10, y: 20 }]);
    expect(calls.some((c) => c.m === 'drawImage')).toBe(false);
    expect(stats.cellCacheHits).toBe(0);
    expect(stats.cellCacheMisses).toBe(0);
    expect(stats.cellCacheBypasses).toBe(1);
  });

  it('a throwing painter cannot corrupt the shared config bounds (restored via finally)', () => {
    const { rc } = makeCacheCtx();
    const throwing: CellPainter = { paint() { throw new Error('boom'); } };
    const { gc } = fakeGc();
    const config = baseConfig();
    expect(() => paintCellThroughCache(gc, rc, throwing, true, 'text', config, false))
      .toThrow('boom');
    expect(config.bounds).toEqual({ x: 10, y: 20, w: 100, h: 24 });
  });
});

// ─── (d) no-regression: rasterCells absent ⇒ byte-identical sequence ───────

describe('seam — rasterCache off reproduces the shipped pipeline byte-for-byte', () => {
  function record(overrides: Partial<RendererOpts>): { calls: RecordedCall[]; paintCount: number } {
    const { reg, paints } = makeSpyRegistry();
    const renderer = new Renderer(makeOpts({ cellRenderers: reg, ...overrides }));
    const { gc, calls } = fakeGc();
    renderer.paint(gc, undefined);
    return { calls, paintCount: paints.length };
  }

  it('getRasterCells absent, () => null, and an UNAVAILABLE cache all record the identical call sequence', () => {
    const absent = record({});
    const nullGetter = record({ getRasterCells: () => null });
    const unavailable = record({
      getRasterCells: () => ({
        cache: new CellBitmapCache(new RasterBudget(1024), null as unknown as PaintCacheCanvasFactory),
        dpr: 1,
        stats: freshStats(),
      }),
    });

    const norm = (r: { calls: RecordedCall[] }) => JSON.stringify(r.calls);
    expect(norm(nullGetter)).toBe(norm(absent));
    expect(norm(unavailable)).toBe(norm(absent));
    expect(nullGetter.paintCount).toBe(absent.paintCount);
    expect(unavailable.paintCount).toBe(absent.paintCount);
    // Sanity: the legacy sequence contains NO drawImage at all.
    expect(absent.calls.some((c) => c.m === 'drawImage')).toBe(false);
  });
});

// ─── (f) CGrid-level wiring ─────────────────────────────────────────────────

// happy-dom has no canvas 2d context — the rendererPaintCache.test.ts
// idiom, EXCEPT one ctx PER CANVAS (a WeakMap) instead of one shared
// object: the raster caches attach a gc cache onto every pooled scratch
// canvas mid-paint, and a single shared ctx would have its `.cache`
// closure replaced under the main canvas's feet.
beforeAll(() => {
  const perCanvas = new WeakMap<object, any>();
  HTMLCanvasElement.prototype.getContext = function (this: object) {
    let fakeCtx = perCanvas.get(this);
    if (!fakeCtx) {
      fakeCtx = {
        canvas: this,
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
      perCanvas.set(this, fakeCtx);
    }
    return fakeCtx;
  } as any;
});

function buildWiredGrid<T extends { id: string }>(
  rowData: T[],
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
    rowData,
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

describe('CGrid — raster-cache wiring (options / stats / epochs / dispose)', () => {
  it('constructs both tiers by default; PaintStats carries the new counters; a paint moves them', async () => {
    const { grid, restore } = buildWiredGrid(rows(50), cols);
    const g = grid as any;
    expect(g.rasterCells).not.toBeNull();
    expect(g.rasterStrips).not.toBeNull();
    expect(g.rasterBudget).not.toBeNull();
    // Both tiers charge ONE shared budget object.
    expect(g.rasterCells.available).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    g.cgridCanvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.cellCacheHits).toBeTypeOf('number');
    expect(stats.cellCacheMisses).toBeGreaterThan(0);
    expect(stats.rasterCacheBytes).toBeGreaterThan(0);

    // resetPaintStats zeroes the new counters too (both seed sites).
    grid.resetPaintStats();
    const zeroed = grid.getPaintStats();
    expect(zeroed.cellCacheHits).toBe(0);
    expect(zeroed.cellCacheMisses).toBe(0);
    expect(zeroed.cellCacheBypasses).toBe(0);
    expect(zeroed.rasterCacheBytes).toBe(0);

    const budget = g.rasterBudget;
    grid.destroy();
    // destroy releases every cached byte back to the (now-detached) budget.
    expect(budget.spent()).toBe(0);
    expect(g.rasterCells).toBeNull();
    expect(g.rasterStrips).toBeNull();
    restore();
  });

  it('rasterCache: false constructs NO tiers and never moves the counters', async () => {
    const { grid, restore } = buildWiredGrid(rows(50), cols, { rasterCache: false });
    const g = grid as any;
    expect(g.rasterCells).toBeNull();
    expect(g.rasterStrips).toBeNull();

    await new Promise((r) => setTimeout(r, 50));
    g.cgridCanvas.tickPaint(performance.now());

    const stats = grid.getPaintStats();
    expect(stats.cellCacheHits).toBe(0);
    expect(stats.cellCacheMisses).toBe(0);
    expect(stats.cellCacheBypasses).toBe(0);
    expect(stats.rasterCacheBytes).toBe(0);

    grid.destroy();
    restore();
  });

  it('setGridOption(rasterCache, false) disposes both tiers; flipping back rebuilds them', async () => {
    const { grid, restore } = buildWiredGrid(rows(50), cols);
    const g = grid as any;
    await new Promise((r) => setTimeout(r, 50));
    g.cgridCanvas.tickPaint(performance.now());
    expect(grid.getPaintStats().rasterCacheBytes).toBeGreaterThan(0);
    const budgetBefore = g.rasterBudget;

    grid.setGridOption('rasterCache', false);
    expect(g.rasterCells).toBeNull();
    expect(g.rasterStrips).toBeNull();
    expect(budgetBefore.spent()).toBe(0); // every byte credited on dispose
    g.cgridCanvas.tickPaint(performance.now() + 500);
    expect(grid.getPaintStats().rasterCacheBytes).toBe(0);

    grid.setGridOption('rasterCache', true);
    expect(g.rasterCells).not.toBeNull();
    g.cgridCanvas.tickPaint(performance.now() + 1000);
    expect(grid.getPaintStats().rasterCacheBytes).toBeGreaterThan(0);

    grid.destroy();
    restore();
  });

  it('a theme swap bumps the epoch (all cached cell bitmaps invalidated immediately)', async () => {
    const { grid, restore } = buildWiredGrid(rows(50), cols);
    const g = grid as any;
    await new Promise((r) => setTimeout(r, 50));
    g.cgridCanvas.tickPaint(performance.now());
    expect(g.rasterCells.stats().entries).toBeGreaterThan(0);

    grid.setTheme('cg-theme-quartz-dark');
    expect(g.rasterCells.stats().entries).toBe(0);

    grid.destroy();
    restore();
  });
});
