// CGridApi — the imperative public API surface on a CGrid instance. Plus
// the transaction shapes (Tx, TransactionResult) since they're API-shaped.
// Depends on every other domain file (column, filter, group, event,
// options) and the external interaction/* modules for IStatusPanelComp,
// SideBarDef, ToolPanel, CellEditorCtor.

import type { CellEditorCtor } from '../interaction/editors/iCellEditor';
import type { ToolPanel, SideBarDef } from '../interaction/toolPanels/types';
import type { IStatusPanelComp } from '../interaction/statusBar/types';
import type {
  CApplyColumnStateParams,
  CColumnState,
  FlashCellsParams,
  ISizeColumnsToFitParams,
  SelectionRange,
  SortModel,
} from './column';
import type { CFilterModelEntry, FilterModel } from './filter';
import type { GroupModel } from './group';
import type { CGridEvent } from './event';
import type { CGridOptions } from './options';

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

export interface CGridApi<TRow = any> {
  setRowData(rows: TRow[]): void;
  applyTransaction(t: Tx<TRow>): TransactionResult;
  applyTransactionAsync(t: Tx<TRow>): void;
  flushAsyncTransactions(): void;

  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  setGroupModel(g: GroupModel): void;

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: replace the
   *  entire ordered row-group column list. Equivalent to
   *  `setGroupModel({ rowGroupCols })` but routes through the
   *  GroupingState primitive so all three grouping UIs
   *  (panel / tool panel / context menu) re-render live. */
  setRowGroupColumns(columns: string[]): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: append
   *  `colId` to the row-group column list. No-op when the column is
   *  already grouped. */
  addRowGroupColumn(colId: string): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: remove
   *  `colId` from the row-group column list. No-op when the column
   *  isn't currently grouped. */
  removeRowGroupColumn(colId: string): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: move the
   *  column at index `from` to index `to`. `to === length` slots
   *  the column at the end of the list. The per-level sort entry
   *  travels with the column. No-op when `from === to`. */
  moveRowGroupColumn(from: number, to: number): void;
  /** Cycle 15.5 / Task 1 — primitive grouping mutation: set the
   *  per-level sort for the row-group level holding `colId`.
   *  `direction: null` clears the sort. No-op when `colId` isn't
   *  in the row-group column list. */
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void;
  /** Cycle 15.5 / Task 1 — snapshot of the current row-group column
   *  list in nesting order. Returns a fresh array — callers may
   *  mutate it without affecting grid state. */
  getRowGroupColumns(): string[];

  // ─── Cycle 18 / Task 3 — pivot API (ag-grid parity) ───────────────────
  /** Whether pivot mode is on. */
  isPivotMode(): boolean;
  /** Turn pivot mode on / off. A pivot only produces a matrix when at
   *  least one pivot column AND one value column are also set. */
  setPivotMode(pivotMode: boolean, opts?: { discardSettings?: boolean }): void;
  /** Snapshot of the ordered pivot (Column Label) columns. Fresh array. */
  getPivotColumns(): string[];
  /** Replace the ordered pivot column list wholesale. */
  setPivotColumns(colIds: string[]): void;
  /** Append a pivot column (idempotent). */
  addPivotColumn(colId: string): void;
  /** Remove a pivot column (idempotent). */
  removePivotColumn(colId: string): void;
  /** Move a pivot column from index `from` to index `to`. */
  movePivotColumn(from: number, to: number): void;
  /** Snapshot of the ordered value columns (`{ colId, aggFunc }`). Fresh. */
  getValueColumns(): Array<{ colId: string; aggFunc: string }>;
  /** Append a value column with its aggregation (idempotent by colId). */
  addValueColumn(colId: string, aggFunc: string): void;
  /** Remove a value column (idempotent). */
  removeValueColumn(colId: string): void;
  /** Reorder a value column in-place — `from` and `to` are indices
   *  into the current `getValueColumns()` order. */
  moveValueColumn(from: number, to: number): void;
  /** Change an existing value column's aggregation function. */
  setValueColumnAggFunc(colId: string, aggFunc: string): void;

