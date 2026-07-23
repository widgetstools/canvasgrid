// Column model — colDef, group def, value get/format/parse/set params,
// sort model, selection range, column state, editor callbacks, sizing
// params. Depends on cell.ts (class + style + override types), filter.ts
// (filter params), and the external iCellEditor module.

import type { CellEditorCtor } from '../interaction/editors/iCellEditor';
import type { Fragment, IconRef } from '@cgrid/format';
import type {
  CellClass,
  CellClassRules,
  CellStyleFunc,
  ColCellOverrides,
  HeaderClass,
  HeaderStyleFunc,
} from './cell';
import type {
  CFilterParams,
  CSetFilterParams,
  CTextFilterParams,
} from './filter';

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

/** Cycle 4 / Task 11 (cell-flash patch) — params for
 *  `CGridApi.flashCells`. Programmatic cell flash for app-driven
 *  highlights (validation success pulse, row-just-loaded). */
export interface FlashCellsParams {
  /** Row IDs to flash. Required; must be non-empty. */
  rowIds: string[];
  /** Column IDs to flash within each row. When omitted or empty,
   *  every column with a resolved field flashes. */
  colIds?: string[];
  /** Cycle 21e / Task 13 — per-call override of the global
   *  `cellFlashDuration` for this batch (the Cycle 4 reserve, now live). */
  flashDuration?: number;
  /** Cycle 21e / Task 13 — per-call override of `cellFadeDuration`. */
  fadeDuration?: number;
  /** Cycle 21e / Task 13 — per-call flash color; replaces the theme's
   *  `flashFromColor` blend for these cells only. */
  color?: string;
  /** Cycle 21e / Task 13 — alpha curve. `'fade'` (default) is the
   *  existing hold-then-linear-fade; `'pulse'` is a double sine²
   *  cycle over the full window; `'glow'` plateaus at full alpha for
   *  60% of the window then fades linearly. */
  mode?: 'fade' | 'pulse' | 'glow';
}

/** Per-column key-event predicate. Return `true` to swallow the event before
 *  any grid handler (navigation, edit-trigger, paging) sees it. Receives
 *  whether an editor is currently open on the cell. */
export type SuppressKeyboardEventCallback<TRow = any> = (
  params: { event: KeyboardEvent; editing: boolean; data: TRow; colId: string },
) => boolean;

/** Cycle 9 / Task 5 — params for `CGridOptions.fillOperation`. Mirrors
 *  ag-grid's `FillOperationParams`. (Lives in column.ts rather than its
 *  own module because both `CColDef` and `CGridOptions` carry it.) */
export interface FillOperationParams<TRow = any> {
  /** The values from the source rect (the original selection before the
   *  fill-handle drag), in source-row order, for the column being filled. */
  values: unknown[];
  /** The same as `values` — kept separate so a custom op that mutates the
   *  accumulator over multiple target cells doesn't trample the initial
   *  source list. */
  initialValues: unknown[];
  /** Index of the target cell within the target rect (0-based, in target-
   *  row order). For a vertical fill that extends 3 rows below the source
   *  this runs 0..2 for each column. */
  currentIndex: number;
  /** Best-effort partial of the target row. Synchronous read from the main-
   *  thread chunk — may not include every field when the row is outside the
   *  visible window. */
  rowNode: { data: Partial<TRow>; rowIndex: number };
  /** Resolved column definition for the cell being filled. */
  colDef: { colId: string; field?: string };
  /** Axis the fill extends along, decided by the drag's dominant delta. */
  direction: 'up' | 'down' | 'left' | 'right';
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
  /**
   * Named column type(s) declared in `CGridOptions.columnTypes`. Each named
   * entry is a `Partial<CColDef>` bundle; the resolved column merges the
   * bundles left-to-right, then `defaultColDef`, then this column's own
   * fields — the column's own properties always win.
   *
   * Deprecation alias: when `type` is `'text'` or `'number'` AND
   * `columnTypes` carries no entry of that name, the value collapses into
   * `cellDataType`. New code should prefer `cellDataType` for the cell
   * data type and reserve `type` for shared property bundles.
   *
   * Cycle 6 / Task 6.
   */
  type?: string | string[];
  /**
   * Cell data type. Drives the default cell renderer + default halign when
   * `cellRenderer` is unset (`'text'` → left-align text; `'number'` →
   * right-align numeric). Replaces the old `type: 'text' | 'number'`
   * literal-union usage — that shape still works via a deprecation alias
   * (see `type`). Cycle 6 / Task 6.
   */
  cellDataType?: 'text' | 'number';
  valueGetter?: (params: CValueGetterParams<TRow>) => TValue;
  /** DSL string OR function. String form compiles via @cgrid/format
   *  at ColDef-resolve time. */
  valueFormatter?: string | ((params: CValueFormatterParams<TRow, TValue>) => string);

