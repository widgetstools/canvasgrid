/**
 * Unified selection configuration — ag-grid v33+ `selection` API parity.
 *
 * The new shape lets apps pick one selection MODE (singleRow / multiRow
 * / cell) and configure its specifics in one place instead of spreading
 * the intent across `rowSelection` + `suppressRowClickSelection` +
 * `rowMultiSelectWithClick` + per-column `checkboxSelection` +
 * `headerCheckboxSelection` + `cellSelection`. The legacy options
 * still work — when `selection` is set it overrides them, when it's
 * omitted the existing surface is unchanged.
 *
 * Resolution happens once at construction (and on
 * `setGridOption('selection', …)`). The resolver returns an internal
 * shape the rest of cgrid already understands; no downstream code
 * needs to learn the new API.
 */

import type { CColDef } from '../types';

/** Per-row checkbox visibility — `true` for every row, callback for
 *  per-row control. */
export type RowCheckboxCallback<TRow = unknown> = (params: {
  data: TRow;
  rowIndex: number;
}) => boolean;

export type SelectionConfig<TRow = unknown> =
  | SingleRowSelectionConfig<TRow>
  | MultiRowSelectionConfig<TRow>
  | CellSelectionConfig;

export interface SingleRowSelectionConfig<TRow = unknown> {
  mode: 'singleRow';
  /** Render a row-select checkbox in a leading auto-injected
   *  pinned-left column. Defaults to `false` for single mode (single
   *  selection is typically expressed by row click, not checkbox). */
  checkboxes?: boolean | RowCheckboxCallback<TRow>;
  /** Show a tri-state header checkbox in the auto-injected column.
   *  Meaningless for single mode (only one row can be selected at
   *  a time); included for API symmetry with `multiRow`. */
  headerCheckbox?: boolean;
  /** When `false`, body-cell clicks don't toggle row selection
   *  (force checkbox-only). When `'enableDeselection'`, clicking a
   *  selected row deselects it. Default `true`. */
  enableClickSelection?: boolean | 'enableDeselection';
}

export interface MultiRowSelectionConfig<TRow = unknown> {
  mode: 'multiRow';
  checkboxes?: boolean | RowCheckboxCallback<TRow>;
  headerCheckbox?: boolean;
  enableClickSelection?: boolean | 'enableDeselection';
  /** When `true`, plain (no-modifier) clicks toggle the row's
   *  selection state. Mirrors checkbox-list semantics in email
   *  clients / file managers. Default `false`. */
  enableSelectionWithoutKeys?: boolean;
}

export interface CellSelectionConfig {
  mode: 'cell';
  /** When `true`, Ctrl+Click on a cell still accumulates disjoint
   *  ranges (Excel-style). When `false`, the click replaces the
   *  range. Default `true` for cell mode (the whole point of
   *  cell selection is Excel parity). */
  enableMultiSelectWithClick?: boolean;
}

/** Internal shape the rest of cgrid already understands. The
 *  resolver produces this from either the new `selection` config or
 *  the legacy individual options. */
export interface ResolvedSelection<TRow = unknown> {
  rowSelectionMode: 'none' | 'single' | 'multiple';
  suppressRowClickSelection: boolean;
  rowMultiSelectWithClick: boolean;
  enableDeselection: boolean;
  cellSelectionSuppressDrag: boolean;
  /** Synthetic checkbox column to PREPEND to columnDefs. `null` when
   *  no auto-injection is configured. */
  syntheticCheckboxColumn: CColDef<TRow> | null;
}

/** Resolve a `SelectionConfig` to the internal shape. Pure function;
 *  no side effects. */
export function resolveSelection<TRow = unknown>(
  selection: SelectionConfig<TRow> | undefined,
): ResolvedSelection<TRow> | null {
  if (!selection) return null;
  if (selection.mode === 'cell') {
    return {
      rowSelectionMode: 'none',
      suppressRowClickSelection: false,
      rowMultiSelectWithClick: false,
      enableDeselection: false,
      cellSelectionSuppressDrag: false,
      syntheticCheckboxColumn: null,
    };
  }
  const rowSelectionMode = selection.mode === 'multiRow' ? 'multiple' : 'single';
  // `enableClickSelection` default is true. `false` → suppress; the
  // 'enableDeselection' string still allows clicks but flags the
  // deselect behavior separately.
  const enableClick = selection.enableClickSelection ?? true;
  const suppressRowClickSelection = enableClick === false;
  const enableDeselection = enableClick === 'enableDeselection';
  const rowMultiSelectWithClick = selection.mode === 'multiRow'
    && (selection as MultiRowSelectionConfig<TRow>).enableSelectionWithoutKeys === true;

  let syntheticCheckboxColumn: CColDef<TRow> | null = null;
  if (selection.checkboxes) {
    syntheticCheckboxColumn = {
      colId: '__cg_select__',
      checkboxSelection: true,
      headerCheckboxSelection: selection.headerCheckbox === true,
      pinned: 'left',
      width: 42,
      sortable: false,
      resizable: false,
    } as CColDef<TRow>;
  }

  return {
    rowSelectionMode,
    suppressRowClickSelection,
    rowMultiSelectWithClick,
    enableDeselection,
    cellSelectionSuppressDrag: false,
    syntheticCheckboxColumn,
  };
}
