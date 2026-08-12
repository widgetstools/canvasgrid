import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { GroupCellValue } from './cellRenderers/group';
import type { CellDataLookup, RasterCellsCtx, RasterStripsCtx, PainterCtx } from './painters/types';
import type { PaintCacheCanvasLike } from '../core/paintCache';
import type { SortModel, SelectionRange } from '../types';
import type { StickyAncestor } from '../worker/protocol';
import type { CachedContext2D } from './gc';
import { dataRectToScreen, type ResolvedDamage, type Rect } from '../core/damageLedger';
import { paintCellsByRows, type ByRowsMode } from './painters/byRows';
import { paintGridLines } from './painters/gridLinesPainter';
import { paintOverlay } from './painters/overlayPainter';
import { paintRangeOverlay } from './painters/rangeOverlayPainter';
import { paintStickyGroups } from './painters/stickyGroups';

export type { CellDataLookup };

export interface RendererOpts {
  getViewport: () => ViewportState;
  getTheme: () => ResolvedTheme;
  getColumnDefs: () => Map<string, ResolvedColDef>;
  cellRenderers: CellRendererRegistry;
  cellData: CellDataLookup;
  getSelection: () => {
    focusedRowIndex: number | null;
    focusedColId: string | null;
    selectedRowIndices: Set<number>;
    /** Cycle 9 / Task 3 — active cell-range selections from the
     *  `SelectionModel`. Forwarded into `PainterCtx.selection` so the
     *  rangeOverlayPainter can render the active ranges. */
    ranges: SelectionRange[];
  };
  getSortModel: () => SortModel;
  /** Cycle 21i / Phase 1 — hovered data-row index (or null). Already
   *  gated by `suppressRowHoverHighlight` at the grid, so the painter
   *  paints the hover band whenever this is non-null. */
  getHoveredRowIndex?: () => number | null;
  /** Total visible row count after filter/sort. Used by the header
   *  painter for the row-select header tri-state checkbox. */
  getTotalRowCount?: () => number;
  /** Total drawable width in CSS px (matches VelocityGridCanvas.bounds.width). */
  getCanvasWidth: () => number;
  /** Total drawable height in CSS px (matches VelocityGridCanvas.bounds.height). */
  getCanvasHeight: () => number;
  /**
   * Synchronous row snapshot — keyed by colId. Forwarded into `PainterCtx`
   * for `cellClassRules` / function-form `cellStyle` callbacks.
   * Cycle 6 / Task 7.
   */
  rowDataSnapshotAt: (rowIndex: number) => Record<string, unknown>;
  /** Cycle 21e / Task 11 — real string rowId for a visible data row
   *  (chunk `stringRowIds` mirror). Forwarded into `PainterCtx`. */
  stringRowIdAt?: (rowIndex: number) => string | null;
  /** Cycle 21e / Task 11 — full row from the main-thread rowDataById
   *  mirror (hidden columns included). Forwarded into `PainterCtx`. */
  getRowDataById?: (rowId: string) => unknown;
  getEngineCellStyle?: () => PainterCtx['engineCellStyle'];
  /** Cycle 21e / Task 11 — active theme kind for rule eval contexts. */
  getThemeKind?: () => 'light' | 'dark';
  /**
   * Cycle 7 / Task 7 — current pre-lowercased quick-filter terms (or `[]`
   * when no quick filter is active). Forwarded into `PainterCtx` so the
   * cell painter can tint matching cells with `theme.quickFilterMatchBg`.
   */
  getQuickFilterLowerTerms: () => readonly string[];
  /**
   * Cycle 9 / Task 5 — when true, the range overlay painter draws a 6×6
   * fill handle at the bottom-right of the last range. Sourced from
   * `VelocityGridOptions.enableFillHandle` per paint so a runtime
   * `setGridOption('enableFillHandle', true)` lights up immediately.
   */
  getShowFillHandle: () => boolean;
  /**
   * Cycle 14 / Task 4 — grid-level `suppressAggFuncInHeader` flag.
   * Read per paint so a runtime `setGridOption('suppressAggFuncInHeader',
   * …)` lights up on the next rAF. Per-column overrides live on the
   * resolved column def and win when set.
   */
  getSuppressAggFuncInHeader: () => boolean;
  /**
   * Cycle 12 / Task 2 — band-aware cell bounds resolver shared by every
   * overlay painter. Returns `null` whenever the cell straddles or has
   * scrolled outside its column's band, so painters never need to
   * reimplement the band-clip math. Backed by
   * `VelocityGrid.getVisibleCellBounds`.
   *
   * Task 4 (paint-cache layer) — optional 3rd `vs` argument: when supplied,
   * bounds resolve against THAT `ViewportState` instead of the live real
   * viewport. `paintLayer` wires this to `layerVs` so `paintOverlay` /
   * `paintRangeOverlay` (baked into the retained layer) resolve focus-ring
   * bounds against the layer's own (possibly off-screen) coverage, not the
   * narrower on-screen body — the public `VelocityGrid.getVisibleCellBounds()` API
   * is unaffected (always resolves against the real viewport).
   */
  getVisibleCellBounds: (rowIndex: number, colId: string, vs?: ViewportState) =>
    { x: number; y: number; w: number; h: number } | null;
  /**
   * Cycle 15 / Task 5 — group-row strip mode lookup. Returns the per-row
   * group context for full-row strip rendering when `groupDisplayType`
   * resolves to `'groupRows'` or `'custom'`; returns `null` for
   * singleColumn / multipleColumns / bypassed-grouping so the painter
   * skips the strip code path with zero overhead. The `lookup` takes a
   * data-row index (matches `cellAt(rowIndex, …)`'s row argument) and
   * returns the `GroupCellValue` payload on a group row, `null` on a
   * data row. The `renderer` is the cellRenderer key the painter looks
   * up via the registry — defaults to `'group'`; apps override via
   * `VelocityGridOptions.groupRowRenderer` for `'custom'` display type.
   */
  getGroupRowStrip: () => {
    renderer: string;
    lookup: (rowIndex: number) => GroupCellValue | null;
  } | null;
  /**
   * Cycle 15 / Task 12 — per-row kind probe. Mirrors `chunk.rowKinds[i]`
   * for a global row index — `0` for ordinary data rows, `1` for group
   * rows, `3` for per-group footer rows. The painter reads it once per
   * visible data row to decide whether to paint the footer-row "lift"
   * bg + route cells through the `'groupFooter'` renderer. Returns `0`
   * when the row index is outside the current chunk window (defensive
   * default — paints as data row, no footer chrome).
   */
  getRowKindAt: (rowIndex: number) => number;
  /**
   * Cycle 15.5 / Task 4 — whether `groupHideOpenParents` is active.
   * When `true`, the sticky group painter returns immediately.
   */
  getGroupHideOpenParents: () => boolean;
  /**
   * Cycle 15 / Task 16 — sticky group ancestors above the viewport's
   * first visible row. Empty array when grouping is inactive or nothing
   * has scrolled past. Sorted depth-ascending.
   */
  getStickyAncestors: () => StickyAncestor[];
  /**
   * Cycle 15 / Task 16 — group depth for a given local row index.
   * Returns 0 when outside the current chunk.
   */
  getGroupDepthAt: (rowIndex: number) => number;
  /**
   * Cycle 15 / Task 16 — composite group key for a given local row
   * index. Returns `''` for data rows or when outside the current chunk.
   */
  getGroupKeyAt: (rowIndex: number) => string;
  /**
   * Cycle 15.5 — look up a formatted aggregate value for a sticky group row's
   * group key + colId. Returns null when the column has no aggFunc or the
   * group key is unknown.
   */
  getStickyGroupTotals?: (groupKey: string, colId: string) => { value: unknown; valueFormatted: string } | null;
  /**
   * Cycle 18 / Task 4 — open/closed state for a column group, used by the
   * byRows painter to paint a chevron on branch pivot column-group
   * headers. Returns `true` for unknown groups so non-pivot group
   * headers (Cycle 4) never accidentally get a chevron.
   */
  getColumnGroupOpen?: (groupId: string) => boolean;
  /**
   * Task 5 — scroll self-blit. Returns the live `<canvas>` element so
   * `Renderer.paint` can `drawImage` the canvas onto itself (shifting the
   * still-valid body pixels by the scroll delta) before repainting only
   * the newly-exposed band. Optional: when omitted (or the damage has no
   * `blit`), the blit step is skipped and painting falls back to whatever
   * `damage` already specifies — never a correctness dependency.
   */
  getCanvasElement?: () => HTMLCanvasElement | undefined;
  /**
   * Cycle 22 / Task 2 — Tier-1 cell-bitmap cache handle for the byRows
   * cell-paint seam (see `PainterCtx.rasterCells`). Read fresh per paint
   * (dpr can change; VelocityGrid gates on `rasterCache` + availability). Absent
   * or returning `null` ⇒ every cell paints live, byte-identical to the
   * shipped pipeline — this is the `rasterCache: false` escape hatch.
   */
  getRasterCells?: () => RasterCellsCtx | null;
  /**
   * Cycle 22 / Task 3 — Tier-2 row-strip cache handle for the retained
   * layer's band raster (see `RasterStripsCtx`). Read fresh per
   * `paintLayer` call (VelocityGrid gates on `rasterCache` + availability and
   * owns the eligibility/version/epoch closures). Absent or returning
   * `null` ⇒ the strip path is fully dormant — the call sequence stays
   * byte-identical to the shipped pipeline. Only `paintLayer` consults
   * this; the legacy `paint()` and `paintChrome` never touch strips.
   */
  getRasterStrips?: () => RasterStripsCtx | null;
  /**
   * C1 fix — the live `devicePixelRatio` the canvas's backing store was
   * sized at (`VelocityGridCanvas.devicePixelRatio`), used by the scroll blit to
   * convert between device px (source rect — `drawImage` addresses the
   * backing store directly, CTM-independent) and CSS px (destination
   * rect — goes through the canvas's persistent `setTransform(dpr, 0, 0,
   * dpr, 0, 0)` CTM). Optional so existing tests/fixtures that don't wire
   * it fall back to `canvas.width / cssWidth`, which is exact except for
   * odd CSS widths where `round(w*dpr)` doesn't divide back to dpr
   * cleanly — real call sites should always wire this.
   */
  getDevicePixelRatio?: () => number;
}

