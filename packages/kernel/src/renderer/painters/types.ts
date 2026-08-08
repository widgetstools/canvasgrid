import type { ViewportState } from '../../core/viewport';
import type { ResolvedTheme } from '../../theming/cssReader';
import type { ResolvedColDef } from '../../core/propertyChain';
import type { CellRendererRegistry } from '../cellRenderers/registry';
import type { GroupCellValue } from '../cellRenderers/group';
import type { SortModel, SelectionRange } from '../../types';
import type { StickyAncestor } from '../../worker/protocol';
import type { CellBitmapCache, RowStripCache } from '../rasterCache';

/**
 * Cycle 22 / Task 2 — Tier-1 cell-bitmap cache handle threaded into the
 * byRows cell-paint seam. `cache` is the content-keyed bitmap store
 * (`renderer/rasterCache/cellCache.ts`); `dpr` is the devicePixelRatio the
 * bitmaps must be rasterized at (must match the CTM scale of the context
 * they're blitted into — main canvas AND retained layer both run the same
 * `setTransform(dpr,0,0,dpr,0,0)`). `stats`, when present, receives the
 * per-cell hit/miss/bypass counters (VelocityGrid passes its live `PaintStats`
 * object). Absent/null ⇒ every cell paints live, byte-identical to the
 * shipped pipeline.
 */
export interface RasterCellsCtx {
  cache: CellBitmapCache;
  dpr: number;
  /** Cycle 22 / Task 4 — the OPAQUE surface color every live cell paints
   *  over (`theme.bg`: the byRows surface fill that row-bg bundles
   *  composite semi-transparent colors onto — see byRows step 4). A miss
   *  raster must fill this FIRST so the scratch reproduces the live
   *  compositing base: rendering a translucent prefill/bg into a CLEARED
   *  (transparent) scratch instead composites it twice through 8-bit
   *  premultiplied storage (once into the bitmap, once at the blit) — up
   *  to ~5 LSB off the live single composite (cursor-dark's 2%-alpha
   *  zebra, caught by the raster-on-vs-off E2E invariance arm). Epoch
   *  discipline: bitmap pixels now depend on this color, which only moves
   *  on a theme swap — already covered by `rasterCacheEpochBump`. */
  surfaceBg: string;
  stats?: {
    cellCacheHits: number;
    cellCacheMisses: number;
    cellCacheBypasses: number;
  };
}

/**
 * Cycle 22 / Task 3 — Tier-2 row-strip cache handle threaded into the
 * retained layer's band raster (`Renderer.paintLayer`). One strip = one
 * fully-rastered data row (cells + gridlines, NEVER overlays), keyed by
 * `(rowId, rowVersion, layoutEpoch)`.
 *
 * All lookups take the DATA-space row index (`ViewportRow.localRowIndex`
 * — the same index space `cellData`/`stringRowIdAt` use):
 *  - `eligible(rowIndex)` is the binding capture/consume contract: `true`
 *    only for a plain data row — not hovered, not selected, not holding
 *    the focused cell, no live flash on any of its cells, no active
 *    quick-filter terms, not a group/footer/totals/pinned/sticky row.
 *    Anything else paints live (a bypass is a perf miss; a stale strip
 *    is a bug). VelocityGrid owns the implementation; the renderer only asks.
 *  - `rowVersionOf` / `stringRowIdAt` return `null` to force a bypass
 *    (row outside the chunk window, no real rowId).
 *  - `layoutEpoch()` is VelocityGrid's monotonic column-geometry/theme/dpr/
 *    canvas-width/quick-filter/sort epoch — a strip captured under any
 *    other epoch never consumes.
 *
 * `dpr` is the devicePixelRatio the retained layer's backing store is
 * sized at this paint: captures copy DEVICE px out of the layer canvas
 * and consumes blit DEVICE px back in (untransformed, the
 * `PaintCacheLayer.shift` discipline). `stats`, when present, receives
 * the strip hit/miss/capture/patch counters (VelocityGrid passes its live
 * `PaintStats`). Absent/null ⇒ the strip path is fully dormant and the
 * call sequence is byte-identical to the shipped pipeline.
 */
export interface RasterStripsCtx {
  cache: RowStripCache;
  dpr: number;
  rowVersionOf(rowIndex: number): number | null;
  stringRowIdAt(rowIndex: number): string | null;
  eligible(rowIndex: number): boolean;
  layoutEpoch(): number;
  stats?: {
    stripHits: number;
    stripMisses: number;
    /** Closeout M-4 — subset of `stripMisses` where this raster's rects
     *  could never have captured the row anyway (partial, cell-sized). */
    stripMissesUncoverable: number;
    stripCaptures: number;
    stripPatches: number;
  };
}

