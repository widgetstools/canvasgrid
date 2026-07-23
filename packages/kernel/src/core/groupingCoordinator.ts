// Cycle 19 / Task 5-Grouping — owns the row-grouping subsystem extracted
// from CGrid: the canonical `GroupModel` (rowGroupCols) held on the main
// thread and shipped to the worker via `setWorkerGroupModel`, the
// canonical `GroupingState` primitive the three grouping UIs (row group
// panel, columns tool panel Row Groups drop zone, header context menu
// Group / Un-Group items) mutate + subscribe to, the synthesized
// `autoGroupColumns` inserted at the left of the visible band under the
// `'singleColumn'` / `'multipleColumns'` display types, and the
// `groupRowStripCtx` the body painter reads to allocate a full-row
// strip under `'groupRows'` / `'custom'` mode.
//
// CGrid is the thin consumer:
//   • Public grouping API (`setGroupModel` / `setRowGroupColumns` /
//     `addRowGroupColumn` / `removeRowGroupColumn` / `moveRowGroupColumn`
//     / `setRowGroupColumnSort` / `getRowGroupColumns`) delegates to
//     `grouping.*`.
//   • `computeVisibleColumnOrder` prepends `grouping.getAutoGroupColumns()`
//     to the visible-leaf list when grouping is active.
//   • The body painter reads `grouping.getGroupRowStripCtx()` every
//     frame to detect group rows in the `groupRows` / `custom` modes.
//   • Persistence surfaces (`getColumnState`, `getState`) read
//     `grouping.getRowGroupColumns()`.
//
// The seam is FAT by necessity: `setGroupModel` orchestrates the worker
// column re-sync, the worker `setGroupModel` round-trip, the auto-group
// column tree rebuild, the expansion mirror reset, the descendants cache
// update, and the auto-hide-on-group / restore-on-ungroup pass — every
// touch routed through explicit deps callbacks so the coordinator stays
// unaware of CGrid's private fields.
//
// The AG-v36 pivot-mode invariant (Task 5b, PR #81) is preserved
// verbatim: the auto-show-on-ungroup branch is gated by
// `deps.isPivotMode()` so removing a `rowGroup` role can't fight the
// primary auto-hide the pivot engine drives.

import type { TypedEventEmitter } from './eventEmitter';
import type { ColumnTree } from './columnTree';
import type { ResolvedColDef } from './propertyChain';
import type { ColumnLayout } from './layout';
import type { CGridEvent, CGridOptions, GroupModel, SortModel } from '../types';
import type { GroupCellValue } from '../renderer/cellRenderers/group';
import type { CColDef } from '../types';
import {
  GroupingState,
  type GroupingStateChangedEvent,
  type GroupingSortEntry,
} from './groupingState';
import { resolveColumnWidths } from './layout';
import { resolveGroupDisplayType, synthesizeAutoGroupColumns } from './autoGroupColumn';

/** Subset of `CGridOptions` the coordinator reads. Passed through a
 *  closure so per-tick `setGridOption` flips light up on the next
 *  `setGroupModel` / `rebuildAutoGroupColumn` call without re-wiring the
 *  coordinator. */
export interface GroupingCoordinatorOptions {
  suppressGroupChangesColumnVisibility?:
    | boolean
    | 'suppressHideOnGroup'
    | 'suppressShowOnUngroup';
  groupDisplayType?: CGridOptions<unknown>['groupDisplayType'];
  autoGroupColumnDef?: CGridOptions<unknown>['autoGroupColumnDef'];
  groupRowRenderer?: CGridOptions<unknown>['groupRowRenderer'];
}

/** Row group panel host surface consumed on grouping-state changes.
 *  `null` when the row group panel wasn't mounted
 *  (`rowGroupPanelShow: 'never'` / absent). */
export interface RowGroupPanelHostSurface {
  setRowGroupCols(cols: string[]): void;
  setGroupingState(
    cols: string[],
    perLevelSort: Array<GroupingSortEntry | null>,
  ): void;
}