/**
 * Collapse target #3 (SPEC.md §2) — the Tier-2 row-strip surface for ONE
 * pipeline run. Legacy carried this logic twice, once in `Renderer.paint`
 * against the on-screen canvas and once in `Renderer.paintLayer` against the
 * retained layer's backing store, differing ONLY in these three fields. The
 * eligibility/coverage rules, the device-px rounding, the consume order and
 * the capture order are now written once, in `planStrips` / `consumeStrips` /
 * `captureStrips` below.
 *
 * `originY` is the CSS-px y that maps to device y 0 on this surface: `0` for
 * the screen canvas (a row's band is `round(row.top * dpr)`), `layerVs.bodyTop`
 * for the retained layer (layer-local re-basing, rounded exactly like
 * `PaintCacheLayer.visibleSrcRect` so capture and blit tile without seams).
 * The two roundings are each self-consistent within their own surface; a strip
 * captured under one whose height disagrees ±1px with the other simply misses
 * the height check and re-captures (fail-safe, never corrupt).
 */
interface StripTarget {
  ctx: RasterStripsCtx;
  canvas: PaintCacheCanvasLike & CanvasImageSource;
  originY: number;
}

/** Result of the strip pre-pass — pure lookups, ZERO gc calls. */
interface StripPlan {
  target: StripTarget;
  epoch: number;
  /** Rows whose pixels a blit will supply; both painters skip them. */
  skipRows: Set<number> | null;
  blits: Array<{ strip: PaintCacheCanvasLike; yDev: number }> | null;
  captures: Array<{ rowId: string; version: number; yDev: number; hDev: number }> | null;
}