  /** Cycle 15 / Task 7 — expand every row group. Fires
   *  `expandOrCollapseAll` with `expanded: true`. No-op when grouping
   *  is bypassed (`rowGroupCols.length === 0`). */
  expandAll(): void;
  /** Cycle 15 / Task 7 — collapse every row group. Fires
   *  `expandOrCollapseAll` with `expanded: false`. No-op when grouping
   *  is bypassed. */
  collapseAll(): void;
  /** Cycle 15 / Task 7 — set a specific group's expanded state by
   *  composite key (`${col}:${value}` per level, joined by `::`).
   *  Idempotent — calling with the current state is a no-op. Fires
   *  `rowGroupOpened` with `source: 'api'` when the state actually
   *  changes. Unknown keys (a stale key from a prior group model)
   *  silently no-op. */
  setExpanded(groupKey: string, expanded: boolean): void;
  /** Cycle 15 / Task 7 — snapshot of currently-expanded composite
   *  group keys. Returns a fresh `Set` (mutations don't affect grid
   *  state). Empty when grouping is bypassed. */
  getExpandedKeys(): Set<string>;
  /** Cycle 15.5 — scroll the row at `index` into view. `position`
   *  controls where the row lands: `'auto'` (default) scrolls only when
   *  out of view, `'top'` / `'middle'` / `'bottom'` always moves it. */
  ensureIndexVisible(index: number, position?: 'auto' | 'top' | 'middle' | 'bottom'): void;
  /** Cycle 15.5 / Task 1 — reset all row groups to collapsed. */
  resetRowGroupExpansion(): void;

  /** Cycle 7 / Task 9 — read the v2 per-column filter entry for
   *  `colId`. Returns `null` when the column is unfiltered or
   *  unknown. The generic parameter lets callers narrow to a
   *  specific entry shape — `getColumnFilterModel<CTextFilterModel>(
   *  'cusip')` — without an external cast. */
  getColumnFilterModel<TModel extends CFilterModelEntry = CFilterModelEntry>(
    colId: string,
  ): TModel | null;
  /** Cycle 7 / Task 9 — apply a per-column filter mutation. Updates
   *  the canonical v2 map and ships the composed `FilterModel` to the
   *  worker. Passing `model: null` clears the column. Returns a
   *  Promise that resolves once the worker round-trip lands and the
   *  resulting `filterChanged` event has fired. */
  setColumnFilterModel(
    colId: string,
    model: CFilterModelEntry | null,
  ): Promise<void>;
  /** Cycle 7 / Task 9 — `true` when ANY filter source is active:
   *  per-column filter, quick filter, external filter, or alwaysPass
   *  (which is technically inverse but is still "filter state
   *  diverging from raw rows"). */
  isAnyFilterPresent(): boolean;
  /** Cycle 7 / Task 9 — `true` when at least one per-column filter
   *  entry is set. Does NOT consider quick / external filters. */
  isColumnFilterPresent(): boolean;
  /** Cycle 7 / Task 9 — clear the column's filter and any cached
   *  popup state (closes the popup if it's open on `colId`).
   *  Idempotent. */
  destroyFilter(colId: string): void;

  /** Cycle 4 / Task 11 (cell-flash patch) — programmatic cell flash.
   *  Useful for app-driven highlights (validation success pulse,
   *  row-just-loaded). No-op when `enableCellChangeFlash: false` or
   *  `prefers-reduced-motion: reduce`. The flash actually paints on
   *  the next viewport reply (one frame of latency for the worker
   *  round-trip). */
  flashCells(params: FlashCellsParams): void;

  /** Open the filter popup for `colId`. No-op when the column has no
   *  resolved filter, the column isn't currently in the viewport, or
   *  the popup is already open for the same column. The popup mounts
   *  beneath the column's floating-filter cell anchored via
   *  `getHeaderBoundsAt`. Cycle 7 / Task 3. */
  showColumnFilter(colId: string): void;
  /** Close any open filter popup. Idempotent. Cycle 7 / Task 3. */
  hideColumnFilter(): void;