/** Reply shape returned by the worker for `setGroupModel`. Same as the
 *  `WorkerCoordinator.setGroupModel` return so no shape conversion is
 *  required at the deps boundary. */
export interface SetGroupModelReply {
  visibleCount: number;
  groupKeys: string[];
  groupDescendants: string[][];
  expandedKeys: string[] | null;
}

/** Deps interface: every access the coordinator needs into CGrid state,
 *  worker plumbing, layout / repaint pipeline, and expansion / descendants
 *  cache. Intentionally fat — `setGroupModel` orchestrates every rendering-
 *  state field the model swap touches, and routing each one through an
 *  explicit callback keeps the coordinator unaware of CGrid's private
 *  fields. */
export interface GroupingCoordinatorDeps<TRow> {
  events: TypedEventEmitter<CGridEvent>;
  isDestroyed(): boolean;
  getOptions(): GroupingCoordinatorOptions;

  // ── worker round-trip ────────────────────────────────────────────────
  /** Fresh workerColumns snapshot. CGrid owns the derivation; coordinator
   *  ships it. Called BEFORE `setWorkerGroupModel` so the pivot-mode role
   *  filter (which may have hidden the newly-grouped colId) doesn't leave
   *  the worker's GroupPass with an "unknown column id" reject. */
  workerColumns(): unknown[];
  updateWorkerColumns(cols: unknown[]): Promise<unknown>;
  setWorkerGroupModel(g: GroupModel): Promise<SetGroupModelReply>;

  // ── row group panel host bridge ──────────────────────────────────────
  /** Fresh reference each call so runtime `setGridOption('rowGroupPanelShow', …)`
   *  mounts / unmounts land without re-wiring the coordinator. `null` = no host. */
  getRowGroupPanel(): RowGroupPanelHostSurface | null;

  // ── column tree / defs map access ────────────────────────────────────
  getColumnTree(): ColumnTree;
  getColumnDefsMap(): Map<string, ResolvedColDef<TRow>>;

  // ── layout + repaint pipeline ────────────────────────────────────────
  computeVisibleColumnOrder(): ResolvedColDef<TRow>[];
  setColumnOrder(order: ResolvedColDef<TRow>[]): void;
  /** Width available for column layout; falls back to scroller
   *  clientWidth or a hardcoded default upstream. */
  getLayoutWidth(): number;
  setColumnLayout(layout: ColumnLayout[]): void;
  recomputeViewport(): void;
  requestRepaint(): void;
  requestViewport(): void;

  // ── setGroupModel reply landing ──────────────────────────────────────
  /** Reset expansion mirror to the default-all sentinel (`null`) BEFORE
   *  the worker round-trip so `getExpandedKeys()` derives from the
   *  refreshed `knownGroupKeys` while the reply is in flight. The reply
   *  handler below overrides it with the explicit set when the worker
   *  materialised one from `groupDefaultExpanded[Keys]`. */
  setExpandedKeys(keys: Set<string> | null): void;
  /** Snapshot of the current expansion mirror before a same-model
   *  `setGroupModel` re-ship (late columnDefs / persist restore). `null`
   *  means the default-all sentinel; a Set is the explicit open set. */
  getExpandedKeysMirror(): Set<string> | null;
  /** After a successful `setGroupModel`, apply any pending
   *  `expandedRouteIds` from `setState` / persist restore. Returns true
   *  when pending keys were consumed (caller should skip seeding worker
   *  defaults). */
  flushPendingExpandedRoutes(): boolean;
  /** True while a restore still has stashed expand/collapse keys. */
  hasPendingExpandedRoutes(): boolean;
  /** Ship an explicit expanded-key set to the worker after preserving
   *  expansion across a same-model re-ship (worker `setGroupModel`
   *  resets to defaults on its side). */
  shipExpandedKeys(keys: string[]): void;
  setKnownGroupKeys(keys: string[]): void;
  updateGroupDescendantsCache(
    keys: readonly string[],
    descendants: readonly (readonly string[])[] | undefined,
  ): void;
  setRowCount(count: number): void;
  /** Nullify the cached row-height index so the next paint re-measures
   *  under the new group tree (variable row heights track per-row kind). */
  invalidateRowHeightIndex(): void;