/**
 * Tier-2 strip pre-pass, shared by every surface (Cycle 22 / Task 3 for the
 * layer, Cycle 26 for the screen — one implementation now).
 *
 * For every data row this pass touches: an eligible row with a current strip
 * (`get` hit on rowId + rowVersion + layoutEpoch) is CONSUMED — recorded for a
 * device-px blit after the cells+gridlines pass and added to `skipRows` so both
 * painters skip it. An eligible row that missed is a CAPTURE candidate — but
 * only when this pass fully covers it (a full-width, row-spanning rect): a
 * cell-sized damage rect repaints one cell into a row whose remaining pixels
 * may be anything (even an unrastered pending band), so copying such a row out
 * would retain garbage. Every ambiguity bypasses live (a bypass is a perf miss;
 * a stale strip is a bug).
 *
 * Returns `null` when the tier is dormant — with no target the call sequence
 * downstream stays byte-identical to the shipped pipeline.
 */
function planStrips(
  target: StripTarget | null,
  vs: ViewportState,
  full: boolean,
  rects: Rect[],
  surfaceWidth: number,
  db: { minX: number; minY: number; maxX: number; maxY: number } | null,
): StripPlan | null {
  if (target === null) return null;
  const { ctx: strips, canvas, originY } = target;
  const epoch = strips.layoutEpoch();
  const dpr = strips.dpr;
  const st = strips.stats;
  let skipRows: Set<number> | null = null;
  let blits: StripPlan['blits'] = null;
  let captures: StripPlan['captures'] = null;
  for (const row of vs.visibleRows) {
    if (!row.subgrid.isData) continue;
    // Rows partially clamped by the body region paint clamped bg bundles /
    // suppressed edge gridlines — never strip-able (a strip must be a
    // position-independent full-row raster).
    if (row.top < vs.bodyTop || row.bottom > vs.bodyBottom) continue;
    // Rows outside this pass's damage aren't repainted (their pixels are
    // already correct) — neither blit nor capture applies.
    if (db !== null && (row.bottom < db.minY || row.top > db.maxY)) continue;
    const ri = row.localRowIndex;
    if (!strips.eligible(ri)) continue;
    const rowId = strips.stringRowIdAt(ri);
    if (rowId === null || rowId === '') continue;
    const version = strips.rowVersionOf(ri);
    if (version === null) continue;
    const yDev = Math.round((row.top - originY) * dpr);
    const hDev = Math.round((row.bottom - originY) * dpr) - yDev;
    if (hDev <= 0 || yDev < 0 || yDev + hDev > canvas.height) continue;
    const hit = strips.cache.get(rowId, version, epoch);
    if (hit !== null && hit.width === canvas.width && hit.height === hDev) {
      (skipRows ??= new Set()).add(ri);
      (blits ??= []).push({ strip: hit, yDev });
      if (st) st.stripHits++;
      continue;
    }
    const covered = full || rects.some(
      (r) => r.x <= 0 && r.x + r.w >= surfaceWidth && r.y <= row.top && r.y + r.h >= row.bottom,
    );
    if (st) {
      st.stripMisses++;
      // Closeout M-4 — split out misses this pass could never have turned
      // into a capture anyway (cell-sized partial rects that don't cover the
      // row): on a steady ticking feed these dominate the raw miss counter and
      // made the Tier-2 hit ratio look far worse than it is. `stripMisses`
      // keeps its original meaning (every eligible-but-unserved row per pass);
      // subtract this to get "misses with a real capture candidate".
      if (!covered) st.stripMissesUncoverable++;
    }
    if (covered) (captures ??= []).push({ rowId, version, yDev, hDev });
  }
  return { target, epoch, skipRows, blits, captures };
}

