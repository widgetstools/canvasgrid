// Public types for cgrid. Re-exported from src/cgrid.ts.
// See docs/superpowers/specs/2026-06-23-canvasgrid-foundation-design.md §9.

import type { CellEditorCtor } from './interaction/editors/iCellEditor';

export type { ICellEditor, ICellEditorParams, CellEditorCtor } from './interaction/editors/iCellEditor';

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

  /** Start editing on a single click instead of double-click. Per-column
   *  override via `CColDef.singleClickEdit` (column wins). */
  singleClickEdit?: boolean;
  /** Disable click-to-edit (single AND double click). Editing then only
   *  starts via keyboard (F2 / Enter) or programmatic API. */
  suppressClickEdit?: boolean;
  /** Commit any open editor when the grid host loses focus. `@initial` — the
   *  blur listener is wired at construction time. */
  stopEditingWhenCellsLoseFocus?: boolean;
  /** Excel-style: Enter (without editing) moves the focused cell down by
   *  one row instead of opening the editor. */
  enterNavigatesVertically?: boolean;
  /** When a cell edit commits via Enter, also move the focus down by one
   *  row. Combine with `enterNavigatesVertically` for full Excel parity. */
  enterNavigatesVerticallyAfterEdit?: boolean;
  /** macOS convenience: start editing on Backspace key press. */
  enableCellEditingOnBackspace?: boolean;
  /** Prevent Tab from opening the editor on the next editable cell after
   *  a commit. Tab still moves focus. */
  suppressStartEditOnTab?: boolean;
  /** Excel-style editing. Each open edit carries a `mode` of `'enter'` or
   *  `'edit'`:
   *  - Type-to-edit (printable key) starts in `'enter'` — arrow keys then
   *    commit + move focus to the adjacent cell.
   *  - F2, double-click, single-click (when `singleClickEdit`) and
   *    `api.startEditingCell` start in `'edit'` — arrow keys move the
   *    caret inside the input.
   *  - Mousedown inside the open editor flips `'enter'` → `'edit'`.
   *
   *  When `false` (default) the mode is inert and arrow keys always
   *  behave like the input's native handler. */
  enableExcelEditing?: boolean;
  /**
   * Full-row edit mode. When `'fullRow'`, triggering an edit on any cell in
   * a row opens an editor for every editable column in that row
   * simultaneously. Tab/Shift+Tab cycle between editors within the row;
   * Enter commits all values together; Escape cancels the entire row.
   * Fires `rowEditingStarted` / `rowEditingStopped` / `rowValueChanged`
   * (catalog 22) in addition to the per-cell events. Cycle 5 / Task 10.
   */
  editType?: 'fullRow';

  /**
   * Per-row height in CSS px. Called by the main thread on `setRowData`,
   * `applyTransaction(add|update)`, and any row whose underlying data
   * mutates. Returning `null` / `undefined` falls back to the grid-level
   * `rowHeight`. The resolved height is shipped to the worker
   * (`heightsByRowId` on the matching message) and rides each viewport
   * chunk back as a `Float32Array`. Cycle 5 / Task 6.
   */
  getRowHeight?: (params: GetRowHeightParams<TRow>) => number | null | undefined;
}

/** Params for `CGridOptions.getRowHeight`. The row is identified by its
 *  full data + the application-provided rowId; `rowIndex` is the row's
 *  current position in the visible (filter + sort) order at the time the
 *  callback runs. */
export interface GetRowHeightParams<TRow = any> {
  data: TRow;
  rowId: string;
  rowIndex: number;
}

/** Predicate that decides whether a single cell is editable. Receives the
 *  resolved cell context — matches ag-grid's `EditableCallback` shape. */
export type EditableCallback<TRow = any, TValue = any> = (
  params: { data: TRow; colId: string; rowIndex: number; value: TValue },
) => boolean;

/** Per-column key-event predicate. Return `true` to swallow the event before
 *  any grid handler (navigation, edit-trigger, paging) sees it. Receives
 *  whether an editor is currently open on the cell. */
