// Grid event union + individual editing/aggregation event shapes.
// Depends on column.ts (SortModel, SelectionRange, CColumnState — the
// columnState reset event has no payload, but other events carry refs),
// filter.ts (FilterModel), and forward-references CGridApi from api.ts
// for the `gridReady` event. The api.ts ↔ event.ts cycle is resolved
// via `import type` (type-only references, no runtime emission).

import type { CGridApi } from './api';
import type { SortModel, SelectionRange } from './column';
import type { FilterModel } from './filter';
import type { TransactionResult } from './api';

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

/** Cycle 14 / Task 6 — discriminator on `aggregationChanged` events that
 *  identifies which mutation drove the recompute. Apps that listen for
 *  this event correlate the source tag to their own state (e.g. a toast
 *  that says "totals refreshed: filter applied" vs. "data updated"). The
 *  set is closed — new sources land here as the API surface grows. */
export type AggregationChangedSource =
  | 'rowDataChanged'
  | 'aggFuncChanged'
  | 'filterChanged'
  | 'columnAggFuncChanged'
  | 'api';

/** Cycle 14 / Task 6 — strongly-typed shape of the `aggregationChanged`
 *  event. Exported so apps can declare typed listeners without reaching
 *  into the `CGridEvent` union. */
export interface AggregationChangedEvent {
  type: 'aggregationChanged';
  totals: Record<string, unknown>;
  source: AggregationChangedSource;
}