/**
 * Tier-2 consume: one untransformed DEVICE-px `drawImage` per hit strip at the
 * row's device y on this surface. Runs AFTER cells+gridlines (a row-bg bundle
 * may span skipped rows — the opaque strip overpaints it, byte-identical to
 * what the live pass captured) and BEFORE the sticky band / overlays (they
 * paint over blitted and fresh rows alike).
 *
 * Same save/setTransform(identity)/restore discipline as
 * `PaintCacheLayer.shift`: mixing a device-px source with a CTM-scaled
 * destination is the C1 bug class. Raw save/restore (not `.cache.`) — only the
 * transform changes, no cached state values.
 *
 * In a partial screen paint this runs INSIDE the damage clip, which correctly
 * restricts the blit to the repainted region — the strip's pixels there are
 * byte-identical to what the live painters would produce.
 */
function consumeStrips(gc: CachedContext2D, plan: StripPlan): void {
  if (plan.blits === null) return;
  gc.save();
  gc.setTransform(1, 0, 0, 1, 0, 0);
  for (const b of plan.blits) {
    gc.drawImage(
      b.strip as unknown as CanvasImageSource,
      0, 0, b.strip.width, b.strip.height,
      0, b.yDev, b.strip.width, b.strip.height,
    );
  }
  gc.restore();
}

/**
 * Tier-2 capture: copy each fully-repainted eligible row out of this surface's
 * backing store, strictly AFTER the band's gridlines landed and strictly BEFORE
 * the sticky band / overlays paint over it — overlays must NEVER enter a strip.
 * Device-px copy-out; no gc calls.
 */
function captureStrips(plan: StripPlan): void {
  if (plan.captures === null) return;
  const { ctx: strips, canvas } = plan.target;
  for (const c of plan.captures) {
    strips.cache.capture(
      { rowId: c.rowId, rowVersion: c.version, layoutEpoch: plan.epoch },
      canvas, c.yDev, canvas.width, c.hDev,
    );
    if (strips.stats) strips.stats.stripCaptures++;
  }
}

/**
 * Collapse target #3 — one paint pipeline, parameterized by surface.
 *
 * Legacy shipped two: `Renderer.paint()` (the whole frame onto the screen) and
 * `paintLayer` + `paintChrome` (data rows into the retained offscreen layer,
 * chrome onto the screen), with the Tier-2 strip block copied for the two Y
 * bases and a comment stating `buildPctx` was deliberately NOT shared with
 * `paint()`. Everything the three passes actually differ by is now a field on
 * this descriptor; the ordering invariants (SPEC.md §1.1) live in exactly one
 * place, `Renderer.renderSurface`.
 */
interface SurfacePass {
  /** The viewport this pass paints against — the live one for the screen and
   *  chrome passes, `buildLayerViewport`'s synthetic widened one for the layer
   *  pass. */
  viewport: ViewportState;
  full: boolean;
  /** Damage rects already mapped into THIS surface's coordinate space. */
  rects: Rect[];
  /** Total drawable width of this surface in CSS px — the strip pre-pass's
   *  "full-width rect" test and nothing else. */
  surfaceWidth: number;
  /** 3rd arg for `getVisibleCellBounds` — see its doc on `RendererOpts`. The
   *  layer pass threads `layerVs` so the baked focus ring / range overlay
   *  resolve against the layer's own (possibly off-screen) coverage; the
   *  screen and chrome passes leave it undefined (the real viewport). */
  boundsVs?: ViewportState;
  /** Region filter for `paintCellsByRows` / `paintGridLines`. */
  byRowsMode: ByRowsMode;
  /** Tier-2 strips, or `null` when the tier is dormant for this pass (always
   *  for chrome — chrome rows are never strip content). */
  stripTarget: StripTarget | null;
  /** Scroll self-blit delta in CSS px, or `null` for no blit. Screen only. */
  blitDy: number | null;
  /** Background fill for a FULL paint. Each surface owns a different extent:
   *  the whole canvas (screen), the layer's own body span (layer), or the
   *  canvas MINUS the data-body region (chrome — the present pass already
   *  covers `[bodyTop, bodyBottom]` with the layer's content). */
  fillFull: (gc: CachedContext2D, theme: ResolvedTheme) => void;
  /** Whether a partial pass with an EMPTY rect list still runs the paint body
   *  (under a clip that admits nothing). True for the screen pass, which gets
   *  here only when it has a blit to serve; false for chrome, whose empty
   *  partial is the present-only fast path — it skips the raster entirely and
   *  goes straight to the sticky band. */
  rasterOnEmptyPartial: boolean;
  /** Bake the focus ring + range overlay. The layer pass bakes them because it
   *  runs against the SAME viewport/CTM as its cell paints; the chrome pass
   *  must not (they already live in the presented layer pixels). */
  overlays: boolean;
  /** `'inside'`: with the frame, before the overlays, under the damage clip.
   *  `'outside'`: after the clip is released — the chrome pass paints the band
   *  over the just-presented data blit, unconditionally, whenever ancestors
   *  exist. `'none'`: never (the layer pass — the band is screen chrome). */
  sticky: 'inside' | 'outside' | 'none';
}