export type SuppressKeyboardEventCallback<TRow = any> = (
  params: { event: KeyboardEvent; editing: boolean; data: TRow; colId: string },
) => boolean;

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
  /**
   * Static params forwarded to the resolved cell renderer as
   * `CellPaintConfig.params`. Apps choose the shape; the engine treats it
   * as opaque. Inherited from `defaultColDef.cellRendererParams` when not
   * set at column level.
   */
  cellRendererParams?: unknown;
  /**
   * Per-cell renderer selector. Invoked at paint time with the cell's
   * `value` and `colId`; returning `{ component, params? }` overrides
   * the static `cellRenderer` and (if `params` is set) the static
   * `cellRendererParams`. Return `undefined` to fall back to the static
   * pair.
   */
  cellRendererSelector?: CCellRendererSelector<TRow, TValue>;
  comparator?: (a: TValue, b: TValue, ar: TRow, br: TRow) => number;
  filter?: 'text' | 'number';
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  sortable?: boolean;
  resizable?: boolean;
  /** Editable predicate. Pass `true` / `false` for a static answer, or a
   *  callback receiving `{ data, colId, rowIndex, value }`. */
  editable?: boolean | EditableCallback<TRow, TValue>;
  /** Per-column override of `CGridOptions.singleClickEdit`. When set, this
   *  wins over the grid-level value for this column. */
  singleClickEdit?: boolean;
  /** Per-column key-event short-circuit. Runs at the head of the input
   *  chain — return `true` to suppress every grid handler for the
   *  keystroke. */
  suppressKeyboardEvent?: SuppressKeyboardEventCallback<TRow>;
  /**
   * Built-in key (`'text'`, `'number'`, `'date'`, `'dateString'`, `'select'`,
   * `'largeText'`, `'checkbox'`) or a custom constructor registered via
   * `api.registerCellEditor`. When omitted, editable columns default to
   * `'text'`. Per-editor param schemas live in
   * `docs/catalog/06-cell-editing.md` ("Built-in editor types").
   */
  cellEditor?: string | CellEditorCtor<TRow, TValue>;
  /**
   * Static params object — or a callback `(row) => params` — forwarded into
   * `ICellEditorParams.params` at edit-start time. The engine treats this as
   * opaque; the resolved editor interprets the shape.
   */
  cellEditorParams?: Record<string, unknown> | ((row: TRow) => Record<string, unknown>);
  /**
   * Force the editor into popup mode regardless of whether the editor's own
   * `isPopup()` returns true. Matches ag-grid's `cellEditorPopup`. When
   * unset, the editor's own `isPopup()` hook decides — built-in editors are
   * inline-by-default except `'largeText'`, which returns `isPopup(): true`.
   */
  cellEditorPopup?: boolean;
  /**
   * Position of the popup editor relative to the cell. Defaults to `'over'`
   * (popup hides the original cell value). `'under'` floats below so the
   * underlying value stays readable. Honored only when popup mode is active
   * (via `cellEditorPopup` OR `editor.isPopup()`). The editor's own
   * `getPopupPosition()` takes precedence over this col-def value.
   */
  cellEditorPopupPosition?: 'over' | 'under';
  cellStyle?: ColCellOverrides;
  /**
   * When true, the row's height grows to fit this cell's wrapped text. The
   * worker measures every visible row in this column via
   * `OffscreenCanvas.measureText` (with a main-thread fallback on Safari
   * 15.4–16.3 and Firefox 100–104), then aggregates the result into the
   * row's resolved height — `max(getRowHeight, max(autoHeight columns))`.
   * Typically paired with `wrapText: true` (Cycle 5 / Task 9) so the
   * renderer actually paints across multiple lines. Cycle 5 / Task 8.
   */
  autoHeight?: boolean;
  /**
   * When true, the cell renderer paints `valueFormatted` across multiple
   * lines using greedy word-wrap against the cell's inner width. Lines that
   * exceed the row height are truncated with `…` on the last visible line.
   * Pair with `autoHeight: true` so the row grows to fit; without
   * `autoHeight`, wrapped text truncates at the row boundary. Cycle 5 /
   * Task 9.
   */
  wrapText?: boolean;
  /**
   * Convert the editor's emitted value into the typed value to commit. Runs
   * before `valueSetter`. Receives the value already cast by the editor
   * (`Number()` for `type: 'number'`, raw string for text). Return the value
   * to commit. When omitted, the editor's value flows through unchanged.
   */
  valueParser?: (params: CValueParserParams<TRow, TValue>) => TValue;
  /**
   * Apply the committed value to the row. Default behavior is
   * `data[field] = newValue`. Provide this to customise the write — for
   * example, to split a `firstName lastName` string back into two columns,
   * or to keep a denormalised total in sync. The function should mutate
   * `data` in place; the returned value (if any) is ignored.
   */
  valueSetter?: (params: CValueSetterParams<TRow, TValue>) => boolean | void;
  /**
   * When the parent column group is open: visible only if `'open'`.
   * When the parent group is closed: visible only if `'closed'`.
   * `null` / undefined = always visible regardless of group state.
   * Honored once column groups land (Cycle 4 Task 3).
   */
  columnGroupShow?: 'open' | 'closed' | null;
  /**
   * When true, the user cannot drag this column to a new position. The
   * imperative `moveColumnByIndex` API still works — locks alone bind
   * UI-driven reorders. Pair with `lockPosition` to also reject API moves.
   * Cycle 6 / Task 1.
   */
  suppressMovable?: boolean;
  /**
   * Pin this column's index. `true` / `'left'` lock the column to index 0
   * of the flat visible-leaf order; `'right'` locks to the end. The lock
   * binds both drag-reorder and the imperative move API. Cycle 6 / Task 1.
   */
  lockPosition?: boolean | 'left' | 'right';
  /**
   * When true, the column is excluded from the flat visible-leaf order
   * (header + body + layout + hit-test). Hidden columns remain in
   * `columnDefsMap` so `getColumnState()` keeps reporting them — the
   * round-trip is symmetric. Cycle 6 / Task 2.
   */
  hide?: boolean;
  /**
   * Applied only on first construction. `applyColumnState` and the
   * imperative API ignore this field — they read `hide` instead. Cycle 6 /
   * Task 2.
   */
  initialHide?: boolean;
  /**
   * Applied only on first construction. The grid honors this when no
   * matching `pinned` value is provided. Cycle 6 / Task 2.
   */
  initialPinned?: boolean | 'left' | 'right';
  /**
   * Applied only on first construction. The grid honors this when no
   * matching `width` value is provided. Cycle 6 / Task 2.
   */
  initialWidth?: number;
  /**
   * When true, `applyColumnState` + `setColumnsVisible` (Task 5) silently
   * drop any mutation that would flip this column's `hide` state.
   * Cycle 6 / Task 2.
   */
  lockVisible?: boolean;
  /**
   * When true, `applyColumnState` + `setColumnsPinned` (Task 5) silently
   * drop any mutation that would change this column's `pinned` state.
   * Cycle 6 / Task 2.
   */
  lockPinned?: boolean;
}