  // ── group-row strip lookup (for `groupRows` / `custom` modes) ────────
  /** Resolve a row index to its `GroupCellValue` when the row is a group
   *  row; `null` on a data row. Closes over CGrid's chunk + viewport
   *  state so the coordinator doesn't need to. */
  groupCellContextAt(rowIndex: number): GroupCellValue | null;

  // ── auto-hide-on-group / restore-on-ungroup ──────────────────────────
  /** Same signature as the public API — the coordinator calls this on
   *  `setGroupModel` to hide newly-grouped columns and restore ungrouped
   *  ones. Routing through CGrid reuses the `columnVisible` event +
   *  worker `updateColumns` roundtrip, keeping downstream consumers
   *  (columns panel, status bar) in sync via a single seam. */
  setColumnsVisible(colIds: string[], visible: boolean): void;
  /** True while the pivot engine has flipped `pivotMode` ON. Under pivot
   *  mode every primary is auto-hidden by the pivot engine (Task 5b);
   *  the auto-show-on-ungroup branch must NOT fight that hide. Gates
   *  the show path only — hide still fires on entry so a
   *  `setGroupModel` before pivot ever flipped ON still lands the
   *  grouped-col hide.  */
  isPivotMode(): boolean;

  // ── sort merge on `source: 'sort'` state change ──────────────────────
  getSortModel(): SortModel;
  setSortModel(model: SortModel): void;
}

/** Group-row strip context. Populated when `groupDisplayType` resolves to
 *  `'groupRows'` / `'custom'`; `null` otherwise. The body painter reads
 *  this every frame to detect group rows + paint full-row strips
 *  spanning every column band. */
export interface GroupRowStripCtx {
  renderer: string;
  lookup: (rowIndex: number) => GroupCellValue | null;
}

export class GroupingCoordinator<TRow = unknown> {
  /** Cycle 15 / Task 4 — current row-group model. Drives auto-group
   *  column insertion (this task) + worker `setGroupModel` dispatch
   *  (Task 1). The empty model bypasses every group-aware pass cleanly. */
  private groupModel: GroupModel = { rowGroupCols: [] };

  /** Cycle 15.5 / Task 1 — the canonical mutable grouping state shared
   *  by the three grouping UIs (row group panel, columns tool panel
   *  Row Groups drop zone, header context menu Group / Un-Group items).
   *  Constructed at init with the initial `rowGroupCols`; mutations
   *  route through the primitives below and land model swaps on the
   *  worker via `handleStateChanged`. */
  private readonly state: GroupingState;
  private readonly unsubscribe: () => void;

  /** Cycle 15 / Task 4 + Task 5 — synthesized auto-group column(s).
   *  Length depends on `groupDisplayType`:
   *    - `'singleColumn'` + grouping active → one column.
   *    - `'multipleColumns'` + grouping active → one per `rowGroupCols`.
   *    - `'groupRows'` / `'custom'` / no grouping → empty.
   *  CGrid's `computeVisibleColumnOrder` prepends this list to the
   *  visible leaves; the coordinator's `rebuildAutoGroupColumn`
   *  refreshes it on every `setGroupModel` call. */
  private autoGroupColumns: ResolvedColDef<TRow>[] = [];

  /** Cycle 15 / Task 5 — non-null when `groupDisplayType` resolves to
   *  `'groupRows'` or `'custom'`. The body painter reads this every
   *  frame to detect group rows + paint full-row strips spanning the
   *  canvas's whole width. */
  private groupRowStripCtx: GroupRowStripCtx | null = null;

  constructor(
    private readonly deps: GroupingCoordinatorDeps<TRow>,
    init: { rowGroupCols: string[] },
  ) {
    this.groupModel = { rowGroupCols: [...init.rowGroupCols] };
    this.state = new GroupingState({
      rowGroupColumns: init.rowGroupCols,
    });
    this.unsubscribe = this.state.on(
      'groupingStateChanged',
      (e) => this.handleStateChanged(e),
    );
  }

