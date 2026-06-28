import type { ViewportState } from '../../core/viewport';
import type { ResolvedTheme } from '../../theming/cssReader';
import type { ResolvedColDef } from '../../core/propertyChain';
import type { CellRendererRegistry } from '../cellRenderers/registry';
import type { GroupCellValue } from '../cellRenderers/group';
import type { SortModel, SelectionRange } from '../../types';
import type { StickyAncestor } from '../../worker/protocol';

export type CellDataLookup = (
  rowIndex: number,
  colId: string,
) => { value: unknown; valueFormatted: string; flashAlpha?: number } | null;

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
  sortModel: SortModel;
  /**
   * Synchronous best-effort row snapshot from the current viewport chunk,
   * keyed by colId. Resolves once per data row in the painter — all cells
   * in that row share the same snapshot for `cellClassRules` predicates and
   * function-form `cellStyle` / `cellClass` callbacks. Returns `{}` when the
   * row has not been chunked yet. Cycle 6 / Task 7.
   */
  rowDataSnapshotAt: (rowIndex: number) => Record<string, unknown>;
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
   * `CGridOptions.enableFillHandle` at the start of each paint.
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
   *  Sourced from CGrid.getVisibleCellBounds (Cycle 12 / Task 1). */
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
   * registry — defaults to `'group'` from cgrid.ts; apps override via
   * `CGridOptions.groupRowRenderer` for `'custom'` display type.
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
   * `CGridOptions.groupHideOpenParents`. */
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
   * group key is unknown. Supplied by cgrid.ts via totalsCellLookup.
   */
  getStickyGroupTotals?: (groupKey: string, colId: string) => { value: unknown; valueFormatted: string } | null;
}