/**
 * Params passed to a `cellRendererSelector`. Foundation cycle: row `data` is
 * stored in the worker, so the selector receives the materialised `value`
 * and `colId` only. Row data will join this object when main-thread row
 * access lands in a later cycle.
 */
export interface CCellRendererSelectorParams<TValue = unknown> {
  value: TValue;
  colId: string;
}

export interface CCellRendererSelectorResult {
  /** Registered cell-renderer name to dispatch to. */
  component: string;
  /** Dynamic params forwarded to the painter. Override static
   *  `cellRendererParams` when defined; falls back to them when omitted. */
  params?: unknown;
}

export type CCellRendererSelector<TRow = any, TValue = any> = (
  params: CCellRendererSelectorParams<TValue> & { data?: TRow | null },
) => CCellRendererSelectorResult | undefined;

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

/** Params passed to `CColDef.valueParser`. */
export interface CValueParserParams<TRow = any, TValue = any> {
  /** Value emitted by the editor (already cast by `type` when applicable). */
  newValue: unknown;
  /** The row's previous value at `colDef.field`. */
  oldValue: TValue;
  /** The full row object as it currently lives in the worker. */
  data: TRow;
  colDef: CColDef<TRow, TValue>;
}

/** Params passed to `CColDef.valueSetter`. */
export interface CValueSetterParams<TRow = any, TValue = any> {
  /** Mutable row object. Mutate this in place to apply the commit. */
  data: TRow;
  /** The parsed value (output of `valueParser` if provided). */
  newValue: TValue;
  /** The row's previous value at `colDef.field`. */
  oldValue: TValue;
  colDef: CColDef<TRow, TValue>;
}

export interface SortModelEntry { colId: string; direction: 'asc' | 'desc' }
export type SortModel = SortModelEntry[];

