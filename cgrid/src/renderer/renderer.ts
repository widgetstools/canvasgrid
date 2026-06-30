import type { ViewportState } from '../core/viewport';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ResolvedTheme } from '../theming/cssReader';
import type { CellRendererRegistry } from './cellRenderers/registry';
import type { GroupCellValue } from './cellRenderers/group';
import type { CellDataLookup } from './painters/types';
import type { SortModel, SelectionRange } from '../types';
import type { StickyAncestor } from '../worker/protocol';
import type { CachedContext2D } from './gc';
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
}

export class Renderer {
  constructor(private opts: RendererOpts) {}

  paint(gc: CachedContext2D): void {
    const pctx = {
      viewport: this.opts.getViewport(),
      theme: this.opts.getTheme(),
      columnDefs: this.opts.getColumnDefs(),
      cellRenderers: this.opts.cellRenderers,
      cellData: this.opts.cellData,
      selection: this.opts.getSelection(),
      sortModel: this.opts.getSortModel(),
      totalRowCount: this.opts.getTotalRowCount?.() ?? 0,
      rowDataSnapshotAt: this.opts.rowDataSnapshotAt,
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
    };
    // Fill the entire drawable area with theme bg as the FIRST instruction so
    // there's no transparent moment between the prior frame's pixels (or a
    // freshly-cleared backing store after a canvas.width assignment) and the
    // grid content. CGridCanvas sized the canvas to CSS px so we draw in CSS px.
    const w = this.opts.getCanvasWidth();
    const h = this.opts.getCanvasHeight();
    gc.cache.fillStyle = pctx.theme.bg;
    gc.fillRect(0, 0, w, h);
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
  }
}