export type CGridEvent =
  | { type: 'gridReady'; api: CGridApi }
  | { type: 'cellClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellDoubleClicked'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  /** Cycle 23 / Task 2 — pointer crossed a cell boundary. Fires per
   *  transition only (never per pixel). The Out event is paired with
   *  the Over event for the next cell when the pointer moves from one
   *  cell to another; either fires alone when the pointer enters or
   *  leaves the body band entirely. */
  | { type: 'cellMouseOver'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  | { type: 'cellMouseOut'; rowId: string; colId: string; value: unknown; mouse: MouseEvent }
  /** Cycle 23 / Task 2 — pointer crossed a row boundary. Coalesced
   *  per row: moving across multiple cells inside the same row fires
   *  zero `rowMouse*` events. */
  | { type: 'rowMouseOver'; rowId: string; mouse: MouseEvent }
  | { type: 'rowMouseOut'; rowId: string; mouse: MouseEvent }
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
  /** Cycle 23 / Task 3 — fires on every scroll tick. `direction`
   *  carries the dominant axis of THIS tick relative to the previous
   *  scroll position (`'vertical'` if `top` changed, `'horizontal'`
   *  if only `left` changed). Apps that watch scroll progress
   *  (mini-map cursors, custom virtualization) subscribe here.
   *  Pair with `bodyScrollEnd` (debounced) for "settled" handlers. */
  | { type: 'bodyScroll'; top: number; left: number; direction: 'vertical' | 'horizontal' }
  /** Cycle 23 / Task 3 — debounced companion to `bodyScroll`. Fires
   *  exactly once 200ms after the last scroll tick; subsequent
   *  scrolls within the window reset the debounce. Apps that
   *  persist scroll position to storage hook this instead of
   *  `bodyScroll` so they save once per gesture. */
  | { type: 'bodyScrollEnd'; top: number; left: number }
  /** Cycle 23 / Task 4 — focused cell sees a keydown BEFORE the grid's
   *  own key handler. Apps can call `event.preventDefault()` to
   *  suppress grid behavior (e.g., disable Enter-to-commit on a
   *  specific column). `rowId` / `colId` reflect the currently
   *  focused cell at the moment the key fired; `value` is the cell
   *  value via `cellAt`. */
  | { type: 'cellKeyDown'; rowId: string; colId: string; value: unknown; event: KeyboardEvent }
  /** Cycle 23 / Task 4 — fires alongside `cellKeyDown` when the key
   *  represents a single printable character (length-1 `event.key`
   *  with no Ctrl / Meta / Alt modifier). Modern browsers deprecated
   *  the native `keypress` event; the grid synthesizes this from
   *  keydown so apps that watched ag-grid's `cellKeyPress` still get
   *  the type-to-edit hook. `preventDefault` on the underlying
   *  KeyboardEvent suppresses the grid's printable-key behavior the
   *  same way. */
  | { type: 'cellKeyPress'; rowId: string; colId: string; value: unknown; event: KeyboardEvent }
  /** Cycle 23 / Task 7 — fires when any GridState component changes.
   *  Debounced per rAF: N changes within one frame collapse into one
   *  event. The payload carries the FULL state snapshot + a
   *  changedKeys array tagged with the GridState keys that mutated
   *  this frame. `source` distinguishes the trigger — `'api'` for an
   *  explicit `setState` call, `'init'` for the `initialState`
   *  constructor option, `'ui'` for everything else (user
   *  interaction, runtime option swap, drag, etc.). */
  | {
      type: 'stateUpdated';
      state: import('../core/stateSnapshot').GridState;
      changedKeys: (keyof import('../core/stateSnapshot').GridState)[];
      source: 'api' | 'ui' | 'init';
    }
  | { type: 'modelUpdated'; visibleRowCount: number }
  | { type: 'sortChanged'; sortModel: SortModel }
  | {
      type: 'filterChanged';
      filterModel: FilterModel;
      /** Labels the trigger so apps can correlate the event with the user
       *  action that drove it. `'api'` is the default (a `setFilterModel`
       *  call); `'columnFilter'` fires from a per-column model mutation;
       *  `'quickFilter'` fires from `setGridOption('quickFilterText', ...)`.
       *  `'externalFilter'` is reserved for Task 8. Optional for
       *  back-compat — Tasks 1-6 emit without it. Cycle 7 / Task 7. */
      source?: 'api' | 'quickFilter' | 'columnFilter' | 'externalFilter';
      /** Cycle 7 / Task 9 — true when the change was triggered by a
       *  data update (a transaction landed and the worker re-evaluated
       *  the model against new rows) rather than a model mutation.
       *  Apps that distinguish "user changed the filter" from "data
       *  changed under an existing filter" branch on this. Optional —
       *  unset is equivalent to `false`. */
      afterDataChange?: boolean;
      /** Cycle 7 / Task 9 — colIds whose per-column filter state
       *  actually changed in this event. Empty / unset when the event
       *  isn't column-driven (e.g. a quickFilter / externalFilter
       *  trigger). */
      columns?: string[];
    }
  /** Cycle 7 / Task 9 — fired every time a filter popup mounts. The
   *  payload is the colId whose popup is opening; an app can watch
   *  this to drive analytics or a sibling UI panel. Fires AFTER the
   *  popup DOM is in the document. */
  | { type: 'filterOpened'; colId: string }
  /** Cycle 7 / Task 9 — fired on every popup-internal mutation BEFORE
   *  Apply commits. Apps use this to power "filter dirty" indicators
   *  without polling the popup's UI state. */
  | { type: 'filterModified'; colId: string }
  | {
      type: 'columnResized';
      colId: string;
      width: number;
      /** False during a drag-resize tick. True on mouseup AND on every
       *  imperative width mutation (including `setColumnWidths` —
       *  Cycle 6 / Task 5, `sizeColumnsToFit` — Cycle 6 / Task 3, and
       *  `autoSizeColumns` — Cycle 6 / Task 4). Apps that persist on
       *  `finished: true` only fire one save per drag instead of one
       *  per pixel. */
      finished?: boolean;
      source?: 'columnState' | 'uiColumnResized' | 'api' | 'sizeColumnsToFit' | 'autosizeColumns';
    }
  /** Fires when one or more columns have changed visibility. `source`
   *  distinguishes a column-state restore (`'columnState'`) from a Task-5
   *  imperative `setColumnsVisible` call (`'api'`). Cycle 6 / Task 2
   *  (emit on `applyColumnState` / `resetColumnState`) + Task 5 (emit
   *  on `setColumnsVisible`). */
  | {
      type: 'columnVisible';
      visible: boolean;
      colIds: string[];
      source: 'columnState' | 'api';
    }
  /** Fires when one or more columns have changed pinning. `pinned: null`
   *  for unpinned columns. Cycle 6 / Task 2 (emit on `applyColumnState`
   *  / `resetColumnState`) + Task 5 (emit on `setColumnsPinned`). */
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
  /** Fires when the aggregation totals have been recomputed against a
   *  change the user can correlate to a cause. `source` tags the
   *  triggering action — data mutation (`rowDataChanged`), filter pipeline
   *  re-evaluation (`filterChanged`), runtime `aggFuncs` swap
   *  (`aggFuncChanged`), per-column `aggFunc` change
   *  (`columnAggFuncChanged`), or an explicit imperative trigger (`api`).
   *  Cosmetic re-renders that don't change the totals — scroll, sort,
   *  theme, column visibility / move / resize — do NOT fire this event;
   *  apps that need the on-every-paint signal listen to `viewportChanged`
   *  instead. `totals` is the per-column map keyed by `colId`. Cycle 14
   *  / Task 6. */
  | {
      type: 'aggregationChanged';
      totals: Record<string, unknown>;
      source: AggregationChangedSource;
    }
  | { type: 'columnGroupOpened'; groupId: string; open: boolean }
  /** Cycle 15 / Task 7 — a single row-group's expanded state changed.
   *  `key` is the composite group key (`${col}:${value}` per level,
   *  joined by `::`); `expanded` is the new state. `source` tags the
   *  trigger — `'ui'` for a chevron click, `'api'` for an imperative
   *  `setExpanded(key, expanded)` call. The bulk `expandAll()` /
   *  `collapseAll()` API does NOT fan out per-group events; listen
   *  for `expandOrCollapseAll` for those. */
  | {
      type: 'rowGroupOpened';
      key: string;
      expanded: boolean;
      source: 'ui' | 'api';
    }
  /** Cycle 15 / Task 7 — fires after `expandAll()` / `collapseAll()`
   *  fans out the state. `expanded` is the target state every group
   *  was set to. */
  | { type: 'expandOrCollapseAll'; expanded: boolean }
  /** Cycle 15.5 / Task 2 — fires whenever the `rowGroupColumns` list
   *  or per-level sort entries mutate via the primitive API
   *  (`setRowGroupColumns` / `addRowGroupColumn` /
   *  `removeRowGroupColumn` / `moveRowGroupColumn` /
   *  `setRowGroupColumnSort`). Carries the full ordered list AND the
   *  verb that drove the change so subscribers (the columns tool
   *  panel's Row Groups drop zone, the header context menu's
   *  Group / Un-Group items, app-side analytics) can re-render or log
   *  without having to diff a snapshot against their own last-known
   *  copy. `source` mirrors the GroupingState verbs: `'set'` for the
   *  whole-list replace, `'add'` / `'remove'` / `'move'` for the
   *  single-column verbs, `'sort'` when only the per-level sort
   *  decoration changed (the ordered list didn't move). */
  | {
      type: 'columnRowGroupChanged';
      columns: string[];
      source: 'set' | 'add' | 'remove' | 'move' | 'sort' | 'restore';
    }
  /** Cycle 18 / Task 5 — fired whenever PivotState mutates: pivotMode flip,
   *  pivot/value column add/remove/move, value aggFunc change, or a
   *  `restore()` round-trip. Carries fresh snapshots so subscribers can
   *  diff against their last-known copy. The columns tool panel + pivot
   *  panel + context menu items all subscribe to keep the three views over
   *  PivotState in sync (the same "many views over one model" invariant
   *  GroupingState + `columnRowGroupChanged` already enforces for grouping). */
  | {
      type: 'pivotStateChanged';
      pivotMode: boolean;
      pivotColumns: string[];
      valueColumns: Array<{ colId: string; aggFunc: string }>;
      source: 'mode' | 'set' | 'add' | 'remove' | 'move' | 'aggFunc' | 'restore';
    }
  /** Cycle 18 / Task 8a — fires when a worker chunk reports that the
   *  pivot pass would have synthesized more than `pivotMaxGeneratedColumns`.
   *  The pivot output is empty on that chunk (primary columns render
   *  normally — no half-shaped matrix). Apps listen to raise the cap,
   *  narrow the filter, or show a banner. Mirrors AG-Grid's
   *  `pivotMaxColumnsReached`. The two-field payload is what AG-Grid
   *  carries verbatim. */
  | {
      type: 'pivotMaxColumnsReached';
      generatedColumns: number;
      cap: number;
    }
  /** Fires when the set / order of displayed columns changes for any reason.
   *  Cycle 4 wired the original `columnGroupOpened` + `columnDefsChanged`
   *  sources; Cycle 6 / Task 8 widens the source union so listeners can
   *  correlate this event with the specific column-mutation that drove it. */
  | {
      type: 'displayedColumnsChanged';
      source:
        | 'columnGroupOpened'
        | 'columnDefsChanged'
        | 'columnVisible'
        | 'columnPinned'
        | 'columnMoved'
        | 'columnsReset';
    }
  /** Fires when the slice of columns materialised by horizontal virtualisation
   *  changes — typically because the user scrolled horizontally and an
   *  off-screen column slid into the body (or vice versa). Distinct from
   *  `displayedColumnsChanged`, which fires when the SET of visible columns
   *  changes (hide/pin/move/reset). `afterScroll: true` for scroll-driven
   *  triggers; `false` for resize, layout, and column-mutation triggers that
   *  also happen to shift the materialised range. Cycle 6 / Task 8. */
  | { type: 'virtualColumnsChanged'; afterScroll: boolean }
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
  | { type: 'firstDataRendered' }
  /** Cycle 9 / Task 7 — fires on every cell-range mutation: drag start,
   *  drag mid-tick, drag end, and programmatic mutation. The split
   *  between `started` / `finished` mirrors ag-grid so apps can branch
   *  on the gesture phase. `ranges` is a fresh snapshot (mutating it
   *  doesn't affect selection state). For the debounced sibling that
   *  only fires once per real change, listen for `cellSelectionChanged`
   *  instead. */
  | {
      type: 'rangeSelectionChanged';
      ranges: SelectionRange[];
      /** True for the initial mousedown that begins a drag, OR for a
       *  single-step programmatic / modifier-click mutation that both
       *  starts and finishes in the same instant. */
      started: boolean;
      /** True for the mouseup that finalizes a drag, OR for every
       *  programmatic mutation (each instantaneous change is finished
       *  by definition). False during the drag-in-progress ticks. */
      finished: boolean;
    }
  /** Cycle 9 / Task 7 — debounced sibling of `rangeSelectionChanged`.
   *  Fires only when a `finished: true` mutation actually changes the
   *  set of ranges (drag mid-ticks are skipped; a finished mutation
   *  that lands on the same ranges as before is also skipped). Useful
   *  for "save selection state on change" without firing 30 times per
   *  drag. */
  | { type: 'cellSelectionChanged'; ranges: SelectionRange[] }
  /** Cycle 11 / Task 7 — fires every time a tool panel opens or closes.
   *  Hiding the WHOLE side bar via `setSideBarVisible(false)` does NOT
   *  fire this — the panel state stays intact behind the hidden bar; use
   *  `sideBarVisibleChanged` for that. Switching panels emits TWO events
   *  in close→open order, both with the same `source` (e.g. clicking a
   *  different tab while one is open produces a `visible: false` for the
   *  old panel + `visible: true` for the new, both tagged
   *  `'sideBarButtonClicked'`).
   *
   *  `source` values:
   *  - `'api'` — programmatic `openToolPanel` / `closeToolPanel` calls.
   *  - `'sideBarButtonClicked'` — user clicked a tab button.
   *  - `'sideBarInitializing'` — mount-time auto-open driven by
   *    `SideBarDef.defaultToolPanel`. Fires at most once per grid
   *    construction (never when no `defaultToolPanel` is set or the bar
   *    started under `hiddenByDefault: true`). */
  | {
      type: 'toolPanelVisibleChanged';
      key: string | null;
      visible: boolean;
      source: 'api' | 'sideBarButtonClicked' | 'sideBarInitializing';
    }
  /** Cycle 11 / Task 7 — fires when the WHOLE side bar shows or hides
   *  (i.e. `display: none` flips). Setting visibility to the current
   *  state is a no-op and does not emit. `source` is `'api'` for
   *  `setSideBarVisible` calls; `'sideBarButtonClicked'` is reserved
   *  for a future toggle button on the tab strip — Cycle 11 ships only
   *  the API path. */
  | {
      type: 'sideBarVisibleChanged';
      visible: boolean;
      source: 'api' | 'sideBarButtonClicked';
    };