  /** Icon slot; a static name/IconRef, or a fn (populated by format at
   *  ColDef-resolve when {icon:name} is present in the format string).
   *  Static forms render unconditionally on every data cell. */
  cellIcon?: string | IconRef | ((params: CValueFormatterParams<TRow, TValue>) => IconRef | null);

  /** Cycle 28 — leaf-header prefix/suffix icon. Claims a leading/trailing
   *  slot in the header cell; the caption shifts away. Trailing icons do
   *  NOT move the sort chevron (collisions are the author's concern).
   *  Static IconRef or per-column fn. Leaf headers only. */
  headerIcon?: IconRef | ((params: { colId: string }) => IconRef | null);

  /** Composite discriminant — presence of `type: 'composite'` switches
   *  the ColDef into composite mode. See also `type?: string | string[]`
   *  for the named-bundle usage; `'composite'` is a reserved keyword and
   *  is NOT looked up in `columnTypes`. */

  /** Composite fragments — required when `type === 'composite'`. */
  fragments?: Fragment[];

  /** Composite cell background — Tier 1 format string (bg=/if= brackets only). */
  cellBackground?: string;

  /** Composite alignment. */
  align?: 'left' | 'center' | 'right';

  /** Composite overflow behavior. */
  overflow?: 'ellipsis' | 'clip';

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
  /** Custom comparator. Either the NAME of a comparator registered with
   *  the grid via `api.registerComparator(name, fn)` — preferred, because
   *  the sort runs worker-side and registered comparators string-serialise
   *  across the `postMessage` boundary — OR an inline closure. Inline
   *  closures cannot cross the worker boundary and throw at
   *  `setSortModel` time with a message that points at
   *  `registerComparator`. Cycle 8 / Task 3. */
  comparator?: string | ((a: TValue, b: TValue, ar: TRow, br: TRow) => number);
  /** Filter type for the column. `'text'` / `'number'` / `'date'` route
   *  the floating-filter input through the matching parser grammar.
   *  `'set'` is reserved for Task 9's checkbox popup. When unset, the
   *  overlay falls back to `cellDataType`.
   *
   *  `'agGroupColumnFilter'` (AG parity 2026-07-21) is meaningful ONLY on
   *  `autoGroupColumnDef`: the auto-group column inherits the UNDERLYING
   *  grouped column's filter (field + concrete type resolved at
   *  synthesis; per-depth in `'multipleColumns'` mode). On any other
   *  column it resolves to no filter. */
  filter?: 'text' | 'number' | 'date' | 'set' | 'agGroupColumnFilter';
  /** Per-column filter UI parameters. Tasks 3-6 + 9 each consume the
   *  relevant subset (`buttons` / `closeOnApply` are honored by every
   *  popup; type-specific knobs like `caseSensitive` arrive with Task
   *  5's text-filter popup). Widened to accept `CTextFilterParams` so
   *  text-filtered columns can pass `caseSensitive` / `trimInput` /
   *  `textFormatter` / `showCaseSensitiveToggle` without a cast. Cycle
   *  7 / Task 3 (+ Task 8 type widening). */
  filterParams?: CFilterParams | CTextFilterParams | CSetFilterParams;
  /** Per-column override of `CGridOptions.floatingFilter`. When set on a
   *  column, the column joins (or opts out of) the floating-filter row
   *  regardless of the grid-wide default. Cycle 7 / Task 1. */
  floatingFilter?: boolean;
  /** Hide the expand button that opens the full filter popup on the
   *  floating-filter input. Only meaningful when `floatingFilter: true`
   *  for this column. Task 1 reserves the field; popups land in Tasks
   *  3-6 + 9. Cycle 7 / Task 1. */
  suppressFloatingFilterButton?: boolean;
  /** Contributes a custom string to the row's quick-filter aggregate for
   *  this column. The return value replaces the default `String(value)`
   *  contribution. Useful when the cell value is an object / array whose
   *  default coercion (`[object Object]`) carries no signal. Cycle 7 ships
   *  the API surface; the callback runs on the main thread once per
   *  `quickFilterText` change and the resulting per-row aggregate ships
   *  to the worker as part of the column metadata. Arbitrary closures
   *  wait for Cycle 24's worker-module loader — Cycle 7 serializes the
   *  function via `Function.prototype.toString` and reconstructs on the
   *  worker via `new Function(...)`; CSP-restricted hosts that disallow
   *  `new Function` fall back to `String(value)` with a `console.warn`. Cycle 7 / Task 7. */
  getQuickFilterText?: (params: { value: TValue; data: TRow; colId: string }) => string;
  /** Cycle 14 / Task 3 — name of the column's totals aggregation.
   *  Built-in names: `'sum' | 'avg' | 'min' | 'max' | 'count' | 'first'
   *  | 'last'`. Custom names resolve against the registry passed via
   *  `CGridOptions.aggFuncs` (or registered at runtime via
   *  `api.setGridOption('aggFuncs', …)`). Unknown names produce an
   *  `undefined` total for the column — the totals row paints the
   *  cell empty. An array form (`['sum', 'avg']`) uses the FIRST entry
   *  that resolves; subsequent entries serve as fallbacks. */
  aggFunc?: string | string[];
  /** Cycle 14 / Task 4 — per-column override of
   *  `CGridOptions.suppressAggFuncInHeader`. When set, this column's
   *  header decoration follows the column-level flag regardless of the
   *  grid-level value. Unset (`undefined`) defers to the grid-level
   *  option (default `false` → show `sum(Notional)`). Has no visible
   *  effect when the column declares no `aggFunc`. */
  suppressAggFuncInHeader?: boolean;
  /** Cycle 14 / Task 5 — override the cell renderer used for this
   *  column's cell on the totals row. Defaults to the built-in
   *  `'totals'` renderer (subtle muted em-dash for empty, value
   *  formatted via the column's `valueFormatter`). Set to any
   *  registered renderer name (e.g. `'text'`, `'number'`, or a custom
   *  renderer registered via `api.registerCellRenderer`) to opt the
   *  column out of the polished totals treatment for this single
   *  column. Has no effect when the grid has no totals row mounted
   *  (`CGridOptions.totalsRowPosition` is `null` / unset). */
  totalsCellRenderer?: string;
  sortable?: boolean;
  /** Diacritic-aware string sort. When `true`, `SortPass` orders this
   *  column's values via `Intl.Collator(undefined, { sensitivity:
   *  'variant' })` so accented characters slot between their unaccented
   *  neighbours (e.g. `Élise` lands between `Ele` and `Em` instead of
   *  after the entire ASCII alphabet). Honored only when `cellDataType`
   *  resolves to `'text'`; ignored for numeric columns or when a
   *  registered `comparator` runs instead. Cycle 8 / Task 5. */
  accentedSort?: boolean;
  /** When `true`, the header cell paints a faint up/down chevron pair
   *  (`chevrons-up-down`) any time this column is sortable but not
   *  currently in the sort model — a hint to the user that the column
   *  can be clicked to sort. Has no effect when `sortable === false`.
   *  The icon color resolves from the theme's `--cg-unsort-icon-color`
   *  custom property and falls back to a 40% alpha headerFg. Cycle 8 /
   *  Task 5. */
  unSortIcon?: boolean;
  /** Cycle 15 / Task 11 — when this column is one of the
   *  `rowGroupCols` AND the active `SortModel` targets the column,
   *  force the group-level sort to compare composite group keys
   *  (cheap, string-lexicographic) instead of running the column's
   *  registered `comparator` / accented collator over the raw group
   *  `.value`. Useful when the value-aware comparator is expensive
   *  (date parse, locale-aware fold) and the cheap key string
   *  produces the same order.
   *
   *  When `false` / unset, the group-level sort uses the column's
   *  registered `comparator` (or accented collator for text columns
   *  opted into `accentedSort`) over the raw `.value`. Falls back to
   *  the composite-key compare when neither is configured.
   *
   *  No effect on within-bucket (leaf-row) sorting — that always
   *  honours the row's data and the column's registered comparator. */
  sortGroupRowsByKey?: boolean;
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
   * Render a row-select checkbox in this column's body cells. When
   * true, the column's cellRenderer is forced to
   * `'rowSelectCheckbox'` regardless of the resolved `cellDataType`,
   * and clicks on the cell toggle the row's membership in
   * `selectedRowIndices` (no focus move, no cell-range mutation —
   * pure row-selection gesture). Pair with `pinned: 'left'` for the
   * conventional blotter checkbox column.
   */
  checkboxSelection?: boolean;
  /**
   * Render a tri-state select-all checkbox in this column's header.
   * Click toggles between "select every row" and "clear selection";
   * the box reports `indeterminate` when some-but-not-all rows are
   * selected. Independent of `checkboxSelection` — apps can have the
   * header checkbox without the per-row body checkbox if they want
   * select-all + click-only row selection.
   */
  headerCheckboxSelection?: boolean;
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
  /**
   * Static class name(s) or a callback returning class name(s). Each class
   * name is looked up in the theme's `cellClassVariants` map and the matching
   * `ColCellOverrides` patch is applied to the cell. Applied before
   * `cellClassRules`. Cycle 6 / Task 7.
   */
  cellClass?: CellClass<TRow, TValue>;
  /**
   * Map of class-name → predicate. The predicate is called per cell at paint
   * time; when it returns `true`, the matching `ColCellOverrides` patch from
   * the theme is applied. Rules are evaluated after `cellClass`.
   * Cycle 6 / Task 7.
   */
  cellClassRules?: CellClassRules<TRow, TValue>;
  /**
   * Static object or function-form per-cell style override. The object form
   * (static `ColCellOverrides`) is merged on top of class-driven variants.
   * The function form (`CellStyleFunc`) is called per cell and its return value
   * is applied last (highest precedence). Cycle 6 / Task 7.
   */
  cellStyle?: ColCellOverrides | CellStyleFunc<TRow, TValue>;
  /**
   * Cycle 27 / Task 1 — direct style override for this column's HEADER cell.
   * Static object or function form (called per header paint). Applied AFTER
   * `headerClass` variants — same precedence rules as `cellStyle` vs
   * `cellClass`. Doesn't leak into data cells.
   */
  headerStyle?: ColCellOverrides | HeaderStyleFunc;
  /**
   * Class name(s) applied to the header cell. Resolves through the theme's
   * `headerClassVariants` map. Cycle 6 / Task 7.
   */
  headerClass?: HeaderClass;
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
   * Cycle 21i / Phase 1 — wrap the HEADER text to the column width instead
   * of clipping it. Multi-line headers draw within the header row; pair
   * with `autoHeaderHeight: true` (or a taller `headerHeight`) so every
   * line is visible. Honored via `defaultColDef` for all columns.
   */
  wrapHeaderText?: boolean;
  /**
   * Cycle 21i / Phase 1 — grow the leaf header row to fit this column's
   * wrapped header text. The header row height becomes the tallest wrapped
   * header among visible columns that set this (floored at the configured
   * `headerHeight` / theme default). Only meaningful with
   * `wrapHeaderText: true`.
   */
  autoHeaderHeight?: boolean;
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
  /** Construction-time seed for the sort direction on this column.
   *  Honored exactly once; subsequent `applyColumnState` reads `sort`
   *  instead. When omitted, the column is unsorted on first paint.
   *  Cycle 8 / Task 2. */
  initialSort?: 'asc' | 'desc';
  /** Construction-time seed for the column's position in a multi-column
   *  sort. Columns without an index sort to the tail in their
   *  declaration order. Honored exactly once alongside `initialSort`.
   *  Cycle 8 / Task 2. */
  initialSortIndex?: number;
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
  /**
   * When true, `sizeColumnsToFit` skips this column — its width is held
   * at the current value while the remaining columns absorb the container
   * width. Cycle 6 / Task 3.
   */
  suppressSizeToFit?: boolean;
  /**
   * When true, `autoSizeColumns` / `autoSizeAllColumns` skip this column.
   * Pair with a fixed `width` to opt a column out of any auto-fit pass.
   * Cycle 6 / Task 4.
   */
  suppressAutoSize?: boolean;
  /** Cycle 15 / Task 6 — when `true`, the column header can be dragged
   *  INTO the row group panel to append this column to `rowGroupCols`.
   *  When `false` (default — mirrors ag-grid), the panel REJECTS a
   *  drop of this column's header (the panel's drop indicator paints
   *  in a muted "rejected" variant during the hover). The column can
   *  still be added to `rowGroupCols` via the imperative
   *  `setGroupModel` API regardless of this flag — it gates only the
   *  UI drag-from-header gesture. Design plan:
   *  `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 6. */
  enableRowGroup?: boolean;
  /** AG parity 2026-07-21 — derives the string KEY used when grouping by
   *  this column (and displayed as the group label). Required to group
   *  object / non-string values. Runs in the WORKER: serialized via
   *  `Function.prototype.toString()` (same mechanism as custom
   *  comparators / aggFuncs), so it must be a self-contained pure
   *  function — closures over outer variables will not survive the
   *  round-trip. Params: `{ value, data }` (cell value + full row). */
  keyCreator?: (params: { value: unknown; data: TRow }) => string;
  /** Cycle 18 / Task 3 — gates whether the user may drag this column's
   *  header into the Column Labels (pivot) drop zone. `false` (default,
   *  mirrors ag-grid) rejects the drop; the imperative
   *  `setPivotColumns` / `addPivotColumn` API works regardless — this
   *  flag gates only the UI gesture (Task 5 / 7 wire the surfaces). */
  enablePivot?: boolean;
  /** Cycle 18 / Task 3 — gates whether the user may drag this column's
   *  header into the Values drop zone (aggregated measure). `false`
   *  (default) rejects the drop; the imperative `addValueColumn` API
   *  works regardless. */
  enableValue?: boolean;
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
  /**
   * Class name(s) applied to the group header cell. Resolves through the
   * theme's `headerClassVariants` map. Cycle 6 / Task 7 wires this (Cycle 4
   * was storage-only).
   */
  headerClass?: HeaderClass;
  /**
   * Cycle 27 / Task 1 — direct style override for this group's HEADER cell.
   * Static object or function form. Same precedence rules as the leaf
   * `headerStyle` field on `CColDef`.
   */
  headerStyle?: ColCellOverrides | HeaderStyleFunc;
  /**
   * AG-Grid parity — show/hide this SUB-GROUP based on the open/closed
   * state of its IMMEDIATE parent group. `'open'` → visible only while
   * the parent is open; `'closed'` → only while the parent is closed;
   * `null`/undefined → always visible. A hidden sub-group hides its
   * entire subtree. Evaluated per level, so each group's own toggle is
   * independent of its ancestors' states.
   */
  columnGroupShow?: 'open' | 'closed' | null;
  /**
   * Profile/layout visibility for the whole group. When `true`, the
   * Column Groups editor cascades `hide` onto every descendant leaf on
   * Apply so those columns disappear from the grid. Round-trips through
   * the columnDefs overlay; the paint path does not need to read this
   * (leaf `hide` is authoritative at runtime).
   */
  hide?: boolean;
}