/**
 * Serialisable per-leaf column state. Returned in current-visible-leaf
 * order from `getColumnState`, including hidden leaves so the round-trip
 * is symmetric. `undefined` on any optional slot is treated as
 * "don't change" by `applyColumnState`. Cycle 6 / Task 2.
 */
export interface CColumnState {
  colId: string;
  /** Resolved column width in pixels. `undefined` when the leaf is flex-only. */
  width?: number;
  /** Flex weight. `null` clears any flex; `undefined` leaves it untouched. */
  flex?: number | null;
  /** `true` / `false` (explicit). `undefined` round-trips as "don't change". */
  hide?: boolean;
  /** `'left'` / `'right'` / `null` (unpinned). `undefined` = "don't change". */
  pinned?: 'left' | 'right' | null;
  /** `'asc'` / `'desc'` / `null` (unsorted). `undefined` = "don't change". */
  sort?: 'asc' | 'desc' | null;
  /** Position in a multi-column sort. `null` = unsorted. */
  sortIndex?: number | null;
  /** Reserved for Cycle 14. Round-trips opaquely until then. */
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  /** Reserved for Cycle 17. Round-trips opaquely until then. */
  pivot?: boolean;
  pivotIndex?: number | null;
  /** Reserved for Cycle 13. Round-trips opaquely until then. */
  aggFunc?: string | null;
}

/**
 * Parameters for `CGridApi.applyColumnState`. Cycle 6 / Task 2.
 *
 * - `state` — per-leaf restore entries; matched by `colId`. Leaves not
 *   mentioned fall back to `defaultState` (if provided) or stay unchanged.
 * - `applyOrder` — when true, the column order from `state` defines the
 *   new flat-leaf order (Task 1's locks + `marryChildren` still bind).
 * - `defaultState` — applied to every leaf not mentioned in `state`. Pair
 *   with a sparse `state` to "reset everything else + restore these few"
 *   in a single call.
 */
export interface CApplyColumnStateParams {
  state?: CColumnState[];
  applyOrder?: boolean;
  defaultState?: Omit<CColumnState, 'colId'>;
}

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

/** Fires before the editor's DOM mounts. Cycle 5 wiring uses `rowIndex` as
 *  the primary positional identity; `rowId` is best-effort (synthetic
 *  `row-${idx}` until the worker→main rowId map lands). */
export interface CellEditingStartedEvent<TRow = unknown> {
  type: 'cellEditingStarted';
  rowIndex: number;
  rowId: string;
  colId: string;
  value: unknown;
  data: TRow;
}
/** Fires unconditionally when an editor closes (commit OR cancel).
 *  `valueChanged` is `true` only when the commit produced a real value
 *  change AND it was not cancelled. */
export interface CellEditingStoppedEvent<TRow = unknown> {
  type: 'cellEditingStopped';
  rowIndex: number;
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
  valueChanged: boolean;
  data: TRow;
}

/** Fires after every editor in the row's editable cells has mounted in
 *  full-row edit mode (`editType: 'fullRow'`). Single-cell edits do not
 *  fire this. Cycle 5 / Task 10. */
export interface RowEditingStartedEvent<TRow = unknown> {
  type: 'rowEditingStarted';
  rowIndex: number;
  rowId: string;
  data: TRow;
}

/** Fires unconditionally when full-row editing ends (commit OR cancel).
 *  Pair with `rowValueChanged` to know whether anything actually
 *  committed — `rowEditingStopped` always fires, `rowValueChanged` fires
 *  only when ≥ 1 cell changed. Cycle 5 / Task 10. */
export interface RowEditingStoppedEvent<TRow = unknown> {
  type: 'rowEditingStopped';
  rowIndex: number;
  rowId: string;
  data: TRow;
}

/** Fires once after a full-row commit that produced at least one changed
 *  cell. Per-cell `cellValueChanged` events still fire alongside; this is
 *  a single row-level signal apps can use to drive whole-row workflows
 *  (server-side write-back, validation banners). Cycle 5 / Task 10. */
export interface RowValueChangedEvent<TRow = unknown> {
  type: 'rowValueChanged';
  rowIndex: number;
  rowId: string;
  data: TRow;
}