  // ── Public read surface ───────────────────────────────────────────────────

  /** The current group model. Callers must NOT mutate the returned
   *  object — mutations must route through `setGroupModel`. */
  getGroupModel(): GroupModel { return this.groupModel; }
  /** The canonical `GroupingState` primitive. Exposed so panels + the
   *  header context menu can subscribe to `groupingStateChanged`
   *  directly and read per-level sort state. */
  getGroupingState(): GroupingState { return this.state; }
  /** Row-group column list snapshot in nesting order. */
  getRowGroupColumns(): string[] { return this.state.getRowGroupColumns(); }
  /** Auto-group column(s) synthesized from the current group model.
   *  Empty when grouping bypasses OR when `groupDisplayType` resolves to
   *  `'groupRows'` / `'custom'`. */
  getAutoGroupColumns(): ReadonlyArray<ResolvedColDef<TRow>> {
    return this.autoGroupColumns;
  }
  /** Group-row strip context. `null` outside `'groupRows'` / `'custom'`
   *  modes; non-null when the body painter should allocate full-row
   *  strips for group rows. */
  getGroupRowStripCtx(): GroupRowStripCtx | null { return this.groupRowStripCtx; }

  // ── Public mutation surface ───────────────────────────────────────────────

  /** Cycle 15 — set the row-group model. Stored on the main thread,
   *  forwarded to the worker (Task 1 wired the dispatch), and used by
   *  Task 4's column-order resolution to insert the auto-group column
   *  when grouping is active. An empty `rowGroupCols` array clears the
   *  auto-group column and bypasses the worker's group passes.
   *
   *  Also syncs the row group panel's chip strip so a programmatic
   *  `setGroupModel` call from app code flows into the visible chips. */
  setGroupModel(g: GroupModel): void {
    if (this.deps.isDestroyed()) return;
    // Compute visibility diff BEFORE mutating groupModel so we know which
    // columns were newly added to groups (should be hidden from the grid)
    // and which were removed (should be restored to visible).
    const prevSet = new Set(this.groupModel.rowGroupCols);
    const nextSet = new Set(g.rowGroupCols);
    const toHide = g.rowGroupCols.filter((id) => !prevSet.has(id));
    const toShow = this.groupModel.rowGroupCols.filter((id) => !nextSet.has(id));
    const sameOrder = toHide.length === 0 && toShow.length === 0
      && this.groupModel.rowGroupCols.length === g.rowGroupCols.length
      && this.groupModel.rowGroupCols.every((c, i) => c === g.rowGroupCols[i]);
    // Same-model re-ship (persist restore after late columnDefs) must keep
    // the user's expand/collapse set — worker `setGroupModel` resets to
    // defaults on its side, so we snapshot and re-apply after the reply.
    const preservedExpansion = sameOrder ? this.deps.getExpandedKeysMirror() : null;
    this.groupModel = { rowGroupCols: [...g.rowGroupCols] };
    this.rebuildAutoGroupColumn();
    // Cycle 15.5 / Task 1 — sync the GroupingState primitive so any
    // subscribed view (panel, tool-panel zone, context menu)
    // re-renders. The handler short-circuits the round-trip back
    // through `setGroupModel` (sameOrder === true) so the call is
    // free of recursive worker dispatch.
    this.state.setRowGroupColumns(this.groupModel.rowGroupCols);
    this.deps.getRowGroupPanel()?.setRowGroupCols(this.groupModel.rowGroupCols);
    // Cycle 15 / Task 7 — fresh model resets expansion to the
    // default-all sentinel; the worker does the same on its side. The
    // reply ships back the full key list so the mirror can serve
    // `getExpandedKeys()` snapshots without a follow-up round-trip.
    //
    // Cycle 15 / Task 9 — the reply ALSO carries the materialised
    // `expandedKeys` set when `groupDefaultExpanded` /
    // `groupDefaultExpandedKeys` is configured. Until the reply
    // lands the mirror sits at the default-all sentinel (consistent
    // with the worker's intermediate state before defaults are
    // applied); the reply handler below overrides it with the
    // explicit set when present.
    //
    // Same-order re-ships skip the wipe so a live collapse set isn't
    // clobbered. A pending persist restore also skips the wipe — the
    // reply path will flush `expandedRouteIds` instead of seeding
    // groupDefaultExpanded.
    if (!sameOrder && !this.deps.hasPendingExpandedRoutes()) {
      this.deps.setExpandedKeys(null);
    }
    // Sync the worker's column metadata BEFORE pushing the new
    // group model. The pivot-mode role filter on `computeVisibleColumnOrder`
    // (and the auto-hide on grouped columns) may have pushed the
    // newly-grouped colId out of `columnOrder` since the last
    // `updateColumns`; without re-syncing, the worker's GroupPass
    // rejects an "unknown column id" and the body collapses to
    // empty-group-key data rows.
    this.deps.updateWorkerColumns(this.deps.workerColumns())
      .then(() => this.deps.setWorkerGroupModel(this.groupModel))
      .then((reply) => {
        if (this.deps.isDestroyed()) return;
        const { visibleCount, groupKeys, groupDescendants, expandedKeys } = reply;
        this.deps.setKnownGroupKeys(groupKeys);
        this.deps.updateGroupDescendantsCache(groupKeys, groupDescendants);
        // Persist / setState may have stashed `expandedRouteIds` before
        // the worker group model landed. Prefer that over defaults —
        // and never fall through to groupDefaultExpanded while a
        // restore is still pending (that produced "all open" ghosts).
        if (this.deps.flushPendingExpandedRoutes()) {
          // pending restore applied (ships to worker itself)
        } else if (this.deps.hasPendingExpandedRoutes()) {
          // Still waiting (e.g. grouping cols not live yet) — leave
          // the mirror alone; a later successful setGroupModel retries.
        } else if (sameOrder && preservedExpansion !== null) {
          this.deps.setExpandedKeys(preservedExpansion);
          this.deps.shipExpandedKeys(Array.from(preservedExpansion));
        } else if (sameOrder && preservedExpansion === null) {
          // Was default-all — keep sentinel; worker already seeded defaults.
          this.deps.setExpandedKeys(null);
        } else {
          // Cycle 15 / Task 9 — re-seed the mirror from the worker's
          // materialised default. `null` keeps the all-expanded sentinel
          // (`getExpandedKeys()` derives from `knownGroupKeys`); a
          // non-null array installs the explicit starting set.
          this.deps.setExpandedKeys(expandedKeys === null ? null : new Set(expandedKeys));
        }
        this.deps.setRowCount(visibleCount);
        this.deps.invalidateRowHeightIndex();
        this.deps.recomputeViewport();
        this.deps.requestRepaint();
        this.deps.requestViewport();
      }).catch((err) => {
        if (!this.deps.isDestroyed()) console.error('[cgrid]', err);
      });
    // Hide columns that are now acting as group levels; restore visibility
    // for columns removed from grouping. Mirrors ag-grid's default behaviour
    // so grouped fields don't appear redundantly as standalone grid columns.
    // Cycle 15.5 / Task 7 — `suppressGroupChangesColumnVisibility` gates this:
    //   true / 'suppressHideOnGroup'+'suppressShowOnUngroup' → skip both.
    //   'suppressHideOnGroup' → skip hide only; allow show on ungroup.
    //   'suppressShowOnUngroup' → skip show only; allow hide on group.
    // Cycle 19 / Task 5b — under pivot mode ALL primaries are auto-hidden
    // by `PivotEngine`; ungrouping a col must NOT clobber that hide,
    // regardless of `suppressGroupChangesColumnVisibility`. The hide
    // branch is still meaningful (it turns a not-yet-hidden col into
    // a hidden one on the entry path, e.g. `setGroupModel` before
    // pivot mode ever flipped ON).
    const suppressVis = this.deps.getOptions().suppressGroupChangesColumnVisibility;
    const suppressHide = suppressVis === true || suppressVis === 'suppressHideOnGroup';
    const suppressShow = suppressVis === true || suppressVis === 'suppressShowOnUngroup'
      || this.deps.isPivotMode();
    if (toHide.length > 0 && !suppressHide) this.deps.setColumnsVisible(toHide, false);
    if (toShow.length > 0 && !suppressShow) this.deps.setColumnsVisible(toShow, true);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: replace the
   *  entire ordered row-group column list. Routes through the
   *  GroupingState primitive; the `groupingStateChanged` handler ships
   *  the new model to the worker. */
  setRowGroupColumns(columns: string[]): void {
    if (this.deps.isDestroyed()) return;
    this.state.setRowGroupColumns(columns);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: append `colId`
   *  to the row-group column list. */
  addRowGroupColumn(colId: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.addRowGroupColumn(colId);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: remove `colId`
   *  from the row-group column list. */
  removeRowGroupColumn(colId: string): void {
    if (this.deps.isDestroyed()) return;
    this.state.removeRowGroupColumn(colId);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: move the column
   *  at index `from` to index `to`. */
  moveRowGroupColumn(from: number, to: number): void {
    if (this.deps.isDestroyed()) return;
    this.state.moveRowGroupColumn(from, to);
  }

  /** Cycle 15.5 / Task 1 — primitive grouping mutation: set the
   *  per-level sort for the row-group level holding `colId`. */
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void {
    if (this.deps.isDestroyed()) return;
    this.state.setRowGroupColumnSort(colId, direction);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.unsubscribe();
    this.state.destroy();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Cycle 15.5 / Task 1 — `groupingStateChanged` handler. When the
   *  ordered column list changes (`source: 'set' | 'add' | 'remove' |
   *  'move'`), ship a `setGroupModel` round-trip to the worker so the
   *  visible chunk reflects the new grouping.
   *
   *  Cycle 15.5 / Task 9 gap-fill — a pure sort change (`source: 'sort'`)
   *  now drives a real re-order: the per-level group sort is translated
   *  into the worker sort model, and `SortPass.applyGrouped` re-sorts each
   *  group level by the sort entry targeting that level's grouping column.
   *  Both entry points (the public `setRowGroupColumnSort` API and the
   *  row group panel pill chevron) funnel through here, so both re-order.
   *
   *  The panel host re-renders via `setGroupingState` so the updated chip
   *  + indicator paint immediately. */
  private handleStateChanged(e: GroupingStateChangedEvent): void {
    if (this.deps.isDestroyed()) return;
    this.deps.getRowGroupPanel()?.setGroupingState(e.rowGroupColumns, e.perLevelSort);
    if (e.source === 'sort') {
      // Translate the per-level group sort into the worker sort model.
      // Rebuild the group-column entries from `perLevelSort` (in nesting
      // order so the outer level sorts first), preserving any leaf-column
      // sort entries already present in the model.
      const groupColSet = new Set(e.rowGroupColumns);
      const nonGroupSort = this.deps.getSortModel().filter((s) => !groupColSet.has(s.colId));
      const groupSort: SortModel = [];
      e.rowGroupColumns.forEach((colId, i) => {
        const entry = e.perLevelSort[i];
        if (entry) groupSort.push({ colId, direction: entry.direction });
      });
      this.deps.setSortModel([...groupSort, ...nonGroupSort]);
    } else {
      const sameOrder = this.groupModel.rowGroupCols.length === e.rowGroupColumns.length
        && this.groupModel.rowGroupCols.every((c, i) => c === e.rowGroupColumns[i]);
      if (!sameOrder) {
        this.setGroupModel({ rowGroupCols: [...e.rowGroupColumns] });
      }
    }
    // Cycle 15.5 / Task 2 — fan the change out as a public event so
    // the columns tool panel's Row Groups drop zone (and any other
    // subscriber) re-renders. The event carries the same source verb
    // GroupingState emitted so subscribers can branch (e.g. ignore
    // pure sort decoration when they only mirror membership).
    this.deps.events.emit({
      type: 'columnRowGroupChanged',
      columns: [...e.rowGroupColumns],
      source: e.source,
    });
  }

  /** Cycle 15 / Task 4 + Task 5 — re-resolve `autoGroupColumns` against
   *  the current `groupModel` + grid options. The set of synthesized
   *  columns depends on the resolved `groupDisplayType`:
   *    - `'singleColumn'` (default) → 1 column at index 0 IF grouping
   *      is active.
   *    - `'multipleColumns'` → N columns (one per `rowGroupCols[i]`) at
   *      indices 0..N-1, each carrying `cellRendererParams.groupColumnDepth`
   *      so the `'group'` renderer's own-depth filter activates.
   *    - `'groupRows'` / `'custom'` → no columns; the body painter
   *      renders group rows as a full-row strip via `groupRowStripCtx`.
   *
   *  Also stamps `groupRowStripCtx` for the strip modes, or clears it
   *  for the column modes. Called by `setGroupModel`. Mirrors the
   *  synthesized defs into `deps.getColumnDefsMap()` so the painter's
   *  per-cell lookup resolves the synthesized columns identically to
   *  any other leaf; `columnTree.leafById` doesn't carry synthesized
   *  entries. */
  private rebuildAutoGroupColumn(): void {
    const opts = this.deps.getOptions();
    const displayType = resolveGroupDisplayType(opts.groupDisplayType);
    const columnDefsMap = this.deps.getColumnDefsMap();
    // Drop any previously-synthesized auto-group columns from the
    // columnDefsMap before re-synthesizing — switching display types
    // (e.g. singleColumn → multipleColumns) renames the columns and
    // leaves stale entries that would shadow the new ones at lookup.
    for (const col of this.autoGroupColumns) {
      columnDefsMap.delete(col.colId);
    }
    const columnTree = this.deps.getColumnTree();
    const synth = synthesizeAutoGroupColumns<TRow>({
      groupModel: this.groupModel,
      groupDisplayType: displayType,
      override: opts.autoGroupColumnDef as Partial<CColDef<TRow>> | undefined,
      headerNames: this.groupModel.rowGroupCols.map((colId) =>
        columnTree.leafById.get(colId)?.headerName),
      // AG parity 2026-07-21 — underlying grouped column facts for the
      // `filter: 'agGroupColumnFilter'` redirect.
      sourceColumns: this.groupModel.rowGroupCols.map((colId) => {
        const leaf = columnTree.leafById.get(colId);
        return leaf
          ? { field: leaf.field as string | undefined, filter: leaf.filter as string | undefined }
          : undefined;
      }),
    });
    this.autoGroupColumns = synth.columns;
    // Mirror the synthesized defs into `columnDefsMap` so the painter's
    // per-cell lookup resolves the synthesized columns identically to
    // any other leaf. `columnTree.leafById` doesn't carry synthesized
    // entries; we maintain them here for the lifetime of the active
    // group model.
    for (const col of this.autoGroupColumns) {
      columnDefsMap.set(col.colId, col);
    }
    // Cycle 15 / Task 5 — wire the full-row strip lookup for
    // `'groupRows'` / `'custom'` modes. The `'group'` renderer is the
    // default strip painter; apps swap it via
    // `CGridOptions.groupRowRenderer` (e.g. for `'custom'`).
    if (synth.fullRowStrip) {
      const renderer = opts.groupRowRenderer ?? 'group';
      this.groupRowStripCtx = {
        renderer,
        lookup: (rowIndex) => this.deps.groupCellContextAt(rowIndex),
      };
    } else {
      this.groupRowStripCtx = null;
    }
    // Re-resolve the visible-leaf order so the next paint reflects the
    // (now updated) auto-group slot(s). Layout reflows in the same
    // turn so the new column(s) get a width before the next viewport
    // request fires.
    const order = this.deps.computeVisibleColumnOrder();
    this.deps.setColumnOrder(order);
    this.deps.setColumnLayout(resolveColumnWidths(order, this.deps.getLayoutWidth()));
    this.deps.recomputeViewport();
  }
}
