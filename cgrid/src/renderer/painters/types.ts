import type { ViewportState } from '../../core/viewport';
import type { ResolvedTheme } from '../../theming/cssReader';
import type { ResolvedColDef } from '../../core/propertyChain';
import type { CellRendererRegistry } from '../cellRenderers/registry';
import type { SortModel, SelectionRange } from '../../types';

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
}
