// Filter models + filter-popup parameter shapes. Cycle 7 introduced the
// v2 discriminated-union filter model; the legacy shape continues to
// round-trip through `setFilterModel`. Leaf module.

/** Legacy Cycle 4 / 5 filter entry shape. Continues to round-trip through
 *  `setFilterModel`; the worker's matcher accepts it directly. Task 2 of
 *  Cycle 7 widens the public type alias to the ag-grid-compatible v2 union
 *  ({ filterType, type, filter, ... }) while preserving this shape via a
 *  back-compat normaliser. */
export type FilterModelEntryLegacy =
  | { type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { type: 'number'; op: 'eq' | 'gt' | 'lt' | 'between'; value: number; value2?: number };

/** Cycle 7 / Task 1 (parser enhancement) — ag-grid-compatible text
 *  operator names. The floating-filter input parser only emits
 *  `contains` today; Task 5's text-filter popup adds the rest. */
export type CTextFilterOp =
  | 'contains' | 'notContains'
  | 'equals'   | 'notEqual'
  | 'startsWith' | 'endsWith'
  | 'blank' | 'notBlank';

/** Cycle 7 / Task 1 (parser enhancement) — ag-grid-compatible number
 *  operator names. The floating-filter parser emits the comparison
 *  variants + `inRange`; `blank` / `notBlank` land with Task 3's popup. */
export type CNumberFilterOp =
  | 'equals' | 'notEqual'
  | 'lessThan' | 'lessThanOrEqual'
  | 'greaterThan' | 'greaterThanOrEqual'
  | 'inRange'
  | 'blank' | 'notBlank';

/** Cycle 7 / Task 1 (parser enhancement) — date filter operators mirror
 *  the number set; comparisons run on ISO date strings. */
export type CDateFilterOp = CNumberFilterOp;

/** Forward-compatible v2 text-filter entry. The floating-filter parser
 *  emits `contains` for bare text and combines via
 *  `CMultiConditionFilterModel` for CSV / AND / OR. Task 5's popup
 *  widens the operator usage to the full `CTextFilterOp` surface. */
export interface CTextFilterModel {
  filterType: 'text';
  type: CTextFilterOp;
  filter?: string;
  /** Case-sensitive comparison (defaults to false). Reserved by Task 1;
   *  honoured fully by Task 5's text-filter popup. */
  caseSensitive?: boolean;
}

/** v2 number-filter entry. `inRange` activates the `filterTo` upper
 *  bound (inclusive). The floating-filter parser emits these directly
 *  via the `> 100`, `100..200`, `>=100`, etc. syntaxes. */
export interface CNumberFilterModel {
  filterType: 'number';
  type: CNumberFilterOp;
  filter?: number;
  /** Required when `type === 'inRange'`; inclusive upper bound. */
  filterTo?: number;
}

/** v2 date-filter entry. `filter` / `filterTo` carry ISO strings
 *  (`YYYY-MM-DD` or full timestamp). Floating-filter parser supports
 *  comparison + CSV; range via `..` requires both sides to parse as
 *  dates. */
export interface CDateFilterModel {
  filterType: 'date';
  type: CDateFilterOp;
  filter?: string;
  filterTo?: string;
}

/** Cycle 7 / Task 1 (parser enhancement) — multi-condition entry. Used
 *  by the floating-filter parser to compose CSV / AND / OR expressions.
 *  Conditions evaluate left-to-right and short-circuit. Task 6's popup
 *  surfaces the same shape with a maxNumConditions=2 constraint; the
 *  parser-generated form is uncapped (a five-element CSV produces a
 *  five-element conditions array). */
export interface CMultiConditionFilterModel {
  filterType: 'multi';
  operator: 'AND' | 'OR';
  conditions: Array<CTextFilterModel | CNumberFilterModel | CDateFilterModel>;
}

/** Cycle 7 / Task 9 — set-filter entry. `values` is the user's
 *  checked subset of the column's distinct values; a row passes when
 *  `String(value)` is in the set. An empty `values` array means
 *  "deselect all" — every row drops (matches ag-grid). Apps that want
 *  to clear the filter entirely should ship `null` to
 *  `setColumnFilterModel` rather than an empty set. */
export interface CSetFilterModel {
  filterType: 'set';
  values: string[];
}

/** Cycle 7 type alias for a single column's filter entry. Discriminated
 *  by `filterType`; consumers should switch on that. */
export type CFilterModelEntry =
  | CTextFilterModel
  | CNumberFilterModel
  | CDateFilterModel
  | CMultiConditionFilterModel
  | CSetFilterModel;

export type FilterModelEntry = FilterModelEntryLegacy | CFilterModelEntry;
export type FilterModel = Record<string, FilterModelEntry>;

/** Shared filter-popup UI parameters. Tasks 3-9 each read the relevant
 *  subset; this base shape is the contract every per-type filter
 *  (number/date/text/multi/set) honours. Mirrors ag-grid's
 *  `IProvidedFilterParams`. Cycle 7 / Task 3.
 *
 *  - `buttons` — which action buttons render in the popup footer.
 *    Defaults to `['apply', 'clear', 'reset']`. `'cancel'` is opt-in;
 *    `'apply'` is required for the popup to commit anything when
 *    `closeOnApply` is also off (otherwise the user has no way to
 *    surface their model).
 *  - `closeOnApply` — when true (default for Task 3+) the popup closes
 *    after Apply. When false, the popup stays open so the user can
 *    tweak the filter without re-opening.
 *  - `debounceMs` — reserved for Task 5's text-filter popup that
 *    auto-applies as the user types. Tasks 3 / 4 commit only via
 *    Apply.
 *  - `readOnly` — reserved for Task 9; non-interactive popup. */
export interface CFilterParams {
  buttons?: Array<'apply' | 'clear' | 'reset' | 'cancel'>;
  closeOnApply?: boolean;
  debounceMs?: number;
  readOnly?: boolean;
  /** Cycle 7 / Task 6 — caps the total condition rows the popup will
   *  show. Defaults to 2. When set to 1 the popup keeps the existing
   *  single-condition behaviour (no join radio, no second row). */
  maxNumConditions?: number;
  /** How many condition rows are mounted on initial open. Defaults to
   *  1; the remaining rows reveal as the user fills the previous one. */
  numAlwaysVisibleConditions?: number;
  /** Seed value for the join-operator radio between condition rows.
   *  Defaults to `'AND'`. */
  defaultJoinOperator?: 'AND' | 'OR';
}

/** Cycle 7 / Task 5 — text-filter specific parameters. Extends the
 *  shared `CFilterParams` surface with the four ag-grid knobs the text
 *  filter exposes:
 *
 *  - `caseSensitive` — default state for the in-popup checkbox. The
 *    emitted `CTextFilterModel` carries the resolved per-entry value;
 *    this field only seeds the initial UI state.
 *  - `textFormatter` — column-level pre-comparison normaliser the
 *    worker runs on BOTH the cell value AND the filter value before
 *    the operator fires. Built-in formatters: `'lowercase'` /
 *    `'uppercase'` / `'trim'`. Arbitrary closures are out of scope
 *    until Cycle 24's worker-module loader.
 *  - `trimInput` — when true, the filter value is trimmed at
 *    `setColumnFilterModel` time (main-side, before the model reaches
 *    the worker). Distinct from the column-level `textFormatter: 'trim'`,
 *    which trims values on every row comparison.
 *  - `showCaseSensitiveToggle` — when false, the popup suppresses the
 *    caseSensitive checkbox. Defaults to true.
 */
export interface CTextFilterParams extends CFilterParams {
  caseSensitive?: boolean;
  textFormatter?: 'lowercase' | 'uppercase' | 'trim';
  trimInput?: boolean;
  showCaseSensitiveToggle?: boolean;
}

/** Cycle 7 / Task 9 — set-filter (`agSetColumnFilter` parity) params.
 *
 *  - `values` overrides the data-derived distinct-value list. Cycle 7
 *    only honours the data-derived path; the static-array variant is
 *    reserved for Cycle 18's SSRM, which needs server-provided values.
 *  - `caseSensitive` toggles the mini-search comparison (the on-popup
 *    text input that narrows the checkbox list). Distinct from any
 *    cell-level case handling — the checked values are stored
 *    verbatim from the distinct set, so case is preserved on commit
 *    regardless of this flag.
 *  - `suppressMiniFilter` hides the inline search box.
 *  - `suppressSelectAll` hides the tri-state "Select All" checkbox. */
export interface CSetFilterParams extends CFilterParams {
  values?: string[];
  caseSensitive?: boolean;
  suppressMiniFilter?: boolean;
  suppressSelectAll?: boolean;
}