export interface CValueGetterParams<TRow> { data: TRow; colId: string }
export interface CValueFormatterParams<TRow, TValue> {
  data: TRow; value: TValue; colId: string;
  /** Cycle 21e / Task 14 — string rowId of the data row, when the call
   *  site knows it (paint path). Enables the format-eval memo + the
   *  rule:<ruleId> accessor; absent → memo bypass, no rule refs. */
  rowId?: string;
  /** Cycle 21e / Task 14 — active theme kind, when known. */
  themeKind?: 'light' | 'dark';
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
 * A contiguous cell-range selection. Mirrors ag-grid's range shape:
 * a rectangle spanning `rowStart..rowEnd` (inclusive, visible-order
 * indices) by `colIds[]` (ordered left → right in render order).
 *
 * Disjoint selections are represented as multiple `SelectionRange`
 * entries in `SelectionModel.state.ranges`. Column-band selections
 * (header click) span `rowStart=0 → rowEnd=rowCount-1` with a single
 * colId; full-row ranges span every visible colId. Cycle 9 / Task 1.
 */
export interface SelectionRange {
  /** First row in the range (inclusive, current visible-order index). */
  rowStart: number;
  /** Last row in the range (inclusive, current visible-order index). */
  rowEnd: number;
  /** ColIds involved, in render order (left → right). */
  colIds: string[];
}

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

/**
 * Parameters for `CGridApi.sizeColumnsToFit`. Cycle 6 / Task 3.
 *
 * - `width` — explicit width to fit to. Defaults to the canvas drawable
 *   width (already excludes the vertical-scrollbar gutter).
 * - `defaultMinWidth` / `defaultMaxWidth` — fallback bounds applied to
 *   leaves that don't carry per-column `minWidth` / `maxWidth`. The
 *   tighter of the two wins (per-column min beats default min only when
 *   it's larger; per-column max beats default max only when it's smaller).
 * - `columnLimits` — per-column min/max overrides keyed by `colId`. Wins
 *   over both the column's own bounds and the param-level defaults.
 */
export interface ISizeColumnsToFitParams {
  width?: number;
  defaultMinWidth?: number;
  defaultMaxWidth?: number;
  columnLimits?: Array<{ key: string; minWidth?: number; maxWidth?: number }>;
}
