// Public types for cgrid. Re-exported from src/cgrid.ts.
// See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md §9.

export interface CGridOptions<TRow = any> {
  columnDefs: CColDef<TRow>[];
  defaultColDef?: Partial<CColDef<TRow>>;
  rowData?: TRow[];
  getRowId: (row: TRow) => string;
  rowHeight?: number;
  headerHeight?: number;
  rowSelection?: 'none' | 'single' | 'multiple';
  enableCellChangeFlash?: boolean;
  cellFlashDuration?: number;
  cellFadeDuration?: number;
  asyncTransactionWaitMillis?: number;
  theme?: string;
  worker?: { url?: string };
}

export interface CColDef<TRow = any, TValue = any> {
  colId?: string;
  field?: keyof TRow & string;
  headerName?: string;
  width?: number;
  flex?: number;
  minWidth?: number;
  maxWidth?: number;
  pinned?: 'left' | 'right';
  type?: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => TValue;
  valueFormatter?: (params: CValueFormatterParams<TRow, TValue>) => string;
  cellRenderer?: string;
  comparator?: (a: TValue, b: TValue, ar: TRow, br: TRow) => number;
  filter?: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable?: boolean;
  resizable?: boolean;
  editable?: boolean | ((row: TRow) => boolean);
  cellEditor?: 'text' | 'number';
}

export interface CValueGetterParams<TRow> { data: TRow; colId: string }
export interface CValueFormatterParams<TRow, TValue> {
  data: TRow; value: TValue; colId: string;
}

export interface SortModelEntry { colId: string; direction: 'asc' | 'desc' }
export type SortModel = SortModelEntry[];

export type FilterModelEntry =
  | { type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { type: 'number'; op: 'eq' | 'gt' | 'lt' | 'between'; value: number; value2?: number };
export type FilterModel = Record<string, FilterModelEntry>;

export interface GroupModel { rowGroupCols: string[] }

export interface Tx<TRow = any> {
  add?: TRow[];
  update?: TRow[];
  remove?: TRow[];
}
export interface TransactionResult {
  add: { rowId: string }[];
  update: { rowId: string }[];
  remove: { rowId: string }[];
}

export type CGridEvent =
  | { type: 'gridReady'; api: CGridApi }
  | { type: 'cellClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellDoubleClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellFocused'; rowId: string; colId: string }
  | { type: 'cellValueChanged'; rowId: string; colId: string; oldValue: unknown; newValue: unknown }
  | { type: 'selectionChanged'; selectedRowIds: string[] }
  | { type: 'viewportChanged'; firstRow: number; lastRow: number }
  | { type: 'modelUpdated'; visibleRowCount: number }
  | { type: 'sortChanged'; sortModel: SortModel }
  | { type: 'filterChanged'; filterModel: FilterModel }
  | { type: 'columnResized'; colId: string; width: number }
  | { type: 'asyncTransactionsFlushed'; results: TransactionResult[] }
  | { type: 'aggregationChanged'; totals: Record<string, number | null> };

export interface CGridApi {
  setRowData(rows: any[]): void;
  applyTransaction(t: Tx): TransactionResult;
  applyTransactionAsync(t: Tx): void;
  flushAsyncTransactions(): void;

  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  setGroupModel(g: GroupModel): void;

  ensureRowVisible(rowId: string, position?: 'top' | 'middle' | 'bottom'): void;
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;

  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;

  refresh(): void;
  setTheme(themeClass: string): void;
  destroy(): void;
}