/** Damage-region rendering — bounding box of a set of already-merged damage
 *  rects, in the same coordinate space as `PainterCtx.damageBounds`. Used by
 *  `byRows.ts` to cull whole rows/columns whose bounds fall entirely outside
 *  the damaged area under partial repaint. */
function boundsOf(rects: Rect[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { minX, minY, maxX, maxY };
}

export class Renderer {
  constructor(private opts: RendererOpts) {}

  /**
   * `damage` is `undefined` or `{ full: true, ... }` for the full-surface
   * screen paint. `{ full: false, chromeRects, dataRects, blit }` clips the
   * canvas to the union of both rect arrays and background-fills only that
   * union instead of the whole surface — `byRows.ts` additionally culls rows/
   * columns outside `pctx.damageBounds`. An empty union under partial damage
   * means nothing visible changed, so `paint` returns immediately without
   * touching the canvas.
   *
   * `chromeRects` are already screen space; `dataRects` are CONTENT space and
   * map back to screen space via `dataRectToScreen`, using the LIVE viewport's
   * `scrollTop`/`bodyTop` (read fresh here, the same live-viewport discipline
   * the rest of this method follows).
   */
  paint(gc: CachedContext2D, damage?: ResolvedDamage): void {
    const partial = damage !== undefined && !damage.full;
    const viewport = this.opts.getViewport();
    const rects = partial
      ? damage.chromeRects.concat(
          damage.dataRects.map((r) => dataRectToScreen(r, { scrollTop: viewport.scrollTop, bodyTop: viewport.bodyTop })),
        )
      : [];
    if (partial && rects.length === 0 && !damage.blit) return; // nothing visible changed
    const w = this.opts.getCanvasWidth();
    const h = this.opts.getCanvasHeight();

    // Cycle 26 — the Tier-2 row-strip lever the raster-grain bench decided for
    // no-GPU hosts (PERF-NOTES "cellBlit+strips wins both OpenFin regimes").
    // It was previously wired ONLY into the retained-layer path, which
    // `qualityMode`'s software-raster resolution turns OFF — i.e. the one
    // pipeline that runs on those hosts was the one without strips. Here the
    // raster target/capture source is the on-screen canvas, so `originY` is 0.
    const strips = this.opts.getRasterStrips?.() ?? null;
    const screenCanvas = strips !== null
      ? this.opts.getCanvasElement?.() as (HTMLCanvasElement & CanvasImageSource) | undefined
      : undefined;
    const stripTarget: StripTarget | null =
      strips !== null && screenCanvas !== undefined
        && typeof screenCanvas.width === 'number' && typeof screenCanvas.height === 'number'
        ? {
            ctx: strips,
            canvas: screenCanvas as unknown as PaintCacheCanvasLike & CanvasImageSource,
            originY: 0,
          }
        : null;

    this.renderSurface(gc, {
      viewport,
      full: !partial,
      rects,
      surfaceWidth: w,
      byRowsMode: undefined,
      stripTarget,
      blitDy: partial && damage.blit ? damage.blit.dy : null,
      fillFull: (g, theme) => {
        // Fill the entire drawable area with theme bg as the FIRST instruction
        // so there's no transparent moment between the prior frame's pixels (or
        // a freshly-cleared backing store after a canvas.width assignment) and
        // the grid content. M2 fix (stale since HiDPI backing landed) — the
        // backing store is sized to `round(cssPx * dpr)` device px, NOT CSS px;
        // we draw in CSS px here because `gc`'s persistent CTM
        // (`setTransform(dpr, 0, 0, dpr, 0, 0)`, installed by
        // `VelocityGridCanvas.resize`) scales every CSS-px call up to the
        // device backing store automatically.
        g.cache.fillStyle = theme.bg;
        g.fillRect(0, 0, w, h);
      },
      rasterOnEmptyPartial: true,
      overlays: true,
      sticky: 'inside',
    });
  }

  /**
   * Layer raster pass (spec §3 step 2). Paints DATA-subgrid content ONLY —
   * header/floatingFilter/totals/pinned bands are chrome, painted by
   * `paintChrome` instead — into the retained layer's OWN `gc`, against
   * `layerVs` (`VelocityGrid.buildLayerViewport`'s synthetic widened viewport).
   * Overlays/focus-ring/range-selection BAKE in here (spec §1) because they run
   * against the SAME `layerVs`/translated `gc` as the cell paints.
   *
   * The caller (VelocityGrid's paint closure) is responsible for the
   * `ctx.translate(0, -bodyTop)` that lands `layerVs`'s row/column coordinates
   * at the correct LAYER-local y (`contentY - layerTop`, per
   * `PaintCacheLayer.contentToLayerY`) BEFORE calling this method — kept
   * outside so a test can drive this method against a bare recording `gc` (no
   * real dpr/translate CTM) and assert on the raw paint calls.
   *
   * `full`: fills the layer's entire extent (`layerVs`'s own body span) then
   * rasters every data row, no clip. `!full`: clips to the union of
   * `contentRects` (already in the SAME translated coordinate space) and
   * rasters only inside it — an empty `contentRects` is the present-only fast
   * path; the CALLER should skip invoking this method entirely in that case
   * (checked by the caller so a "zero calls" assertion is meaningful
   * independent of this method's own no-op guard).
   */
  paintLayer(gc: CachedContext2D, layerVs: ViewportState, full: boolean, contentRects: Rect[]): void {
    if (!full && contentRects.length === 0) return;
    const w = this.opts.getCanvasWidth();

    // The capture source is the layer's own backing store — the context's
    // canvas. Recorded-gc harnesses without a `.canvas` keep strips inert.
    const strips = this.opts.getRasterStrips?.() ?? null;
    const layerCanvas = strips !== null
      ? (gc as CanvasRenderingContext2D).canvas as unknown as (PaintCacheCanvasLike & CanvasImageSource) | undefined
      : undefined;
    const stripTarget: StripTarget | null =
      strips !== null && layerCanvas !== undefined
        && typeof layerCanvas.width === 'number' && typeof layerCanvas.height === 'number'
        // `row.top - layerVs.bodyTop` is the layer-local CSS y (the ambient
        // translate the caller installs maps layerVs rows there).
        ? { ctx: strips, canvas: layerCanvas, originY: layerVs.bodyTop }
        : null;

    this.renderSurface(gc, {
      viewport: layerVs,
      full,
      rects: contentRects,
      surfaceWidth: w,
      boundsVs: layerVs,
      byRowsMode: 'layer',
      stripTarget,
      blitDy: null,
      fillFull: (g, theme) => {
        g.cache.fillStyle = theme.bg;
        g.fillRect(0, layerVs.bodyTop, w, Math.max(0, layerVs.bodyBottom - layerVs.bodyTop));
      },
      rasterOnEmptyPartial: false,
      overlays: true,
      sticky: 'none',
    });
  }

  /**
   * Present pass (spec §3 step 3): ONE `drawImage` of the retained layer's
   * currently-visible slice onto the on-screen data-body region. The C1 lesson
   * (same class of bug as the scroll self-blit, and `PaintCacheLayer.shift`'s
   * own doc) applies identically here: the SOURCE rect addresses the layer's
   * backing store directly (DEVICE px, CTM-independent —
   * `PaintCacheLayer.visibleSrcRect` already returns device px), but the
   * DESTINATION rect goes through `gc`'s persistent
   * `setTransform(dpr,0,0,dpr,0,0)` CTM, so it MUST be passed in CSS px — or a
   * dpr≠1 backing store double-scales the paste.
   *
   * Closeout M-1 fix — `imageSmoothingEnabled = false` is scoped to this call
   * via `gc.cache.save()`/`.restore()` (the cache-aware pair, so both the real
   * ctx state AND the JS `values` cache roll back together). Before this fix
   * the flag was set and never restored, leaking `false` to every subsequent
   * painter on the MAIN context for the rest of the grid's life — latent (no
   * painter currently draws a scaled bitmap on the main canvas) but a trap for
   * the next one that does.
   */
  presentLayer(
    gc: CachedContext2D,
    layerCanvas: CanvasImageSource,
    srcWidthDevicePx: number,
    src: { sy: number; sh: number },
    dest: { bodyTop: number; bodyBottom: number; width: number },
  ): void {
    const hCss = dest.bodyBottom - dest.bodyTop;
    if (hCss <= 0 || src.sh <= 0 || srcWidthDevicePx <= 0) return;
    gc.cache.save();
    gc.cache.imageSmoothingEnabled = false;
    gc.drawImage(layerCanvas, 0, src.sy, srcWidthDevicePx, src.sh, 0, dest.bodyTop, dest.width, hCss);
    gc.cache.restore();
  }

  /**
   * Chrome raster pass (spec §3 step 4) + the sticky-band pass (step 5). Paints
   * non-data-subgrid content (header/floatingFilter/totals/pinned bands,
   * chrome-side gridlines) ON-SCREEN against the REAL viewport. `full`:
   * background-fills the canvas's non-data-body regions (the present pass
   * already covers `[bodyTop, bodyBottom]` with the layer's content) then
   * rasters every chrome row/gridline, no clip. `!full`: clips to `screenRects`
   * and rasters only inside it; an empty `screenRects` skips the raster
   * entirely (present-only fast path) — but the sticky-group band ALWAYS
   * repaints afterward, unconditionally, whenever the grid currently has sticky
   * ancestors, regardless of `full`/`screenRects` (it paints OVER the
   * just-presented data blit and manages its own save/clip/restore internally).
   */
  paintChrome(gc: CachedContext2D, full: boolean, screenRects: Rect[]): void {
    const viewport = this.opts.getViewport();
    const w = this.opts.getCanvasWidth();
    const h = this.opts.getCanvasHeight();
    this.renderSurface(gc, {
      viewport,
      full,
      rects: screenRects,
      surfaceWidth: w,
      byRowsMode: 'chrome',
      stripTarget: null,
      blitDy: null,
      fillFull: (g, theme) => {
        g.cache.fillStyle = theme.bg;
        if (viewport.bodyTop > 0) g.fillRect(0, 0, w, viewport.bodyTop);
        if (h > viewport.bodyBottom) g.fillRect(0, viewport.bodyBottom, w, h - viewport.bodyBottom);
      },
      rasterOnEmptyPartial: false,
      overlays: false,
      sticky: 'outside',
    });
  }

  /**
   * THE paint pipeline (collapse target #3). Every surface — screen, retained
   * layer, chrome — runs this one method; `pass` carries the differences.
   *
   * The order below is SPEC.md §1.1 and is semantic:
   *   1. Tier-2 strip pre-pass (blit list + skipRows) — zero gc calls
   *   2. scroll self-blit (identity CTM, integer device px)
   *   3. clip + background fill
   *   4. cells + row backgrounds (`paintCellsByRows`)
   *   5. grid lines — AFTER cells (no double-stroked seams)
   *   6. strip consume, then strip capture — after gridlines, before overlays
   *   7. sticky group band
   *   8. focus ring
   *   9. range overlay + fill handle
   */
  private renderSurface(gc: CachedContext2D, pass: SurfacePass): void {
    const { viewport, full, rects } = pass;
    // Damage-region rendering — null under full paint (no culling).
    const db = full ? null : boundsOf(rects);
    const plan = planStrips(pass.stripTarget, viewport, full, rects, pass.surfaceWidth, db);
    const pctx = this.buildPctx(viewport, db, pass.boundsVs, plan?.skipRows ?? undefined);

    if (pass.blitDy !== null) this.scrollSelfBlit(gc, viewport, pass.blitDy);

    // A partial pass with no rects paints nothing but may still owe a sticky
    // band (chrome's present-only frame) — see `rasterOnEmptyPartial`.
    if (full || rects.length > 0 || pass.rasterOnEmptyPartial) {
      if (full) {
        pass.fillFull(gc, pctx.theme);
      } else {
        // Clip to the union of damage rects so every painter below — cell
        // bundles, gridlines, sticky band, overlays — naturally stays inside
        // the damaged area even though byRows' culling is a perf optimization,
        // not a correctness requirement (the clip is the correctness backstop).
        gc.save();
        gc.beginPath();
        for (const r of rects) gc.rect(r.x, r.y, r.w, r.h);
        gc.clip();
        // Background-fill only the damaged rects, not the whole surface.
        gc.cache.fillStyle = pctx.theme.bg;
        for (const r of rects) gc.fillRect(r.x, r.y, r.w, r.h);
      }

      paintCellsByRows(gc, pctx, pass.byRowsMode);
      // Gridlines run after all cell paints so they sit on top with no
      // double-stroked seams.
      paintGridLines(gc, pctx, pass.byRowsMode);
      if (plan !== null) {
        consumeStrips(gc, plan);
        captureStrips(plan);
      }
      // Sticky group rows pin the ancestor group band above the scrollable body
      // rows. Paints after gridlines so the band bg occludes gridlines at the
      // top of the body area.
      if (pass.sticky === 'inside') paintStickyGroups(gc, pctx);
      if (pass.overlays) {
        paintOverlay(gc, pctx);
        // The range overlay paints translucent fill + opaque border per active
        // range. Runs after the focus-ring overlay so the range border doesn't
        // cut into the focus ring of an interior cell.
        paintRangeOverlay(gc, pctx);
      }
      if (!full) gc.restore();
    }

    if (pass.sticky === 'outside') paintStickyGroups(gc, pctx);
  }

  /**
   * Scroll self-blit — copies the still-valid body pixels by the scroll delta
   * BEFORE the clip/fill block repaints only the newly-exposed band (already
   * part of the pass's rects — see `DamageLedger.takeResolved`).
   *
   * Collapse target #2 — the renderer does not decide WHICH band a scroll
   * invalidated: `core/retainedBand.ts` is the single retained-pixel owner and
   * the ledger has already asked it (`ledgerExposedBand`), which is why this
   * method only executes the `dy` the ledger handed over and never re-derives
   * an exposed band. Under the retained-layer strategy the ledger's answer is
   * "not yours", the layer's own `PaintCacheLayer.shift` performs the
   * equivalent copy on the offscreen surface, and this path never runs.
   *
   * Device-px + identity CTM (same discipline as `PaintCacheLayer.shift`): the
   * previous path mixed a DEVICE-px source with a CSS-px destination under the
   * persistent `setTransform(dpr,…)` CTM. At fractional dpr (1.25 / 1.5) or
   * non-integer `bodyHeight*dpr`, that resampled the keep band and left
   * mid-viewport seams that look like squashed / uneven row heights (clipped
   * glyphs + irregular gridline spacing) until a full paint healed them. Both
   * source and dest are integer device px under an identity transform;
   * `imageSmoothingEnabled = false` keeps the copy nearest-neighbor. Silently
   * skipped when `getCanvasElement` isn't wired — the blit is an optimization,
   * never a correctness dependency.
   */
  private scrollSelfBlit(gc: CachedContext2D, viewport: ViewportState, dy: number): void {
    const canvas = this.opts.getCanvasElement?.();
    if (!canvas) return;
    const w = this.opts.getCanvasWidth();
    const dpr = this.opts.getDevicePixelRatio?.() ?? (canvas.width / Math.max(1, w));
    const bodyTopDev = Math.round(viewport.bodyTop * dpr);
    const bodyHDev = Math.round((viewport.bodyBottom - viewport.bodyTop) * dpr);
    const dyDev = Math.round(dy * dpr);
    const keepH = bodyHDev - Math.abs(dyDev);
    if (keepH <= 0 || dyDev === 0) return;
    gc.cache.save();
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.cache.imageSmoothingEnabled = false;
    if (dyDev > 0) {
      // Scrolled down: shift still-valid pixels UP, expose bottom band.
      gc.drawImage(
        canvas,
        0, bodyTopDev + dyDev, canvas.width, keepH,
        0, bodyTopDev, canvas.width, keepH,
      );
    } else {
      // Scrolled up: shift still-valid pixels DOWN, expose top band.
      const up = -dyDev;
      gc.drawImage(
        canvas,
        0, bodyTopDev, canvas.width, keepH,
        0, bodyTopDev + up, canvas.width, keepH,
      );
    }
    gc.cache.restore();
  }

  /**
   * Shared `PainterCtx` builder — now genuinely shared by all three surfaces
   * (collapse target #3; legacy deliberately kept `paint()` on its own inline
   * copy of this object literal). `boundsVs`, when supplied, threads through as
   * `getVisibleCellBounds`'s 3rd arg (see its doc): `paintLayer` passes
   * `layerVs` so the focus-ring / range overlay resolve against the layer's own
   * (possibly off-screen) coverage; the screen and chrome passes omit it and
   * hand the painters the option's own function unwrapped, which defaults the
   * 3rd arg to `undefined` — the real viewport.
   */
  private buildPctx(
    viewport: ViewportState,
    damageBounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
    boundsVs?: ViewportState,
    skipRows?: Set<number>,
  ) {
    return {
      viewport,
      theme: this.opts.getTheme(),
      columnDefs: this.opts.getColumnDefs(),
      cellRenderers: this.opts.cellRenderers,
      cellData: this.opts.cellData,
      selection: this.opts.getSelection(),
      hoveredRowIndex: this.opts.getHoveredRowIndex?.() ?? null,
      sortModel: this.opts.getSortModel(),
      totalRowCount: this.opts.getTotalRowCount?.() ?? 0,
      rowDataSnapshotAt: this.opts.rowDataSnapshotAt,
      stringRowIdAt: this.opts.stringRowIdAt,
      getRowDataById: this.opts.getRowDataById,
      engineCellStyle: this.opts.getEngineCellStyle?.(),
      themeKind: this.opts.getThemeKind?.(),
      quickFilterLowerTerms: this.opts.getQuickFilterLowerTerms(),
      showFillHandle: this.opts.getShowFillHandle(),
      suppressAggFuncInHeader: this.opts.getSuppressAggFuncInHeader(),
      getVisibleCellBounds: boundsVs === undefined
        ? this.opts.getVisibleCellBounds
        : (rowIndex: number, colId: string) => this.opts.getVisibleCellBounds(rowIndex, colId, boundsVs),
      groupRowStrip: this.opts.getGroupRowStrip(),
      rowKindAt: this.opts.getRowKindAt,
      groupHideOpenParents: this.opts.getGroupHideOpenParents(),
      stickyAncestors: this.opts.getStickyAncestors(),
      groupDepthAt: this.opts.getGroupDepthAt,
      groupKeyAt: this.opts.getGroupKeyAt,
      getStickyGroupTotals: this.opts.getStickyGroupTotals,
      getColumnGroupOpen: this.opts.getColumnGroupOpen,
      damageBounds,
      // Cycle 22 / Task 2 — Tier-1 cell-bitmap cache (null ⇒ live paint).
      // Threaded into every surface — bitmaps are rasterized at the same dpr
      // every context's CTM uses.
      rasterCells: this.opts.getRasterCells?.() ?? null,
      // Cycle 22 / Task 3 — Tier-2 strip-blitted rows this pass. Both byRows'
      // cell loop and the gridlines painter skip these; the blit after the
      // painters supplies their pixels.
      skipRows: skipRows ?? null,
    };
  }
}
