import type {
  CColDef, CValueGetterParams, CValueFormatterParams, ColCellOverrides,
  CCellRendererSelector, CValueParserParams, CValueSetterParams,
  CellEditorCtor, EditableCallback, SuppressKeyboardEventCallback,
} from '../types';
import type { CellPaintConfig } from '../renderer/cellRenderers/registry';
import type { ResolvedTheme } from '../theming/cssReader';

export type { ColCellOverrides };

export interface ResolvedColDef<TRow = any> {
  colId: string;
  field?: keyof TRow & string;
  headerName: string;
  width?: number;
  flex?: number;
  minWidth: number;
  maxWidth: number;
  pinned?: 'left' | 'right';
  type: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => unknown;
  valueFormatter?: (params: CValueFormatterParams<TRow, unknown>) => string;
  cellRenderer: string;
  /** Static params forwarded to the painter as `CellPaintConfig.params`. */
  cellRendererParams?: unknown;
  /** Per-cell renderer selector (see `CCellRendererSelector`). */
  cellRendererSelector?: CCellRendererSelector<TRow>;
  comparator?: (a: unknown, b: unknown, ar: TRow, br: TRow) => number;
  filter?: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable: boolean;
  resizable: boolean;
  editable: boolean | EditableCallback<TRow, unknown>;
  /** Per-column override of grid-level `singleClickEdit`. Undefined =
   *  inherit from grid options. */
  singleClickEdit?: boolean;
  /** Per-column key-event short-circuit. Mirrors
   *  `CColDef.suppressKeyboardEvent`. */
  suppressKeyboardEvent?: SuppressKeyboardEventCallback<TRow>;
  /** Built-in editor key or a custom `ICellEditor` constructor. See
   *  `CColDef.cellEditor` in `types.ts` for full semantics. */
  cellEditor?: string | CellEditorCtor<TRow, unknown>;
  /** Static params or callback forwarded into `ICellEditorParams.params`. */
  cellEditorParams?: Record<string, unknown> | ((row: TRow) => Record<string, unknown>);
  cellStyle?: ColCellOverrides;
  /** See `CColDef.autoHeight`. When true, the worker measures wrapped-text
   *  height for every visible row in this column and contributes the result
   *  into the row's resolved height. Cycle 5 / Task 8. */
  autoHeight?: boolean;
  /** See `CColDef.valueParser`. Invoked at editor-commit time before the
   *  worker transaction is queued. */
  valueParser?: (params: CValueParserParams<TRow, unknown>) => unknown;
  /** See `CColDef.valueSetter`. Mutates `data` in place. */
  valueSetter?: (params: CValueSetterParams<TRow, unknown>) => boolean | void;
  /** `null` when the leaf is always visible; `'open'` / `'closed'` only when
   *  the parent column group is in that state. Resolved by
   *  `resolveVisibleLeaves` in `core/columnGroupState.ts`. */
  columnGroupShow: 'open' | 'closed' | null;
}

export interface ApplyCellPropsInput {
  theme: ResolvedTheme;
  colDef: ResolvedColDef;
  value: unknown;
  valueFormatted: string;
  x: number; y: number; w: number; h: number;
  rowBg: string;
  prefillColor: string;
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isHeader: boolean;
  iconColor?: string;
  sortDirection?: 'asc' | 'desc';
  flashAlpha?: number;
  /** Resolved per-cell renderer params (see `CellPaintConfig.params`). */
  params?: unknown;
}

/** Repopulate `target` in place. The caller reuses a single config object
 * across the whole frame to keep paint allocation-free. */
export function applyCellProps(target: CellPaintConfig, ctx: ApplyCellPropsInput): void {
  const cs = ctx.colDef.cellStyle;
  target.value = ctx.value;
  target.valueFormatted = ctx.valueFormatted;
  target.bounds.x = ctx.x;
  target.bounds.y = ctx.y;
  target.bounds.w = ctx.w;
  target.bounds.h = ctx.h;
  target.font = cs?.font ?? ctx.theme.font;
  target.fg = ctx.isHeader
    ? ctx.theme.headerFg
    : (cs?.fg ?? ctx.theme.fg);
  target.bg = ctx.rowBg;
  target.borderColor = ctx.theme.gridLineColor;
  target.halign = cs?.halign ?? (ctx.colDef.type === 'number' ? 'right' : 'left');
  target.prefillColor = ctx.prefillColor;
  target.isFocused = ctx.isFocused;
  target.isSelected = ctx.isSelected;
  target.isHovered = ctx.isHovered;
  target.isHeader = ctx.isHeader;
  target.iconColor = ctx.iconColor;
  target.sortDirection = ctx.sortDirection;
  target.flashAlpha = ctx.flashAlpha;
  target.params = ctx.params;
}

export function resolveColDef<TRow>(
  colDef: CColDef<TRow>,
  defaultColDef: Partial<CColDef<TRow>> = {},
): ResolvedColDef<TRow> {
  const merged: CColDef<TRow> = { ...defaultColDef, ...colDef };

  const colId = merged.colId ?? merged.field;
  if (!colId) {
    throw new Error('[cgrid] ColDef must have colId or field');
  }

  const type = merged.type ?? 'text';

  return {
    colId,
    field: merged.field,
    headerName: merged.headerName ?? String(merged.field ?? colId),
    width: merged.width,
    flex: merged.flex,
    minWidth: merged.minWidth ?? 30,
    maxWidth: merged.maxWidth ?? Number.POSITIVE_INFINITY,
    pinned: merged.pinned,
    type,
    valueGetter: merged.valueGetter as ResolvedColDef<TRow>['valueGetter'],
    valueFormatter: merged.valueFormatter as ResolvedColDef<TRow>['valueFormatter'],
    valueParser: merged.valueParser as ResolvedColDef<TRow>['valueParser'],
    valueSetter: merged.valueSetter as ResolvedColDef<TRow>['valueSetter'],
    cellRenderer: merged.cellRenderer ?? type,
    cellRendererParams: merged.cellRendererParams,
    cellRendererSelector: merged.cellRendererSelector as ResolvedColDef<TRow>['cellRendererSelector'],
    comparator: merged.comparator as ResolvedColDef<TRow>['comparator'],
    filter: merged.filter,
    aggFunc: merged.aggFunc,
    sortable: merged.sortable ?? true,
    resizable: merged.resizable ?? true,
    editable: (merged.editable ?? false) as ResolvedColDef<TRow>['editable'],
    singleClickEdit: merged.singleClickEdit,
    suppressKeyboardEvent: merged.suppressKeyboardEvent as ResolvedColDef<TRow>['suppressKeyboardEvent'],
    cellEditor: merged.cellEditor as ResolvedColDef<TRow>['cellEditor'],
    cellEditorParams: merged.cellEditorParams as ResolvedColDef<TRow>['cellEditorParams'],
    cellStyle: merged.cellStyle,
    autoHeight: merged.autoHeight,
    columnGroupShow: merged.columnGroupShow ?? null,
  };
}
