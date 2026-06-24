// Public types for cgrid. Re-exported from src/cgrid.ts.
// See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md §9.

export interface ColCellOverrides {
  font?: string;
  fg?: string;
  bg?: string;
  halign?: 'left' | 'right' | 'center';
}

export interface CGridOptions<TRow = any> {
  columnDefs: (CColDef<TRow> | CColGroupDef<TRow>)[];
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

  /** Hint to skip CSS-animated row transitions. Runtime-mutable; storage-only
   *  in Cycle 4 (no read site yet; downstream cycles consume). */
  animateRows?: boolean;
  /** Render every center column regardless of horizontal scroll position.
   *  Useful for screenshot tests and CSV-style exports where the painter
   *  needs every column visible at once. Pinned columns are unaffected. */
  suppressColumnVirtualisation?: boolean;
  /** Render every data row regardless of vertical scroll position. Trades
   *  scroll-FPS for guaranteed full-grid materialisation. */
  suppressRowVirtualisation?: boolean;
  /** Number of extra rows to materialise above and below the visible window.
   *  Defaults to the engine's internal overscan (3) when unset. */
  rowBuffer?: number;
  /** Opaque application data forwarded to callbacks (matches ag-grid).
   *  Storage-only in Cycle 4. */
  context?: unknown;
  /** Explicit loading-overlay toggle. Storage-only in Cycle 4; the overlay
   *  surface lands in a later cycle. */
  loading?: boolean;
  /** Enables verbose console logging from the engine. Storage-only. */
  debug?: boolean;
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
  cellStyle?: ColCellOverrides;
  /**
   * When the parent column group is open: visible only if `'open'`.
   * When the parent group is closed: visible only if `'closed'`.
   * `null` / undefined = always visible regardless of group state.
   * Honored once column groups land (Cycle 4 Task 3).
   */
  columnGroupShow?: 'open' | 'closed' | null;
}

/**
 * Column group definition. `columnDefs` accepts a mix of `CColDef` (leaf
 * columns) and `CColGroupDef` (groups). Groups nest arbitrarily; the grid
 * builds a tree at construction time and flattens to a leaf-ordered render
 * list. `groupId` is auto-generated when omitted.
 */
export interface CColGroupDef<TRow = any> {
  /** Stable identifier. Auto-generated as `cg-grp-${n}` when omitted. */
  groupId?: string;
  /** Text shown in the group header cell. Empty string OK. */
  headerName?: string;
  /** Child columns or nested groups. Required; must be non-empty. */
  children: (CColDef<TRow> | CColGroupDef<TRow>)[];
  /** Group is expanded on first render. Default false (closed). */
  openByDefault?: boolean;
  /** Prevents user from dragging child columns outside this group. */
  marryChildren?: boolean;
  /** CSS class hint applied to the group header cell. */
  headerClass?: string;
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
  | { type: 'aggregationChanged'; totals: Record<string, number | null> }
  | { type: 'columnGroupOpened'; groupId: string; open: boolean }
  | { type: 'displayedColumnsChanged'; source: 'columnGroupOpened' | 'columnDefsChanged' };

export interface CGridApi {
  setRowData(rows: any[]): void;
  applyTransaction(t: Tx): TransactionResult;
  applyTransactionAsync(t: Tx): void;
  flushAsyncTransactions(): void;

  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  setGroupModel(g: GroupModel): void;

  /** Scroll the row with the given ID into view. Resolves once the worker
   *  has resolved the rowId → current index (filter + sort applied). Resolves
   *  immediately when the row is not in the visible model. */
  ensureRowVisible(rowId: string, position?: 'auto' | 'top' | 'middle' | 'bottom'): Promise<void>;
  /** Scroll the column with the given ID into view. No-op for pinned columns
   *  (always visible) or unknown IDs. `'auto'` scrolls just enough; the named
   *  positions force start/middle/end alignment. */
  ensureColumnVisible(colId: string, position?: 'auto' | 'start' | 'middle' | 'end'): void;
  /** Open every ancestor group + the target group, then scroll its first
   *  visible leaf into view. No-op for unknown groupIds. */
  ensureColumnGroupVisible(groupId: string, position?: 'auto' | 'start' | 'middle' | 'end'): void;
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;

  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;

  refresh(): void;
  setTheme(themeClass: string): void;
  destroy(): void;

  getColumnGroupState(): { groupId: string; open: boolean }[];
  setColumnGroupState(state: { groupId: string; open: boolean }[]): void;
  resetColumnGroupState(): void;

  /** Read the current value of any grid option. */
  getGridOption<K extends keyof CGridOptions>(key: K): CGridOptions[K] | undefined;
  /** Update a single runtime-mutable option. Throws on initial-only keys
   *  (see `INITIAL_ONLY_OPTIONS` in `core/runtimeOptions.ts`). */
  setGridOption<K extends keyof CGridOptions>(key: K, value: CGridOptions[K]): void;
  /** Batch-update multiple runtime-mutable options. The `columnDefs` key is
   *  honored only via this batched entrypoint (not via `setGridOption`)
   *  because it rebuilds the column tree + worker column metadata. */
  updateGridOptions(partial: Partial<CGridOptions>): void;
}