export type CGridEvent =
  | { type: 'gridReady'; api: CGridApi }
  | { type: 'cellClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellDoubleClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellFocused'; rowId: string; colId: string }
  | {
      type: 'cellValueChanged';
      rowId: string;
      colId: string;
      oldValue: unknown;
      newValue: unknown;
      /** Raw value returned by the editor before `valueParser` ran. Same as
       *  `newValue` when no parser was configured. */
      newRawValue?: unknown;
      /** Origin of the change. `'edit'` for manual cell edits. Reserved
       *  values: `'paste'` / `'fill'` / `'api'` (later cycles). */
      source?: 'edit';
      /** Row index in the current visible order. */
      rowIndex?: number;
      /** Mutated row object as it lives in the worker after the commit. */
      data?: unknown;
    }
  | CellEditingStartedEvent
  | CellEditingStoppedEvent
  | RowEditingStartedEvent
  | RowEditingStoppedEvent
  | RowValueChangedEvent
  | { type: 'selectionChanged'; selectedRowIds: string[] }
  | { type: 'viewportChanged'; firstRow: number; lastRow: number }
  | { type: 'modelUpdated'; visibleRowCount: number }
  | { type: 'sortChanged'; sortModel: SortModel }
  | { type: 'filterChanged'; filterModel: FilterModel }
  | { type: 'columnResized'; colId: string; width: number; source?: 'columnState' | 'ui' | 'api' }
  /** Fires when one or more columns have changed visibility. `source`
   *  distinguishes a column-state restore (`'columnState'`) from a future
   *  Task-5 imperative call (`'api'`). Cycle 6 / Task 2 — emitted by
   *  `applyColumnState` / `resetColumnState`. */
  | {
      type: 'columnVisible';
      visible: boolean;
      colIds: string[];
      source: 'columnState' | 'api';
    }
  /** Fires when one or more columns have changed pinning. `pinned: null`
   *  for unpinned columns. Cycle 6 / Task 2 — emitted by
   *  `applyColumnState` / `resetColumnState`. */
  | {
      type: 'columnPinned';
      pinned: 'left' | 'right' | null;
      colIds: string[];
      source: 'columnState' | 'api';
    }
  /** Fires once after `resetColumnState` restores the construction-time
   *  snapshot, BEFORE the per-slot change events fan out (`columnMoved`
   *  / `columnVisible` / `columnPinned` / `columnResized` / `sortChanged`).
   *  Cycle 6 / Task 2. */
  | { type: 'columnsReset' }
  /** Fires after a column changes its index in the flat visible-leaf order.
   *  `toIndex` is the resolved final index AFTER `lockPosition` /
   *  `marryChildren` clamping; it may differ from the drag's drop target
   *  or the imperative API's requested index. `source` distinguishes
   *  drag (`'uiColumnDragged'`) from API (`'api'`) and (Cycle 6 / Task 2)
   *  column-state apply (`'columnState'`). The `colIds` array shape is
   *  shared with the multi-column move API landing in Cycle 6 / Task 5. */
  | {
      type: 'columnMoved';
      toIndex: number;
      colIds: string[];
      source: 'uiColumnDragged' | 'api' | 'columnState';
    }
  | { type: 'asyncTransactionsFlushed'; results: TransactionResult[] }
  | { type: 'aggregationChanged'; totals: Record<string, number | null> }
  | { type: 'columnGroupOpened'; groupId: string; open: boolean }
  | { type: 'displayedColumnsChanged'; source: 'columnGroupOpened' | 'columnDefsChanged' }
  /** Fires synchronously inside `destroy()` BEFORE any DOM removal so apps
   *  can stash a state snapshot. `state` is `{}` until Cycle 22 wires the
   *  full state-snapshot API; the event surface is shipped now so apps can
   *  start wiring listeners against a stable shape. */
  | { type: 'gridPreDestroyed'; state: Record<string, unknown> }
  /** Fires when the host (canvas-drawable) bounds actually change. Skips
   *  the initial measurement and any repaint that doesn't change the size,
   *  so it's safe to listen for as a real layout trigger. */
  | { type: 'gridSizeChanged'; width: number; height: number }
  /** Fires exactly once per grid instance — the first non-empty viewport
   *  chunk has been received and a repaint scheduled. Use for analytics
   *  ("data was rendered"), autosize-on-mount, or to flip a loading flag. */
  | { type: 'firstDataRendered' };

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

  /** Register a custom cell renderer under `name`. Columns referencing the
   *  name via `cellRenderer` (or a `cellRendererSelector` return value)
   *  will dispatch to `painter` at paint time. Built-in names ('text',
   *  'number', 'checkbox', 'header') can be overridden by re-registering. */
  registerCellRenderer(name: string, painter: import('./renderer/cellRenderers/registry').CellPainter): void;

  /** Register a custom cell editor under `name`. Columns referencing it via
   *  `cellEditor: name` will mount this editor when edit starts. Built-in
   *  names ('text' shipped in Cycle 5 Task 1; 'number' / 'date' / 'select' /
   *  'largeText' / 'checkbox' / 'dateString' in Task 2) can be overridden. */
  registerCellEditor(name: string, ctor: CellEditorCtor): void;

  /** Programmatically start editing the cell at `(rowIndex, colId)`.
   *  No-op when the cell is not editable or not in the current viewport. */
  startEditingCell(rowIndex: number, colId: string): void;
  /** Close any active editor. `cancel=true` discards the new value; default
   *  commits it through `valueParser → valueSetter` like Enter / Tab. */
  stopEditing(cancel?: boolean): void;

  /** Subscribe to a typed event. Returns an unsubscribe function. */
  on<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
  /** Remove a previously-registered listener. */
  off<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): void;
  /** Alias for `on()`, present for ag-grid API parity. */
  addEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): () => void;
  /** Alias for `off()`, present for ag-grid API parity. */
  removeEventListener<K extends CGridEvent['type']>(
    type: K,
    handler: (event: Extract<CGridEvent, { type: K }>) => void,
  ): void;

  /** Move the leaf at `fromIndex` to `toIndex` in the flat visible-leaf
   *  order. No-op when `fromIndex === toIndex` or either index is out of
   *  range. Honors `lockPosition` + `marryChildren` — illegal moves clamp
   *  to the nearest legal index, NOT throw. Fires `columnMoved` with
   *  `source: 'api'`. Cycle 6 / Task 1. */
  moveColumnByIndex(fromIndex: number, toIndex: number): void;

  /** Serialisable snapshot of every leaf's mutable state (width, hide,
   *  pinned, sort, sortIndex, flex, plus reserved rowGroup / pivot /
   *  aggFunc slots) in the current flat-leaf order — hidden leaves
   *  included. Pair with `applyColumnState` for layout persistence.
   *  Cycle 6 / Task 2. */
  getColumnState(): CColumnState[];
  /** Restore column state. Returns `true` when every `state[].colId`
   *  matched a known leaf; `false` when at least one entry was dropped.
   *  Mutates `columnDefsMap` in place through a single re-layout +
   *  repaint cycle. Honors `lockVisible` / `lockPinned` — locked
   *  mutations are silently dropped. Fires `columnMoved` /
   *  `columnVisible` / `columnPinned` / `columnResized` / `sortChanged`
   *  with `source: 'columnState'` for each changed slot. Cycle 6 /
   *  Task 2. */
  applyColumnState(params: CApplyColumnStateParams): boolean;
  /** Restore the construction-time column-state snapshot. Fires
   *  `columnsReset`, then the per-slot change events with
   *  `source: 'columnState'`. Cycle 6 / Task 2. */
  resetColumnState(): void;

  /** Returns the on-screen pixel bounds of the cell at (`rowIndex`, `colId`)
   *  in the canvas's coordinate space. Returns `null` when the cell is not
   *  in the current viewport. Used by E2E to position synthetic clicks. */
  getCellBoundsAt(rowIndex: number, colId: string): { x: number; y: number; w: number; h: number } | null;
  /** Returns the on-screen pixel bounds of the leaf header at `colId`,
   *  or `null` when the column is not currently in the viewport. The
   *  rectangle spans the column's full leaf-header band — y is the leaf
   *  header's top, h is the leaf header's height. Used by Cycle 6 E2Es
   *  to position synthetic drag gestures. */
  getHeaderBoundsAt(colId: string): { x: number; y: number; w: number; h: number } | null;
  /** Returns the vertical pixel bounds (top + height) of the data row at
   *  `rowIndex`. `null` when the row isn't currently visible. Useful for
   *  asserting variable-height row layouts in E2E without a per-column
   *  lookup. Cycle 5 / Task 6. */
  getRowBoundsAt(rowIndex: number): { y: number; h: number } | null;
  /** Returns the raw value of the cell at (`rowIndex`, `colId`) from the
   *  current viewport chunk, or `null` when the cell is not in the chunk. */
  getCellValue(rowIndex: number, colId: string): unknown;
}