export type CellDataLookup = (
  rowIndex: number,
  colId: string,
) => { value: unknown; valueFormatted: string; flashAlpha?: number; flashColor?: string } | null;

export interface PainterCtx {
  viewport: ViewportState;
  theme: ResolvedTheme;
  columnDefs: Map<string, ResolvedColDef>;
  cellRenderers: CellRendererRegistry;
  cellData: CellDataLookup;
  selection: {
    focusedRowIndex: number | null;
    focusedColId: string | null;
    selectedRowIndices: Set<number>;
    /** Cycle 9 / Task 3 — active cell-range selections from the
     *  `SelectionModel`. The rangeOverlayPainter reads this list to
     *  paint translucent fill + opaque border per contiguous rect. */
    ranges: SelectionRange[];
  };
  /** Cycle 21i / Phase 1 — hovered data-row index (or null / absent).
   *  When set, the byRows painter draws the `--vg-row-hover-bg` band on
   *  that row (below selection). Already gated by
   *  `suppressRowHoverHighlight` upstream. */
  hoveredRowIndex?: number | null;
  /** Total visible row count after filter/sort. Used by the header
   *  painter for the row-select header tri-state checkbox: state
   *  resolves to `'all'` when selectedRowIndices.size === this
   *  count, `'none'` at zero, `'partial'` in between. Optional so
   *  pre-Cycle-24 test harnesses building partial PainterCtx
   *  instances don't break (the byRows painter falls back to 0
   *  when absent, which collapses to `'none'`). */
  totalRowCount?: number;
  sortModel: SortModel;
  /**
   * Synchronous best-effort row snapshot from the current viewport chunk,
   * keyed by colId. Resolves once per data row in the painter — all cells
   * in that row share the same snapshot for `cellClassRules` predicates and
   * function-form `cellStyle` / `cellClass` callbacks. Returns `{}` when the
   * row has not been chunked yet. Cycle 6 / Task 7.
   */
  rowDataSnapshotAt: (rowIndex: number) => Record<string, unknown>;
  /** Cycle 21e / Task 11 — real string rowId for a visible data row
   *  (chunk `stringRowIds` mirror). `''`/null → row not rule-evaluable. */
  stringRowIdAt?: (rowIndex: number) => string | null;
  /** Cycle 21e / Task 11 — full row from the main-thread rowDataById
   *  mirror. The paint snapshot only covers visible columns; rule
   *  conditions must see hidden fields too. */
  getRowDataById?: (rowId: string) => unknown;
  /** Cycle 21e / Task 11 — active theme kind for rule eval contexts. */
  themeKind?: 'light' | 'dark';
  /**
   * Cycle 7 / Task 7 — pre-lowercased quick-filter terms. Empty when no
   * quick filter is active. Painter calls `cellMatchesAnyQuickFilterTerm`
   * per visible data cell and overrides `bg` with `theme.quickFilterMatchBg`
   * on a hit. Reading lowercased upfront avoids re-lowering the term per
   * cell per frame.
   */
  quickFilterLowerTerms: readonly string[];
  /**
   * Cycle 9 / Task 5 — when true, the range painter draws a 6×6 fill
   * handle at the bottom-right of the LAST range. Sourced from
   * `VelocityGridOptions.enableFillHandle` at the start of each paint.
   */
  showFillHandle: boolean;
  /**
   * Cycle 14 / Task 4 — grid-level `suppressAggFuncInHeader` flag. When
   * `true`, leaf header text reads the raw `headerName`; when `false`
   * (the default), columns with an `aggFunc` decorate to
   * `${aggFuncName}(${headerName})`. Per-column overrides
   * (`ResolvedColDef.suppressAggFuncInHeader`) win when set. Read per
   * paint so a runtime `setGridOption('suppressAggFuncInHeader', …)`
   * lights up on the next rAF.
   */
  suppressAggFuncInHeader: boolean;
  /** Returns visible (band-clipped) bounds for the cell, or null when
   *  the cell straddles or has scrolled out of its column's band.
   *  Sourced from VelocityGrid.getVisibleCellBounds (Cycle 12 / Task 1). */
  getVisibleCellBounds: (rowIndex: number, colId: string) =>
    { x: number; y: number; w: number; h: number } | null;
  /**
   * Cycle 15 / Task 5 — group-row "full-row strip" mode. Non-null when
   * `groupDisplayType` resolves to `'groupRows'` or `'custom'`. In that
   * mode the body painter:
   *   - replaces the data row's bg with `theme.groupRowBg` on any data
   *     row whose `lookup(rowIndex)` returns a non-null group context;
   *   - skips per-cell painting on those rows (the strip is full-width,
   *     not per-column);
   *   - invokes the strip `renderer` once per strip row with bounds
   *     spanning the full visible band so the chevron + value + (count)
   *     read as a continuous label across left-pinned + center +
   *     right-pinned columns.
   *
   * `renderer` is the cellRenderer key the painter looks up via the
   * registry — defaults to `'group'` from velocityGrid.ts; apps override via
   * `VelocityGridOptions.groupRowRenderer` for `'custom'` display type.
   *
   * Design plan:
   *   `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 5.
   */
  groupRowStrip: {
    renderer: string;
    lookup: (rowIndex: number) => GroupCellValue | null;
  } | null;
  /**
   * Cycle 15 / Task 12 — per-row kind probe for the chunk's
   * `rowKinds[localIndex]` array. Returns `0` for ordinary data rows
   * (the default), `1` for group rows, `3` for per-group footer rows.
   * The painter reads it once per visible data row to decide:
   *   - whether to paint `theme.groupFooterBg` instead of the data-row
   *     bg / alt-row / selection bg (rowKind === 3);
   *   - whether to route cells through the `'groupFooter'` renderer
   *     and flip `isGroupFooter: true` on `applyCellProps`.
   *
   * Returns `0` when no chunk is loaded yet OR when the row index is
   * outside the current chunk window (defensive default — paints as
   * data row). Cheap O(1) lookup; called once per visible data row,
   * not per cell. Optional so test harnesses that build partial
   * `PainterCtx` instances pre-Task-12 don't need to thread a stub
   * through — the byRows painter falls back to "no footer rows" when
   * the probe is absent.
   */
  rowKindAt?: (rowIndex: number) => number;
  /**
   * Cycle 15.5 / Task 4 — when `true`, the sticky group band is
   * suppressed (a hidden open parent can't be pinned). Sourced from
   * `VelocityGridOptions.groupHideOpenParents`. */
  groupHideOpenParents?: boolean;
  /**
   * Cycle 15 / Task 16 — sticky group row ancestors above the current
   * first visible row. Empty when grouping is inactive or the first
   * visible row is at position 0. Sorted depth-ascending so the painter
   * can stack them top-to-bottom from bodyTop.
   */
  stickyAncestors?: StickyAncestor[];
  /**
   * Cycle 15 / Task 16 — group depth for a row index (same index space
   * as `rowKindAt`). Returns 0 when the row is not in the current chunk
   * or when grouping is inactive.
   */
  groupDepthAt?: (rowIndex: number) => number;
  /**
   * Cycle 15 / Task 16 — composite group key for a row index (same
   * index space as `rowKindAt`). Returns `''` for data rows or when the
   * row is outside the current chunk.
   */
  groupKeyAt?: (rowIndex: number) => string;
  /**
   * Cycle 15.5 — look up a formatted aggregate value for a sticky ancestor's
   * group key + colId. Returns null when the column has no aggFunc or the
   * group key is unknown. Supplied by velocityGrid.ts via totalsCellLookup.
   */
  getStickyGroupTotals?: (groupKey: string, colId: string) => { value: unknown; valueFormatted: string } | null;
  /**
   * Cycle 18 / Task 4 — column group open/closed lookup used by the
   * byRows painter to draw a chevron on branch pivot column-group
   * headers. Returns the group's current open state; treats unknown
   * group ids as open so non-pivot Cycle 4 group headers never paint
   * an accidental chevron.
   */
  getColumnGroupOpen?: (groupId: string) => boolean;
  /**
   * Damage-region rendering — the bounding box (canvas px) of the current
   * paint's damage rects, or `null` under a full-surface paint. When set,
   * `byRows.ts` culls rows/columns entirely outside these bounds as a perf
   * optimization; the renderer's clip (set up in `Renderer.paint`) is the
   * correctness backstop so an imprecise cull can never under-paint.
   * Optional so pre-existing test harnesses building a partial `PainterCtx`
   * don't need to thread a stub through — absence means "no culling".
   */
  damageBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * Cycle 22 / Task 2 — Tier-1 cell-bitmap cache (see `RasterCellsCtx`).
   * Optional AND nullable so pre-existing test harnesses building partial
   * `PainterCtx` instances need no stub — absence means "paint every cell
   * live", exactly the shipped pipeline (`rasterCache: false`).
   */
  rasterCells?: RasterCellsCtx | null;
  /**
   * Cycle 22 / Task 3 — data-space row indices (`ViewportRow.
   * localRowIndex`) whose pixels are being served by a Tier-2 strip blit
   * this pass. The byRows row loop skips these rows' cell paints and the
   * gridlines painter skips their horizontal row strokes — both come
   * WITH the strip (captured strictly after the band's gridlines).
   * Optional AND nullable so every pre-existing harness building a
   * partial `PainterCtx` needs no stub — absence means "skip nothing",
   * exactly the shipped pipeline.
   */
  skipRows?: Set<number> | null;
}
