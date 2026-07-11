import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { GroupCellValue } from './cellRenderers/group';
import type { CellDataLookup } from './painters/types';
import type { SortModel, SelectionRange } from '../types';
import type { StickyAncestor } from '../worker/protocol';
import type { CachedContext2D } from './gc';
import type { ResolvedDamage, Rect } from '../core/damageLedger';
import { paintCellsByRows } from './painters/byRows';
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
  /** Total drawable width in CSS px (matches CGridCanvas.bounds.width). */
  getCanvasWidth: () => number;
  /** Total drawable height in CSS px (matches CGridCanvas.bounds.height). */
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
   * `CGridOptions.enableFillHandle` per paint so a runtime
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
   * `CGrid.getVisibleCellBounds`.
   */
  getVisibleCellBounds: (rowIndex: number, colId: string) =>
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
   * `CGridOptions.groupRowRenderer` for `'custom'` display type.
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
  getCanvasElement?: () => HTMLCanvasElement;
  /**
   * C1 fix — the live `devicePixelRatio` the canvas's backing store was
   * sized at (`CGridCanvas.devicePixelRatio`), used by the scroll blit to
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
   * `damage` is `undefined` or `{ full: true, ... }` for the legacy
   * full-surface paint (byte-identical to pre-damage-region behavior).
   * `{ full: false, rects, blit }` clips the canvas to the union of `rects`
   * and background-fills only those rects instead of the whole surface —
   * `byRows.ts` additionally culls rows/columns outside `pctx.damageBounds`.
   * An empty `rects` array under partial damage means nothing visible
   * changed, so `paint` returns immediately without touching the canvas.
   */
  paint(gc: CachedContext2D, damage?: ResolvedDamage): void {
    const partial = damage !== undefined && !damage.full;
    if (partial && damage.rects.length === 0 && !damage.blit) return; // nothing visible changed

    const pctx = {
      viewport: this.opts.getViewport(),
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
      themeKind: this.opts.getThemeKind?.(),
      quickFilterLowerTerms: this.opts.getQuickFilterLowerTerms(),
      showFillHandle: this.opts.getShowFillHandle(),
      suppressAggFuncInHeader: this.opts.getSuppressAggFuncInHeader(),
      getVisibleCellBounds: this.opts.getVisibleCellBounds,
      groupRowStrip: this.opts.getGroupRowStrip(),
      rowKindAt: this.opts.getRowKindAt,
      groupHideOpenParents: this.opts.getGroupHideOpenParents(),
      stickyAncestors: this.opts.getStickyAncestors(),
      groupDepthAt: this.opts.getGroupDepthAt,
      groupKeyAt: this.opts.getGroupKeyAt,
      getStickyGroupTotals: this.opts.getStickyGroupTotals,
      getColumnGroupOpen: this.opts.getColumnGroupOpen,
      // Damage-region rendering — null under full paint (no culling).
      damageBounds: partial ? boundsOf(damage.rects) : null,
    };
    const w = this.opts.getCanvasWidth();
    const h = this.opts.getCanvasHeight();

    // Task 5 — scroll self-blit. Copies the still-valid body pixels by the
    // scroll delta BEFORE the clip/fill block below repaints only the
    // newly-exposed band (already part of `damage.rects` — see
    // `DamageLedger.takeResolved`). C1 fix — `drawImage`'s SOURCE rect
    // addresses the canvas's backing store directly (device px,
    // CTM-independent), but the DESTINATION rect goes through `gc`'s
    // persistent `setTransform(dpr, 0, 0, dpr, 0, 0)` CTM (installed by
    // `CGridCanvas.resize`) — so the destination must be passed in CSS px,
    // NOT device px, or a dpr≠1 backing store double-scales the paste
    // (smearing a 2×-sized copy of the grid outside the damage clip on
    // every partial scroll at dpr=2). Silently skipped — falling back to
    // the ordinary clip/fill/repaint path below — when `getCanvasElement`
    // isn't wired or reports nothing; the blit is an optimization, never a
    // correctness dependency.
    if (partial && damage.blit) {
      const canvas = this.opts.getCanvasElement?.();
      if (canvas) {
        const dpr = this.opts.getDevicePixelRatio?.() ?? (canvas.width / Math.max(1, w));
        const bodyTop = pctx.viewport.bodyTop, bodyBottom = pctx.viewport.bodyBottom;
        const dy = damage.blit.dy;
        // Source rect: device px — addresses the backing store, CTM-independent.
        const sy = (bodyTop + Math.max(0, dy)) * dpr;
        const hCss = bodyBottom - bodyTop - Math.abs(dy);
        const hDevicePx = hCss * dpr;
        // Destination rect: CSS px — the CTM scales it back up to device px.
        const dyDst = bodyTop + Math.max(0, -dy);
        if (hDevicePx > 0) gc.drawImage(canvas, 0, sy, canvas.width, hDevicePx, 0, dyDst, w, hCss);
      }
    }

    if (partial) {
      // Clip to the union of damage rects so every painter below — cell
      // bundles, gridlines, sticky band, overlays — naturally stays inside
      // the damaged area even though byRows' culling is a perf optimization,
      // not a correctness requirement (the clip is the correctness backstop).
      gc.save();
      gc.beginPath();
      for (const r of damage.rects) gc.rect(r.x, r.y, r.w, r.h);
      gc.clip();
      // Background-fill only the damaged rects, not the whole surface.
      gc.cache.fillStyle = pctx.theme.bg;
      for (const r of damage.rects) gc.fillRect(r.x, r.y, r.w, r.h);
    } else {
      // Fill the entire drawable area with theme bg as the FIRST instruction
      // so there's no transparent moment between the prior frame's pixels (or
      // a freshly-cleared backing store after a canvas.width assignment) and
      // the grid content. M2 fix (stale since HiDPI backing landed) — the
      // backing store is sized to `round(cssPx * dpr)` device px, NOT CSS
      // px; we draw in CSS px here because `gc`'s persistent CTM
      // (`setTransform(dpr, 0, 0, dpr, 0, 0)`, installed by
      // `CGridCanvas.resize`) scales every CSS-px call up to the device
      // backing store automatically.
      gc.cache.fillStyle = pctx.theme.bg;
      gc.fillRect(0, 0, w, h);
    }

    paintCellsByRows(gc, pctx);
    // Gridlines run after all cell paints so they sit on top with no double-stroked
    // seams. Sticky group band paints over the body rows (below the header).
    paintGridLines(gc, pctx);
    // Cycle 15 / Task 16 — sticky group rows pin the ancestor group band
    // above the scrollable body rows. Paints after gridlines so the band
    // bg occludes gridlines at the top of the body area.
    paintStickyGroups(gc, pctx);
    paintOverlay(gc, pctx);
    // Cycle 9 / Task 3 — range overlay paints translucent fill + opaque
    // border per active range. Runs after the focus-ring overlay so the
    // range border doesn't cut into the focus ring of an interior cell.
    paintRangeOverlay(gc, pctx);

    if (partial) gc.restore();
  }
}
