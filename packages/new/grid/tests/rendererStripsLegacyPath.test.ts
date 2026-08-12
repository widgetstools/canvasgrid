/**
 * Cycle 26 — Tier-2 row strips on the NON-layer pipeline (`Renderer.paint`).
 *
 * The raster-grain bench (PERF-NOTES) picked "cellBlit + row strips" as the
 * winning no-GPU configuration, but strips were wired only into the
 * retained-layer path — the exact path `qualityMode`'s software-raster
 * resolution turns OFF. These tests lock the screen-space transposition of
 * the layer pass's capture/consume contract in `Renderer.paint()`:
 *
 *   - full paints CAPTURE eligible rows off the screen canvas;
 *   - a repeat paint at the same (rowId, version, epoch) HITS: the row's
 *     cells/gridlines are skipped and the strip is blitted at the row's
 *     device y under an identity transform;
 *   - ineligible rows and rows with a bumped version bypass/miss;
 *   - partial paints only capture rows covered by a full-width rect;
 *   - with no strips handle wired the pipeline is byte-identical.
 *
 * Deliberately drives `Renderer` directly (rendererDamage.test.ts idiom)
 * with a REAL RowStripCache over an HTMLCanvas factory — no OffscreenCanvas
 * anywhere, so the suite runs identically under happy-dom and CI.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Renderer, type RendererOpts } from '../src/renderer/renderer';
import { CellRendererRegistry, textCell, headerCell } from '../src/renderer/cellRenderers/registry';
import { RowStripCache } from '../src/renderer/rasterCache/stripCache';
import { RasterBudget } from '../src/renderer/rasterCache/budget';
import type { RasterStripsCtx } from '../src/renderer/painters/types';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

interface RecordedCall { m: string; args: unknown[] }

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
  // Per-canvas recording 2D context so strip canvases (from the factory)
  // and the screen canvas both work under happy-dom.
  HTMLCanvasElement.prototype.getContext = (() => {
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) {
        const calls: RecordedCall[] = [];
        const rec = (m: string) => (...args: unknown[]) => { calls.push({ m, args }); };
        ctx = {
          calls,
          fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
          save: rec('save'), restore: rec('restore'), rect: rec('rect'), clip: rec('clip'),
          beginPath: rec('beginPath'), stroke: rec('stroke'), moveTo: rec('moveTo'),
          lineTo: rec('lineTo'), arcTo: rec('arcTo'), closePath: rec('closePath'),
          setTransform: rec('setTransform'), clearRect: rec('clearRect'),
          translate: rec('translate'), scale: rec('scale'), drawImage: rec('drawImage'),
          measureText: () => ({ width: 50 }),
          canvas: this,
          fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
          lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
        };
        perCanvas.set(this, ctx);
      }
      return ctx;
    };
  })() as any;
});

function fakeGc(): { gc: CachedContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const rec = (m: string) => (...args: unknown[]) => { calls.push({ m, args }); };
  const ctx: any = {
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'),
    save: rec('save'), restore: rec('restore'),
    rect: rec('rect'), clip: rec('clip'), beginPath: rec('beginPath'), stroke: rec('stroke'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), closePath: rec('closePath'),
    translate: rec('translate'), scale: rec('scale'),
    setTransform: rec('setTransform'), clearRect: rec('clearRect'),
    drawImage: rec('drawImage'),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return { gc: ctx as CachedContext2D, calls };
}

const CANVAS_W = 400;
const CANVAS_H = 300;
const BODY_TOP = 32;
const ROW_H = 30;

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 4, getRowHeight: () => ROW_H, getCell: () => null,
};

function makeViewport(): ViewportState {
  const rows = [0, 1, 2].map((i) => ({
    rowIndex: i, subgrid: dataSubgrid, localRowIndex: i,
    top: BODY_TOP + i * ROW_H, bottom: BODY_TOP + (i + 1) * ROW_H, height: ROW_H,
  }));
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: CANVAS_W, width: CANVAS_W },
    ],
    visibleRows: rows,
    firstRow: 0, lastRow: 2,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: CANVAS_W, bodyTop: BODY_TOP, bodyBottom: CANVAS_H,
    bodyWidth: CANVAS_W, bodyHeight: CANVAS_H - BODY_TOP,
    contentWidth: CANVAS_W, contentHeight: 4 * ROW_H, maxScrollLeft: 0, maxScrollTop: 0,
  } as unknown as ViewportState;
}

const theme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: ROW_H, headerHeight: BODY_TOP, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

function makeStrips(over: Partial<RasterStripsCtx> = {}) {
  const budget = new RasterBudget(8 * 1024 * 1024);
  // HTMLCanvas factory — no OffscreenCanvas involved, so the mocked
  // per-canvas getContext above serves every strip surface.
  const cache = new RowStripCache(
    budget,
    () => document.createElement('canvas') as unknown as import('../src/core/paintCache').PaintCacheCanvasLike,
  );
  const versions = new Map<number, number>();
  const stats = {
    stripHits: 0, stripMisses: 0, stripMissesUncoverable: 0,
    stripCaptures: 0, stripPatches: 0,
  };
  const ctx: RasterStripsCtx = {
    cache,
    dpr: 1,
    rowVersionOf: (ri) => versions.get(ri) ?? 0,
    stringRowIdAt: (ri) => `r${ri}`,
    eligible: () => true,
    layoutEpoch: () => 0,
    stats,
    ...over,
  };
  return { ctx, stats, versions, cache };
}

function makeRenderer(strips: RasterStripsCtx | null) {
  const columnDefs = new Map<string, ResolvedColDef>([
    ['a', {
      colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity,
      cellDataType: 'text', cellRenderer: 'text', sortable: true, resizable: true,
      editable: false, suppressFloatingFilterButton: false,
    } as ResolvedColDef],
  ]);
  const reg = new CellRendererRegistry();
  reg.register('text', textCell);
  reg.register('header', headerCell);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = CANVAS_W;   // dpr 1 → device == CSS px
  screenCanvas.height = CANVAS_H;
  const opts: RendererOpts = {
    getViewport: () => makeViewport(),
    getTheme: () => theme,
    getColumnDefs: () => columnDefs,
    cellRenderers: reg,
    cellData: (ri) => ({ value: `v${ri}`, valueFormatted: `v${ri}` }),
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
    getCanvasElement: () => screenCanvas,
    getDevicePixelRatio: () => 1,
    getRasterStrips: strips === null ? undefined : () => strips,
  } as RendererOpts;
  return { renderer: new Renderer(opts), screenCanvas };
}

const FULL = { full: true as const, chromeRects: [], dataRects: [], blit: null };

describe('Renderer.paint — Tier-2 strips on the non-layer path', () => {
  it('captures eligible rows on a full paint (screen canvas as source)', () => {
    const { ctx: strips, stats } = makeStrips();
    const { renderer } = makeRenderer(strips);
    const { gc } = fakeGc();
    renderer.paint(gc, FULL);
    expect(stats.stripCaptures).toBe(3);
    expect(stats.stripHits).toBe(0);
    // Each row is retrievable at its key.
    expect(strips.cache.get('r0', 0, 0)).not.toBeNull();
    expect(strips.cache.get('r2', 0, 0)).not.toBeNull();
  });

  it('repeat paint HITS: strips blit at device y, row cells+gridline skipped', () => {
    const { ctx: strips, stats } = makeStrips();
    const { renderer } = makeRenderer(strips);
    const first = fakeGc();
    renderer.paint(first.gc, FULL);
    const firstFillTexts = first.calls.filter((c) => c.m === 'fillText').length;
    expect(firstFillTexts).toBe(3); // one per data row, live

    const second = fakeGc();
    renderer.paint(second.gc, FULL);
    expect(stats.stripHits).toBe(3);
    // No live cell text — all three rows served by blits.
    expect(second.calls.filter((c) => c.m === 'fillText').length).toBe(0);
    const blits = second.calls.filter((c) => c.m === 'drawImage');
    expect(blits.length).toBe(3);
    // Dest y (arg index 6) = round(row.top * dpr) — rows at 32, 62, 92.
    expect(blits.map((b) => b.args[6])).toEqual([32, 62, 92]);
    // Identity transform installed around the blits.
    expect(second.calls.some((c) => c.m === 'setTransform'
      && c.args.join(',') === '1,0,0,1,0,0')).toBe(true);
  });

  it('a bumped row version misses, repaints live, and re-captures', () => {
    const { ctx: strips, stats, versions } = makeStrips();
    const { renderer } = makeRenderer(strips);
    renderer.paint(fakeGc().gc, FULL);
    versions.set(1, 5); // row 1 ticked
    const third = fakeGc();
    renderer.paint(third.gc, FULL);
    expect(stats.stripHits).toBe(2);            // rows 0 + 2
    expect(third.calls.filter((c) => c.m === 'fillText').length).toBe(1); // row 1 live
    expect(stats.stripCaptures).toBe(4);        // 3 initial + row 1 re-capture
    expect(strips.cache.get('r1', 5, 0)).not.toBeNull();
  });

  it('ineligible rows neither capture nor hit', () => {
    const { ctx: strips, stats } = makeStrips({ eligible: (ri) => ri !== 1 });
    const { renderer } = makeRenderer(strips);
    renderer.paint(fakeGc().gc, FULL);
    expect(stats.stripCaptures).toBe(2);
    const second = fakeGc();
    renderer.paint(second.gc, FULL);
    expect(stats.stripHits).toBe(2);
    // Row 1 still paints live text.
    expect(second.calls.filter((c) => c.m === 'fillText').length).toBe(1);
  });

  it('partial paint: full-width covering rect captures; cell-sized rect does not', () => {
    const { ctx: strips, stats } = makeStrips();
    const { renderer } = makeRenderer(strips);
    // Cover row 0 (y 32..62) full-width — via a chrome rect (already screen space).
    renderer.paint(fakeGc().gc, {
      full: false,
      chromeRects: [{ x: 0, y: 32, w: CANVAS_W, h: ROW_H }],
      dataRects: [], blit: null,
    });
    expect(stats.stripCaptures).toBe(1);
    expect(strips.cache.get('r0', 0, 0)).not.toBeNull();
    // Cell-sized rect over row 1 — repaints but must NOT capture.
    renderer.paint(fakeGc().gc, {
      full: false,
      chromeRects: [{ x: 100, y: 66, w: 40, h: 10 }],
      dataRects: [], blit: null,
    });
    expect(stats.stripCaptures).toBe(1);
    expect(stats.stripMissesUncoverable).toBeGreaterThanOrEqual(1);
    expect(strips.cache.get('r1', 0, 0)).toBeNull();
  });

  it('no strips handle → byte-identical pipeline (no drawImage, no captures)', () => {
    const { renderer } = makeRenderer(null);
    const { gc, calls } = fakeGc();
    renderer.paint(gc, FULL);
    expect(calls.filter((c) => c.m === 'drawImage').length).toBe(0);
    expect(calls.filter((c) => c.m === 'fillText').length).toBe(3);
  });
});