  /** Cycle 7 / Task 8 — re-run the filter pipeline. Use after mutating
   *  any state that `options.isExternalFilterPresent` /
   *  `options.doesExternalFilterPass` close over (e.g. a toolbar
   *  checkbox toggling "show only USD"). `source` rides through to the
   *  `filterChanged` event so apps can correlate the trigger:
   *  - `'api'` (default) — programmatic re-trigger
   *  - `'columnFilter'` — per-column model mutation
   *  - `'quickFilter'` — `quickFilterText` change
   *  - `'externalFilter'` — external-filter predicate state changed
   *  Returns once the worker round-trip lands; the `filterChanged`
   *  event fires with the resolved per-column model. */
  onFilterChanged(source?: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter'): void;

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
  /** Cycle 15 / Task 8 — aggregate selection state for `groupKey`
   *  across every descendant leaf row:
   *  - `'none'` — no descendant selected (or `groupSelectsChildren`
   *    is off / the key is unknown).
   *  - `'partial'` — some but not all descendants selected.
   *  - `'all'` — every descendant selected.
   *
   *  Snapshot read; the value is recomputed on demand from the
   *  persistent selected-rowId set and the worker's descendant cache.
   *  Apps building custom group-row UIs can hide / show / disable
   *  bulk-action menus based on this state. */
  getGroupSelectionState(groupKey: string): 'none' | 'partial' | 'all';

  /** Cycle 13 / Task 2 — current displayed (post-filter) row count.
   *  Matches `getDisplayedRowCount()` on the underlying CGrid; exposed
   *  on the public API so status-bar count panels (and any custom
   *  panel that wants the same number) can call it without reaching
   *  into the grid instance. Equal to the `visibleRowCount` last
   *  shipped via `modelUpdated`. */
  getDisplayedRowCount(): number;
  /** Cycle 13 / Task 2 — total pre-filter row count (the size of the
   *  data the grid was last seeded with, plus any add / minus any
   *  remove from `applyTransaction`). Powers
   *  `agTotalRowCountComponent` + `agTotalAndFilteredRowCountComponent`.
   *  Reads off the main-thread `rowDataById` cache, NOT a worker
   *  round-trip, so it's cheap to call from a per-frame refresh. */
  getTotalRowCount(): number;

  /** Cycle 10 / Task 3 — serialise the current `getCellRanges()` to
   *  TSV (or CSV when `clipboardDelimiter` overrides the default `\t`)
   *  on the worker, then forward the encoded string to
   *  `navigator.clipboard.writeText`. Resolves once the clipboard
   *  write succeeds. Rejects when:
   *  - no range is selected (no-op result; rejects with `'no-ranges'`)
   *  - the Async Clipboard API is unavailable (e.g. insecure context
   *    without a polyfill — the keyboard handler runs inside the user
   *    gesture so this is the only realistic reject path)
   *  - the clipboard write rejects (browser permission denial, no user
   *    gesture stack — apps invoking this from a `setTimeout` should
   *    expect this)
   *
   *  Backs both the Ctrl+C shortcut and the default `Copy` context-menu
   *  item. Apps that ship their own clipboard layer set
   *  `suppressClipboardApi: true` (Task 6) so this becomes a no-op. */
  copySelectedRangesToClipboard(opts?: { includeHeaders?: boolean }): Promise<void>;

  /** Cycle 10 / Task 4 — read the system clipboard, parse the payload
   *  (TSV by default; CSV when `clipboardDelimiter` overrides) on the
   *  worker, and apply via `applyTransaction({ update: [...] })`
   *  rooted at the focused cell. When the parsed grid extends past
   *  the focused cell's column band, it pastes into the next visible
   *  columns to the right and the next visible rows below.
   *
   *  No-op (resolves without writing) when:
   *  - no cell is currently focused
   *  - the clipboard payload is empty
   *  - `suppressClipboardPaste === true` (Task 6 wires this gate)
   *
   *  Rejects when `navigator.clipboard.readText` rejects (no user
   *  gesture / permission denial / insecure context). Backs both the
   *  Ctrl+V shortcut and the default `Paste` context-menu item. */
  pasteFromClipboard(): Promise<void>;

  /** Cycle 10 / Task 5 — combination of `copySelectedRangesToClipboard`
   *  and a clear-update over the source cells. The clipboard write
   *  fires first; only if it succeeds does the clear `applyTransaction`
   *  follow. Resolves once both legs complete. Rejects when:
   *  - no range is selected (`'no-ranges'`)
   *  - `copySelectedRangesToClipboard` rejects (the source cells stay
   *    untouched — no partial-cut state)
   *
   *  Cleared cells are written through `valueSetter` when the column
   *  defines one, falling back to direct field assignment of `''`.
   *  Backs both the Ctrl+X shortcut and the default `Cut` context-menu
   *  item. */
  cutSelectedRanges(): Promise<void>;

  /** Snapshot of the currently-selected cell ranges. Returns a fresh
   *  array; mutating it does NOT affect grid state. Empty when no
   *  range is active. Cycle 9 / Task 6. */
  getCellRanges(): SelectionRange[];
  /** Append a range to the current selection. Existing ranges stay —
   *  this is the disjoint-add path, mirroring ctrl/cmd-click semantics.
   *  Cycle 9 / Task 6. */
  addCellRange(range: SelectionRange): void;
  /** Drop every range. Row selection and the focused cell are
   *  unaffected. No-op when no range is active. Cycle 9 / Task 6. */
  clearCellRanges(): void;

  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;

  refresh(): void;
  setTheme(themeClass: string): void;
  destroy(): void;

  getColumnGroupState(): { groupId: string; open: boolean }[];
  setColumnGroupState(state: { groupId: string; open: boolean }[]): void;
  resetColumnGroupState(): void;

  /** Cycle 11 / Task 5 — call `refresh()` on the live `ToolPanel`
   *  instance for `id`. Silent no-op when:
   *  - `id` is unknown (not registered in `CGridOptions.components` and
   *    not one of the built-in IDs);
   *  - no side bar is configured;
   *  - the matching panel is registered but not currently mounted
   *    (i.e. the user has not opened it via `openToolPanel(id)` or a
   *    tab click). Panels are only instantiated on open and destroyed
   *    on close, so a panel that has never been opened has no
   *    instance for `refresh()` to fire on.
   *
   *  Works for both built-in panels (`'agColumnsToolPanel'`,
   *  `'agFiltersToolPanel'`) and app-supplied custom panels keyed by
   *  the same `id` they registered under in `CGridOptions.components`. */
  refreshToolPanel(id: string): void;
  /** Cycle 11 / Task 5 — the live `ToolPanel` instance for `id`, or
   *  `null` when no instance is currently mounted (panel never opened,
   *  `id` unknown, or no side bar configured). Apps reach for this to
   *  invoke panel-specific methods that aren't part of the `ToolPanel`
   *  interface — e.g. a custom panel might expose `expandAll()` or
   *  `selectColumn(colId)`. Treat the returned instance as a borrowed
   *  reference: it stops being valid the moment the user closes the
   *  panel (the host calls `destroy()` and drops the reference). */
  getToolPanelInstance(id: string): ToolPanel | null;

  /** Cycle 11 / Task 6 — `true` when the side bar is currently
   *  visible (mounted AND not in `display: none`). Returns `false`
   *  when no side bar is configured, when `SideBarDef.hiddenByDefault`
   *  is `true`, or after `setSideBarVisible(false)`. */
  isSideBarVisible(): boolean;
  /** Cycle 11 / Task 6 — show or hide the whole side bar. Silent
   *  no-op when no side bar is configured. Triggers one canvas
   *  reflow on visibility change so the canvas region grows or
   *  shrinks to fill the released / reclaimed gutter. */
  setSideBarVisible(show: boolean): void;
  /** Cycle 11 / Task 6 — move the side bar to the left or right edge.
   *  Silent no-op when no side bar is configured. Releases the old
   *  edge reservation + claims the new one in one synchronous resize.
   *  The resolved position is observable through `getSideBar().position`. */
  setSideBarPosition(pos: 'left' | 'right'): void;
  /** Cycle 11 / Task 6 — open the tool panel with the given `id`.
   *  Silent no-op when no side bar is configured or when `id` is not
   *  one of the registered panels. Closes any previously-open panel
   *  first — only one panel is open at a time. Works for built-in ids
   *  (`agColumnsToolPanel`, `agFiltersToolPanel`) and app-supplied
   *  custom ids from `CGridOptions.components`. */
  openToolPanel(id: string): void;
  /** Cycle 11 / Task 6 — close the currently open tool panel. Silent
   *  no-op when no side bar is configured or no panel is open. The
   *  host destroys the live `ToolPanel` instance so panels can't leak
   *  listeners; `getToolPanelInstance(id)` returns `null` afterwards. */
  closeToolPanel(): void;
  /** Cycle 11 / Task 6 — the id of the currently open panel, or
   *  `null` when no panel is open / no side bar is configured. */
  getOpenedToolPanel(): string | null;
  /** Cycle 11 / Task 6 — the resolved `SideBarDef` (string shortcuts
   *  expanded into full `ToolPanelDef` objects, `position` defaulted
   *  to `'right'` when not specified), or `undefined` when no side
   *  bar was configured on this grid. The returned object reflects
   *  the LIVE def — `setSideBarPosition` mutations are observable
   *  via the `position` field on subsequent reads. */
  getSideBar(): SideBarDef | undefined;

  /** Cycle 13 / Task 4 — the live `IStatusPanelComp` instance for
   *  `key`, or `undefined` when no status bar is configured, `key`
   *  is unknown, or the matching panel never resolved a ctor (the
   *  `statusPanel` string referenced an unregistered component). The
   *  generic parameter `T` lets apps narrow the return to a custom
   *  panel's concrete class to call panel-specific methods that
   *  aren't on the `IStatusPanelComp` interface — e.g. a custom
   *  panel might expose `getSnapshot()` or `setRange(r)`. Treat the
   *  returned instance as a borrowed reference: it stops being valid
   *  the moment the status bar is destroyed or replaced via
   *  `setStatusBarDef` (the host calls `destroy()` and drops the
   *  reference).
   *
   *  Built-in keys (`'agTotalRowCountComponent'`,
   *  `'agFilteredRowCountComponent'`, `'agSelectedRowCountComponent'`,
   *  `'agTotalAndFilteredRowCountComponent'`, `'agAggregationComponent'`)
   *  and custom keys registered via `CGridOptions.components` are
   *  both reachable through this surface. */
  getStatusPanel<T extends IStatusPanelComp = IStatusPanelComp>(key: string): T | undefined;

  /** Read the current value of any grid option. */
  getGridOption<K extends keyof CGridOptions<TRow>>(key: K): CGridOptions<TRow>[K] | undefined;
  /** Update a single runtime-mutable option. Throws on initial-only keys
   *  (see `INITIAL_ONLY_OPTIONS` in `core/runtimeOptions.ts`). */
  setGridOption<K extends keyof CGridOptions<TRow>>(key: K, value: CGridOptions<TRow>[K]): void;
  /** Batch-update multiple runtime-mutable options. The `columnDefs` key is
   *  honored only via this batched entrypoint (not via `setGridOption`)
   *  because it rebuilds the column tree + worker column metadata. */
  updateGridOptions(partial: Partial<CGridOptions<TRow>>): void;

  /** Register a custom cell renderer under `name`. Columns referencing the
   *  name via `cellRenderer` (or a `cellRendererSelector` return value)
   *  will dispatch to `painter` at paint time. Built-in names ('text',
   *  'number', 'checkbox', 'header') can be overridden by re-registering. */
  registerCellRenderer(name: string, painter: import('../renderer/cellRenderers/registry').CellPainter): void;

  /** Cycle 21c / Task 10 — register the format compiler (supplied by
   *  @cgrid/format's wireIntoKernel). Kernel invokes it in the
   *  compileFormatSlots pass (Task 11). Apps that never call this see
   *  identical behavior to before. */
  registerFormatCompiler(fn: import('../core/formatCompilerSlot').FormatCompiler): void;

  /** Cycle 21e / Task 10 — register the rule engine (supplied by
   *  @cgrid/rules' wireIntoKernel). Kernel consults it in the
   *  applyCellProps fold (Task 11). Apps that never call this see
   *  identical behavior to before. */
  registerRuleEngine(engine: import('../core/ruleEngineSlot').RuleEngineShape): void;

  /** Cycle 21d / Task 9 — register the calc provider (supplied by
   *  @cgrid/calc's wireIntoKernel). Kernel folds its synthesized calc
   *  columns + override patches into column resolution and ships its
   *  worker program (Task 10). Apps that never call this see
   *  identical behavior to before. */
  registerCalcProvider(provider: import('../core/calcSlot').CalcProviderShape): void;

  /** Cycle 21d / Task 13 — distinct stringified values for `colId`
   *  (first-seen order, nulls dropped). Optional `limit` truncates the
   *  reply; the worker-side cache stays full. */
  getDistinctValues(colId: string, limit?: number): Promise<string[]>;

  /** Cycle 21g / Task 10 — fetch full rows by current visible-order index
   *  (batched worker round-trip). One entry per requested index, order
   *  preserved; null for out-of-range indexes. */
  getRowsByIndex(rowIndexes: number[]): Promise<Array<{ rowIndex: number; rowId: string; data: TRow } | null>>;

  /** Cycle 21e / Task 10 — iterate the main-thread row mirror
   *  (rowId → row, insertion order). */
  forEachRow(fn: (rowId: string, row: TRow) => void): void;

  /** Cycle 21e / Task 10 — binary light/dark kind of the active theme. */
  getThemeKind(): 'light' | 'dark';

  /** Cycle 21i / Phase 1 — apply `--cg-*` theme token overrides (e.g.
   *  data colours: row selection, cell range, flash). Live + repaints. */
  setThemeParams(patch: Readonly<Record<string, string>>): void;
  /** Cycle 21i / Phase 1 — the currently-set theme token overrides
   *  (only values set via `setThemeParams`, not resolved tokens). */
  getThemeParams(): Record<string, string>;

  /** Cycle 21i / Phase 1 — the theme/density-resolved row height that
   *  applies when `rowHeight` is not set. Tracks density swaps. */
  getDefaultRowHeight(): number;
  /** Cycle 21i / Phase 1 — the theme/density-resolved header height that
   *  applies when `headerHeight` is not set. */
  getDefaultHeaderHeight(): number;

  /** Cycle 21c / Task 12 — register a named icon set whose entries are
   *  SVG path strings (lazy-converted to Path2D on first use) or
   *  pre-built Path2D instances. Subsequent `resolveIcon` calls look
   *  up icons by name across all registered sets.
   *
   *  Kernel never auto-registers any icon set; `@cgrid/format`'s
   *  `wireIntoKernel` registers the Lucide bundle. Apps that supply
   *  additional icon sets (e.g. a custom Phosphor bundle) call this
   *  at init time alongside `wireIntoKernel`. Re-registering under
   *  the same `name` replaces the prior set. */
  registerIconSet(name: string, paths: Record<string, string | Path2D>): void;
  /** Cycle 21c / Task 12 — look up an icon by name across all
   *  registered icon sets. When `setHint` is provided the named set
   *  is searched first before falling back to insertion order.
   *  Returns a cached `Path2D` (lazy-constructed on first access from
   *  the string path data) or `null` when the name is not found in
   *  any set or when `Path2D` is unavailable (SSR / Node). */
  resolveIcon(name: string, setHint?: string): Path2D | null;

  /** Cycle 21c / Task 14 — register a per-column tooltip provider.
   *  The provider fires after a 500ms hover debounce on cells in
   *  `colId` and returns `{ plain }` or `{ html }` (or null for "no
   *  tooltip on this cell"). Re-registering the same colId replaces
   *  the prior provider. */
  registerTooltipProvider(
    colId: string,
    fn: import('../interaction/features/tooltipProvider').TooltipProviderFn,
  ): void;
  /** Cycle 21c / Task 14 — remove the tooltip provider for `colId`.
   *  No-op when none is registered. */
  unregisterTooltipProvider(colId: string): void;

  /** Register a custom cell editor under `name`. Columns referencing it via
   *  `cellEditor: name` will mount this editor when edit starts. Built-in
   *  names ('text' shipped in Cycle 5 Task 1; 'number' / 'date' / 'select' /
   *  'largeText' / 'checkbox' / 'dateString' in Task 2) can be overridden. */
  registerCellEditor(name: string, ctor: CellEditorCtor): void;

  /** Register a custom comparator under `name`. Column defs reference the
   *  registered comparator via `comparator: name`. The function
   *  string-serialises through `Function.prototype.toString()` and
   *  reconstructs on the worker via `new Function(...)` so the sort
   *  stays off the main thread; the function MUST be pure and may not
   *  close over external scope (closures don't survive the
   *  reconstruction). Re-registering overwrites. Returns a Promise that
   *  resolves once the worker acknowledges the registration; awaiting
   *  it before the next `setSortModel` guarantees the sort uses the
   *  registered comparator instead of falling back to the default
   *  text/number compare. Cycle 8 / Task 3. */
  registerComparator<TValue = unknown>(
    name: string,
    fn: (a: TValue, b: TValue) => number,
  ): Promise<void>;

  /** Programmatically start editing the cell at `(rowIndex, colId)`.
   *  No-op when the cell is not editable or not in the current viewport. */
  startEditingCell(rowIndex: number, colId: string): void;
  /** Close any active editor. `cancel=true` discards the new value; default
   *  commits it through `valueParser → valueSetter` like Enter / Tab. */
  stopEditing(cancel?: boolean): void;

  /** Subscribe to a typed event. Returns an unsubscribe function. */
  on<K extends CGridEvent<TRow>['type']>(
    type: K,
    handler: (event: Extract<CGridEvent<TRow>, { type: K }>) => void,
  ): () => void;
  /** Remove a previously-registered listener. */
  off<K extends CGridEvent<TRow>['type']>(
    type: K,
    handler: (event: Extract<CGridEvent<TRow>, { type: K }>) => void,
  ): void;
  /** Alias for `on()`, present for ag-grid API parity. */
  addEventListener<K extends CGridEvent<TRow>['type']>(
    type: K,
    handler: (event: Extract<CGridEvent<TRow>, { type: K }>) => void,
  ): () => void;
  /** Alias for `off()`, present for ag-grid API parity. */
  removeEventListener<K extends CGridEvent<TRow>['type']>(
    type: K,
    handler: (event: Extract<CGridEvent<TRow>, { type: K }>) => void,
  ): void;

  /** Move the leaf at `fromIndex` to `toIndex` in the flat visible-leaf
   *  order. No-op when `fromIndex === toIndex` or either index is out of
   *  range. Honors `lockPosition` + `marryChildren` — illegal moves clamp
   *  to the nearest legal index, NOT throw. Fires `columnMoved` with
   *  `source: 'api'`. Cycle 6 / Task 1. */
  moveColumnByIndex(fromIndex: number, toIndex: number): void;

  /** Show or hide every listed column in one batch. Unknown keys + columns
   *  marked `lockVisible: true` are silently dropped. Mutates
   *  `columnDefsMap` in place through ONE re-layout + repaint and emits
   *  one `columnVisible` event whose `colIds` is the list that actually
   *  changed (`source: 'api'`). No-op when no column's `hide` state
   *  actually flips. Cycle 6 / Task 5. */
  setColumnsVisible(keys: string[], visible: boolean): void;

  /** Pin or unpin every listed column in one batch. Pass `null` to unpin.
   *  Unknown keys + columns marked `lockPinned: true` are silently
   *  dropped. Mutates `columnDefsMap` in place through ONE re-layout +
   *  repaint and emits one `columnPinned` event whose `colIds` is the
   *  list that actually changed (`source: 'api'`). Cycle 6 / Task 5. */
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;

  /** Set explicit pixel widths for the listed columns in one batch. Each
   *  width is clamped to the column's resolved `minWidth` / `maxWidth`.
   *  Unknown keys are silently dropped. Mutates `columnDefsMap` in place
   *  through ONE re-layout + repaint and fires one `columnResized` per
   *  changed column with `source: 'api'`. The `finished` flag defaults
   *  to `true` (one save per call) but app code can pass `false` for the
   *  in-progress tick of a custom resize gesture. Cycle 6 / Task 5. */
  setColumnWidths(
    columnWidths: Array<{ key: string; newWidth: number }>,
    finished?: boolean,
  ): void;

  /** Move every listed column to start at `toIndex` in the flat visible-
   *  leaf order, preserving their declaration order. `lockPosition` +
   *  `marryChildren` still apply — illegal targets clamp to the nearest
   *  legal index. Unknown keys are silently dropped. Fires one
   *  `columnMoved` event per moved column with `source: 'api'`. Cycle 6 /
   *  Task 5. */
  moveColumns(keys: string[], toIndex: number): void;

  /** Serialisable snapshot of every leaf's mutable state (width, hide,
   *  pinned, sort, sortIndex, flex, plus reserved rowGroup / pivot /
   *  aggFunc slots) in the current flat-leaf order — hidden leaves
   *  included. Pair with `applyColumnState` for layout persistence.
   *  Cycle 6 / Task 2. */
  getColumnState(): CColumnState[];
  /** Returns the resolved `headerName` for `colId`, or `undefined` when
   *  the column is unknown or has no `headerName` set. Mirrors ag-grid's
   *  `getDisplayNameForColumn` for the labelling needs of the side-bar
   *  tool panels (Cycle 11 / Task 3) without forcing them to crack open
   *  the internal `columnDefsMap`. Hidden leaves still resolve — the
   *  Columns panel lists hidden columns with their headerName intact. */
  getColumnHeaderName(colId: string): string | undefined;
  /** Cycle 15.5 / Task 2 — `true` when the column's resolved colDef
   *  carries `enableRowGroup: true`. Used by the columns tool panel's
   *  Row Groups drop zone (decides which column-list rows offer a
   *  drag-to-group affordance) AND by the header context menu (gates
   *  the "Group by `<col>`" item visibility). Returns `false` for
   *  unknown colIds. */
  isColumnRowGroupEnabled(colId: string): boolean;
  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enablePivot: true`. Gates whether the columns tool panel + context
   *  menu let a user assign the column as a pivot (Column Label). Returns
   *  `false` for unknown colIds. */
  isColumnPivotEnabled(colId: string): boolean;
  /** Cycle 18 / Task 5 — `true` when the column's resolved colDef carries
   *  `enableValue: true`. Gates whether the columns tool panel + context
   *  menu let a user assign the column as a Values measure. Returns
   *  `false` for unknown colIds. */
  isColumnValueEnabled(colId: string): boolean;
  /** Cycle 15.5 / Task 2 (gap-fill) — `true` when the row group panel
   *  is mounted AND the viewport-coord point `(clientX, clientY)` falls
   *  inside its DOM rect.  Exposed on the public API so external drag
   *  sources (e.g. the columns tool panel column-list row drag) can route
   *  through the same row-group-panel acceptance path that column-header
   *  drags use via the `ColumnDrag` feature chain. */
  isPointInRowGroupPanel?(clientX: number, clientY: number): boolean;
  /** Cycle 15.5 / Task 2 (gap-fill) — inform the row group panel of an
   *  in-progress drag from an external source.  Pass `colId: null` to
   *  clear any hover state (e.g. on mouse-leave or drag-end). */
  setRowGroupPanelDragHover?(colId: string | null, clientX: number, clientY: number): void;
  /** Cycle 15.5 / Task 2 (gap-fill) — commit a column-list drag drop
   *  into the row group panel.  Returns `true` when the column was
   *  appended to `rowGroupColumns`, `false` when rejected (column
   *  already grouped or `enableRowGroup` not set). */
  commitRowGroupPanelDrop?(colId: string): boolean;
  /** Cycle 18 / Task 6 — `true` when the pivot panel is mounted AND
   *  the viewport-coord point `(clientX, clientY)` falls inside its
   *  DOM rect AND the panel currently accepts drops (`'always'` always
   *  accepts; `'onlyWhenPivoting'` accepts only when pivot is active).
   *  Exposed on the public API so external drag sources (column-header
   *  drags from the grid, columns tool panel column-list row drags)
   *  can route through the same pivot-panel acceptance path. */
  isPointInPivotPanel?(clientX: number, clientY: number): boolean;
  /** Cycle 18 / Task 6 — inform the pivot panel of an in-progress drag
   *  from an external source. Pass `colId: null` to clear any hover
   *  state (e.g. on mouse-leave or drag-end). */
  setPivotPanelDragHover?(colId: string | null, clientX: number, clientY: number): void;
  /** Cycle 18 / Task 6 — commit an external drag drop into the pivot
   *  panel. Returns `true` when the column was appended to
   *  `pivotColumns`, `false` when rejected (column already pivoted or
   *  `enablePivot` not set). */
  commitPivotPanelDrop?(colId: string): boolean;
  /** Cross-section pill drag routing — resolve the pill panel role
   *  ('rowGroup' | 'pivot' | 'value') at a viewport-coord point, or
   *  `null` when the point isn't over any pill container. */
  resolveDragTargetRole?(clientX: number, clientY: number): 'rowGroup' | 'pivot' | 'value' | null;
  /** Cross-section pill drag routing — atomically move `colId` from
   *  `fromRole` to `toRole`. Returns `true` on success; `false` when
   *  source equals target OR the target rejects the column (no
   *  matching enable flag). Rejection is silent — source role
   *  preserved. */
  commitPanelMove?(
    fromRole: 'rowGroup' | 'pivot' | 'value',
    toRole: 'rowGroup' | 'pivot' | 'value',
    colId: string,
  ): boolean;
  /** True when (clientX, clientY) is within the leaf column-header band.
   *  Used by external drag sources (e.g. Columns tool panel) to decide
   *  whether the cursor is hovering over the column-header strip. */
  isPointInColumnHeaderBand?(clientX: number, clientY: number): boolean;
  /** Inform the column-header area of an external drag hover.  Paints
   *  an insertion line at the nearest column gap.  Pass `colId=null`
   *  to clear (e.g. on drag-end or drag-leave). */
  setColumnHeaderDragHover?(colId: string | null, clientX: number, clientY: number): void;
  /** Commit an external drop onto the column-header area: moves `colId`
   *  to the nearest legal column position at `clientX`. */
  commitColumnHeaderDrop?(colId: string, clientX: number): void;
  /** Cycle 11 / Task 4 — the resolved popup-filter type for `colId`, or
   *  `null` when the column is unknown or has no filter. Used by the
   *  FiltersToolPanel to decide which columns get a collapsible row. */
  getColumnFilterType(colId: string): 'text' | 'number' | 'date' | 'set' | null;
  /** Cycle 11 / Task 4 — build the filter editor for `colId` for inline
   *  hosting (FiltersToolPanel). Returns a handle that owns the editor's
   *  GUI element + a `destroy` callback for teardown. The caller mounts
   *  the returned GUI element into its own DOM container. Resolves
   *  `null` when the column has no filter, is unknown, or the grid is
   *  destroyed before the async distinct-values fetch (set filter)
   *  completes. Mutations propagate via the same
   *  `setColumnFilterModel` path the popup uses. */
  buildColumnFilterEditor(colId: string): Promise<{
    gui: HTMLElement;
    destroy(): void;
  } | null>;
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

  /** Distribute the container width across the visible non-suppressed
   *  leaves. Flex columns prefer their flex weight; non-flex columns
   *  prefer their current width as a starting share. Per-column min/max
   *  win over the param-level defaults; `columnLimits` overrides both.
   *  `suppressSizeToFit: true` columns hold their current width. Fires
   *  one `columnResized` per changed leaf with `finished: true` and
   *  `source: 'sizeColumnsToFit'`. Cycle 6 / Task 3. */
  sizeColumnsToFit(params?: ISizeColumnsToFitParams): void;

  /** Resize the named columns to fit their widest visible content. Awaits
   *  a worker round-trip — the worker walks the active chunk (sampling
   *  head 2,500 + tail 2,500 rows when the row count exceeds 5,000),
   *  measures every cell with the column's font, and returns the max
   *  text width + per-cell padding. Main clamps to `minWidth` / `maxWidth`,
   *  applies widths atomically, repaints once, and fires one
   *  `columnResized` per changed leaf with `finished: true` and
   *  `source: 'autosizeColumns'`. `suppressAutoSize: true` columns are
   *  excluded. `skipHeader` defaults to false (header label is included
   *  in the max). Cycle 6 / Task 4. */
  autoSizeColumns(keys: string[], skipHeader?: boolean): Promise<void>;
  /** Equivalent to `autoSizeColumns(allVisibleNonSuppressedColIds,
   *  skipHeader)`. Cycle 6 / Task 4. */
  autoSizeAllColumns(skipHeader?: boolean): Promise<void>;

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

  /**
   * Returns the resolved background color that would be painted for the cell
   * at (`rowIndex`, `colId`), accounting for `cellClass`, `cellClassRules`,
   * and the function-form `cellStyle`. Returns `null` when the column is
   * unknown or the row is not in the current viewport chunk.
   *
   * Used by E2E tests to assert visual differentiation without reading canvas
   * pixels. Cycle 6 / Task 7.
   */
  getCellPaintedBg(rowIndex: number, colId: string): string | null;
}
