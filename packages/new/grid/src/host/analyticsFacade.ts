/**
 * Analytics facade — pivot, row grouping, value columns, and group expansion.
 *
 * Owns the pivot-mode toggle and pivot/value column APIs, the
 * {@link PivotEngine} and {@link GroupingCoordinator} `Deps` factories, the
 * expanded-key set (including the sparse-SSRM null-sentinel materialisation),
 * expand/collapse-all, the group-descendants cache backing
 * `groupSelectsChildren`, and the row-group column API. Extracted from
 * `velocityGrid.ts` as part of splitting the god object (SPEC.md §3 module
 * boundaries — Analytics).
 *
 * A re-seaming, not a redesign: the bodies are the legacy ones verbatim, so the
 * pivot primary-vs-display tree handling, the SSRM client-pipeline
 * enable/disable transitions around grouping changes, and the pending
 * expanded-route flush ordering are all preserved exactly.
 *
 * The seam is the fat {@link AnalyticsHost} interface — the same `Deps`
 * pattern the ported coordinators already use.
 */

import type {
  VelocityGridOptions,
  VelocityGridEvent,
  FilterModel,
  SortModel,
  GroupModel,
  CColumnState,
} from '../types';
import type { ResolvedColDef } from '../core/propertyChain';
import type { ColumnLayout } from '../core/layout';
import type { AggregationChangedSource } from '../types/event';
import type { WorkerColumn } from '../worker/protocol';
import type { TypedEventEmitter } from '../core/eventEmitter';
import type { ColumnTree } from '../core/columnTree';
import type { ColumnGroupState } from '../core/columnGroupState';
import type { RowHeightIndex } from '../core/rowHeightIndex';
import type { VelocityGridCanvas } from '../core/canvas';
import type { SelectionModel } from '../interaction/selectionModel';
import type { WorkerCoordinator } from '../core/workerCoordinator';
import type { ServerSideRowModelController } from '../core/serverSideRowModel';
import type { ServerSideRowModelV2Controller } from '../core/serverSideRowModelV2';
import { isAutoGroupColumnId } from '../core/autoGroupColumn';
import { parseCompositeGroupKey } from '../worker/interop/ssrmRowMeta';
import { isServerSideDatasourceV2 } from '../types/ssrm';
import { PivotEngine, type PivotEngineDeps, type PivotEngineOptions } from '../core/pivotEngine';
import { GroupingCoordinator, type GroupingCoordinatorDeps, type GroupingCoordinatorOptions } from '../core/groupingCoordinator';
import type { GroupCellValue } from '../renderer/cellRenderers/group';

/** Host seam for the pivot / grouping / expansion cluster. */
export interface AnalyticsHost<TRow = any> {
  readonly destroyed: boolean;
  options: VelocityGridOptions<TRow>;
  events: TypedEventEmitter<VelocityGridEvent<TRow>>;

  // ── collaborators this facade constructs Deps for and drives ─────────
  pivotEngine: PivotEngine<TRow>;
  grouping: GroupingCoordinator<TRow>;
  selection: SelectionModel;
  workerCoord: WorkerCoordinator;
  cgridCanvas: VelocityGridCanvas;
  scroller: HTMLDivElement;
  columnTree: ColumnTree;
  columnGroupState: ColumnGroupState;
  rowHeightIndex: RowHeightIndex | null;
  rowGroupPanel: any;
  pivotPanel: any;
  ssrmExpressionHost: any;

  // ── model state the cluster reads and mutates ────────────────────────
  columnOrder: ResolvedColDef<TRow>[];
  columnDefsMap: Map<string, ResolvedColDef<TRow>>;
  columnLayout: ColumnLayout[];
  colGroupPathCache: Map<string, string[]> | null;
  sortModel: SortModel;
  rowCount: number;
  canvasBounds: { width: number; height: number };
  expandedKeys: Set<string> | null;
  knownGroupKeys: string[];
  groupDescendantsByKey: Map<string, readonly string[]>;
  pendingExpandedRouteIds: string[] | null;

  // ── SSRM mode flags + the client-pipeline bridge transitions ─────────
  ssrm: ServerSideRowModelController<TRow> | ServerSideRowModelV2Controller<TRow> | null;
  ssrmV2: boolean;
  ssrmClientPipeline: boolean;
  enableSsrmClientPipeline(): Promise<void>;
  disableSsrmClientPipelineIfIdle(): Promise<void>;
  setWorkerGroupModelForSsrm(g: GroupModel): ReturnType<WorkerCoordinator['setGroupModel']>;

  // ── host services the cluster calls back into ────────────────────────
  getColumnState(): CColumnState[];
  setColumnsVisible(keys: string[], visible: boolean): void;
  setGroupModel(g: GroupModel): void;
  setSortModel(s: SortModel): void;
  setFilterModel(f: FilterModel): void;
  workerColumns(): WorkerColumn[];
  computeVisibleColumnOrder(): ResolvedColDef<TRow>[];
  subscribeColumnGroupState(): void;
  rebuildSubgridStack(): void;
  applyVerticalInsets(): void;
  recomputeViewport(afterScroll?: boolean): void;
  requestViewport(aggSource?: AggregationChangedSource | null): void;
  ensureRowIndexVisible(rowIndex: number, position?: 'auto' | 'top' | 'middle' | 'bottom'): void;
  groupCellContextAt(rowIndex: number): GroupCellValue | null;
}

export class AnalyticsFacade<TRow = any> {
  constructor(private readonly host: AnalyticsHost<TRow>) {}

  // ─── Cycle 18 / Task 3 — pivot API + render wiring ─────────────────────

  isPivotMode(): boolean { return this.host.pivotEngine.isPivotMode(); }
  setPivotMode(pivotMode: boolean, opts?: { discardSettings?: boolean }): void {
    if (this.host.destroyed) return;
    if (this.host.ssrm && pivotMode) {
      // Sparse Perspective SSRM cannot build a pivot matrix (no full hydrate
      // while grouped; sample forces client pipeline off). Fail closed so
      // the Columns panel doesn't show Pivot ON with an empty/wrong grid.
      const sparsePerspective = this.host.ssrmExpressionHost != null
        && this.host.options.serverSideEnableClientSidePipeline === false;
      if (sparsePerspective) {
        console.warn(
          '[velocity-grid] Pivot mode is not supported on sparse Perspective SSRM. '
          + 'Use clientSide, or set serverSideEnableClientSidePipeline: true (full hydrate).',
        );
        return;
      }
      void this.host.enableSsrmClientPipeline().then(() => {
        if (this.host.destroyed) return;
        if (!this.host.ssrmClientPipeline) {
          console.warn(
            '[velocity-grid] Pivot mode aborted — SSRM could not fully hydrate for the client pipeline.',
          );
          return;
        }
        this.applyPivotModeChange(true, opts);
      });
      return;
    }
    if (this.host.ssrm && !pivotMode) {
      void this.host.disableSsrmClientPipelineIfIdle();
    }
    this.applyPivotModeChange(pivotMode, opts);
  }

  /** Shared body of setPivotMode after SSRM hydrate gating. */
  applyPivotModeChange(
    pivotMode: boolean,
    opts?: { discardSettings?: boolean },
  ): void {
    // Cycle 21i / Phase 1 (user directive) — `discardSettings` (passed by
    // the Pivot Mode toggle in the columns tool panel, i.e. a user-driven
    // switch) gives a clean slate on the mode change so table-mode state
    // never leaks into pivot and vice versa. Programmatic setup
    // (`setPivotColumns(...); setPivotMode(true)`) omits it and keeps the
    // configured pivot. Clears the data-shaping config (row groups, pivot
    // + value roles, sort, filter); on → table every column becomes
    // visible with no grouping; on → pivot every role is cleared so the
    // tool panel reads "all deselected". Layout (widths/order/pinning) is
    // preserved.
    if (opts?.discardSettings && this.host.pivotEngine.isPivotMode() !== pivotMode) {
      this.setRowGroupColumns([]);
      this.setPivotColumns([]);
      for (const v of this.getValueColumns()) this.removeValueColumn(v.colId);
      this.host.setSortModel([]);
      this.host.setFilterModel({});
      if (!pivotMode) {
        const primaryIds = this.host.getColumnState()
          .map((c) => c.colId)
          .filter((id) => !isAutoGroupColumnId(id) && !id.startsWith('pivotcol'));
        this.host.setColumnsVisible(primaryIds, true);
      }
    }
    this.host.pivotEngine.setPivotMode(pivotMode);
  }
  getPivotColumns(): string[] { return this.host.pivotEngine.getPivotColumns(); }
  setPivotColumns(colIds: string[]): void {
    if (!this.host.destroyed) this.host.pivotEngine.setPivotColumns(colIds);
  }
  addPivotColumn(colId: string): void {
    if (!this.host.destroyed) this.host.pivotEngine.addPivotColumn(colId);
  }
  removePivotColumn(colId: string): void {
    if (!this.host.destroyed) this.host.pivotEngine.removePivotColumn(colId);
  }
  movePivotColumn(from: number, to: number): void {
    if (!this.host.destroyed) this.host.pivotEngine.movePivotColumn(from, to);
  }
  getValueColumns(): Array<{ colId: string; aggFunc: string }> {
    return this.host.pivotEngine.getValueColumnsApiShape();
  }
  addValueColumn(colId: string, aggFunc: string): void {
    if (!this.host.destroyed) this.host.pivotEngine.addValueColumn(colId, aggFunc);
  }
  removeValueColumn(colId: string): void {
    if (!this.host.destroyed) this.host.pivotEngine.removeValueColumn(colId);
  }
  /** Reorder a value column in-place — `from` and `to` are indices
   *  into the current `getValueColumns()` order. Drives the
   *  drag-to-reorder gesture inside the columns side-panel Values
   *  zone. */
  moveValueColumn(from: number, to: number): void {
    if (!this.host.destroyed) this.host.pivotEngine.moveValueColumn(from, to);
  }
  setValueColumnAggFunc(colId: string, aggFunc: string): void {
    if (!this.host.destroyed) this.host.pivotEngine.setValueColumnAggFunc(colId, aggFunc);
  }
  setValueColumns(list: Array<{ colId: string; aggFunc: string }>): void {
    if (!this.host.destroyed) this.host.pivotEngine.setValueColumns(list);
  }
  /** Synthesized pivot result column IDs — the cross-tabbed
   *  `pivot_<pivotKey>_<valueColId>` colIds the worker emits when
   *  pivot is active. Returns `[]` when pivot is inactive. Mirrors
   *  AG-Grid's `gridApi.getPivotResultColumns()`. */
  getPivotResultColumns(): string[] {
    return this.host.pivotEngine.getPivotResultColumns();
  }

  /** Cycle 19 / Task 5a — PivotEngine deps bundle. Threaded into the
   *  engine at construction so every reach into VelocityGrid state is
   *  explicit + auditable. The panel / worker fields are read at
   *  call-time closures — the engine is constructed BEFORE both
   *  come online, but mutation-driven callbacks only fire after the
   *  wiring lands. */
  makePivotEngineDeps(): PivotEngineDeps<TRow> {
    return {
      events: this.host.events,
      isDestroyed: () => this.host.destroyed,
      getOptions: (): PivotEngineOptions => ({
        pivotDefaultExpanded: this.host.options.pivotDefaultExpanded,
        pivotGrandTotals: this.host.options.pivotGrandTotals,
        pivotRowTotals: this.host.options.pivotRowTotals ?? null,
        pivotColumnGroupTotals: this.host.options.pivotColumnGroupTotals ?? null,
        processPivotResultColDef: this.host.options.processPivotResultColDef as
          PivotEngineOptions['processPivotResultColDef'],
        processPivotResultColGroupDef: this.host.options.processPivotResultColGroupDef as
          PivotEngineOptions['processPivotResultColGroupDef'],
      }),
      workerColumns: () => this.host.workerColumns(),
      updateWorkerColumns: (cols) =>
        this.host.workerCoord.updateColumns(cols as WorkerColumn[]),
      setWorkerPivotModel: (model) => this.host.workerCoord.setPivotModel(model),
      setWorkerPivotMaxGeneratedColumns: (cap) =>
        this.host.workerCoord.setPivotMaxGeneratedColumns(cap),
      setWorkerStrictPivotColumnOrder: (strict) =>
        this.host.workerCoord.setStrictPivotColumnOrder(strict),
      requestViewport: () => this.host.requestViewport(),
      getPivotPanel: () => this.host.pivotPanel,
      getColumnTree: () => this.host.columnTree,
      setColumnTree: (tree) => { this.host.columnTree = tree; this.host.colGroupPathCache = null; },
      getColumnGroupState: () => this.host.columnGroupState,
      setColumnGroupState: (state) => { this.host.columnGroupState = state; },
      getColumnDefsMap: () => this.host.columnDefsMap,
      setColumnDefsMap: (map) => { this.host.columnDefsMap = map; },
      getAutoGroupColumns: () => this.host.grouping.getAutoGroupColumns(),
      subscribeColumnGroupState: () => this.host.subscribeColumnGroupState(),
      computeVisibleColumnOrder: () => this.host.computeVisibleColumnOrder(),
      setColumnOrder: (order) => { this.host.columnOrder = order; },
      getLayoutWidth: () =>
        this.host.canvasBounds.width || this.host.scroller.clientWidth || 800,
      setColumnLayout: (layout) => { this.host.columnLayout = layout; },
      rebuildSubgridStack: () => this.host.rebuildSubgridStack(),
      recomputeViewport: () => this.host.recomputeViewport(),
      requestRepaint: () => { this.host.cgridCanvas?.requestRepaint(); },
      applyVerticalInsets: () => this.host.applyVerticalInsets(),
      // Task 5b — pivot mode toggle drives the primary auto-hide pass
      // through the same seam the panel + `applyColumnState` use.
      setColumnsVisible: (colIds, visible) => this.host.setColumnsVisible(colIds, visible),
    };
  }

  /** Cycle 19 / Task 5-Grouping — GroupingCoordinator deps bundle.
   *  Threaded into the coordinator at construction so every reach into
   *  VelocityGrid state is explicit + auditable. The panel field is read at
   *  call-time closure — the coordinator is constructed BEFORE the row
   *  group panel comes online, but state-change callbacks only fire
   *  after the wiring lands. */
  makeGroupingCoordinatorDeps(): GroupingCoordinatorDeps<TRow> {
    return {
      events: this.host.events,
      isDestroyed: () => this.host.destroyed,
      getOptions: (): GroupingCoordinatorOptions => ({
        suppressGroupChangesColumnVisibility: this.host.options.suppressGroupChangesColumnVisibility,
        groupDisplayType: this.host.options.groupDisplayType,
        autoGroupColumnDef: this.host.options.autoGroupColumnDef as
          GroupingCoordinatorOptions['autoGroupColumnDef'],
        groupRowRenderer: this.host.options.groupRowRenderer,
      }),
      workerColumns: () => this.host.workerColumns(),
      updateWorkerColumns: (cols) =>
        this.host.workerCoord.updateColumns(cols as WorkerColumn[]),
      setWorkerGroupModel: (g) => this.host.setWorkerGroupModelForSsrm(g),
      getRowGroupPanel: () => this.host.rowGroupPanel,
      getColumnTree: () => this.host.columnTree,
      getColumnDefsMap: () => this.host.columnDefsMap,
      computeVisibleColumnOrder: () => this.host.computeVisibleColumnOrder(),
      setColumnOrder: (order) => { this.host.columnOrder = order; },
      getLayoutWidth: () =>
        this.host.canvasBounds.width || this.host.scroller.clientWidth || 800,
      setColumnLayout: (layout) => { this.host.columnLayout = layout; },
      recomputeViewport: () => this.host.recomputeViewport(),
      requestRepaint: () => { this.host.cgridCanvas?.requestRepaint(); },
      requestViewport: () => this.host.requestViewport(),
      setExpandedKeys: (keys) => { this.host.expandedKeys = keys; },
      getExpandedKeysMirror: () => this.host.expandedKeys,
      flushPendingExpandedRoutes: () => this.flushPendingExpandedRoutes(),
      hasPendingExpandedRoutes: () => this.hasPendingExpandedRoutes(),
      shipExpandedKeys: (keys) => this.shipExpandedKeys(keys),
      setKnownGroupKeys: (keys) => { this.host.knownGroupKeys = keys; },
      updateGroupDescendantsCache: (keys, desc) =>
        this.updateGroupDescendantsCache(keys, desc),
      setRowCount: (n) => { this.host.rowCount = n; },
      invalidateRowHeightIndex: () => { this.host.rowHeightIndex = null; },
      groupCellContextAt: (rowIndex) => this.host.groupCellContextAt(rowIndex),
      setColumnsVisible: (colIds, visible) => this.host.setColumnsVisible(colIds, visible),
      isPivotMode: () => this.host.pivotEngine.isPivotMode(),
      getSortModel: () => this.host.sortModel,
      setSortModel: (model) => this.host.setSortModel(model),
    };
  }

  /** Cycle 15 / Task 7 — flip every group to expanded. Ships the
   *  "default = all" sentinel to the worker so the slicer derives
   *  the all-keys set itself; fires `expandOrCollapseAll` once with
   *  `expanded: true`. No-op when grouping bypasses
   *  (`rowGroupCols.length === 0`) — the event still fires so apps
   *  with a "toggle grouping" UX don't have to special-case the
   *  ungrouped grid. */
  /** Cycle 15.5 / Task 6 — scroll a row by zero-based display index into
   *  view. Wraps the private `ensureRowIndexVisible` so callers that know
   *  the index (e.g. keyboard nav code that already has the row index in
   *  front of it) don't need to round-trip to the worker for the ID. */
  ensureIndexVisible(
    index: number,
    position: 'auto' | 'top' | 'middle' | 'bottom' = 'auto',
  ): void {
    if (this.host.destroyed) return;
    this.host.ensureRowIndexVisible(index, position);
  }

  /** Cycle 15.5 / Task 6 — reset all row group expansion state back to
   *  the initial defaults (`groupDefaultExpanded` / `groupDefaultExpandedKeys`
   *  / `isGroupOpenByDefault`). Discards every user-driven expand / collapse
   *  toggle and re-runs `setGroupModel` with the current model so the worker
   *  re-seeds `expandedKeys` from defaults. */
  resetRowGroupExpansion(): void {
    if (this.host.destroyed) return;
    this.host.expandedKeys = null;
    // Re-submit the current group model; the worker will re-apply the
    // groupDefaultExpanded / groupDefaultExpandedKeys defaults it was
    // initialised with, producing a fresh expandedKeys set.
    this.host.setGroupModel(this.host.grouping.getGroupModel());
  }

  expandAll(): void {
    if (this.host.destroyed) return;
    // Sparse SSRM — the null sentinel maps to the DEFAULT expansion set,
    // not expand-all; ship an explicit all-keys set instead.
    if (this.isSparseSsrm()) {
      this.host.expandedKeys = new Set(this.host.knownGroupKeys);
      this.shipExpandedKeys(Array.from(this.host.expandedKeys));
    } else {
      this.host.expandedKeys = null;
      this.shipExpandedKeys(null);
    }
    this.host.events.emit({ type: 'expandOrCollapseAll', expanded: true });
  }

  /** Cycle 15 / Task 7 — flip every group to collapsed. The mirror
   *  holds an empty Set (the canonical "explicit, with no expanded
   *  keys" state); the worker mirrors. Fires `expandOrCollapseAll`
   *  with `expanded: false`. */
  collapseAll(): void {
    if (this.host.destroyed) return;
    this.host.expandedKeys = new Set();
    this.shipExpandedKeys([]);
    this.host.events.emit({ type: 'expandOrCollapseAll', expanded: false });
  }

  /**
   * Sparse SSRM with host-owned grouping + `groupDefaultExpanded: 0`.
   * In that mode `expandedKeys === null` means "not yet toggled — all
   * collapsed", matching `getRows` / painted chevrons. CSRM (and SSRM
   * client pipeline) still treat null as the expand-all sentinel.
   */
  /**
   * Sparse-SSRM default expansion for the null sentinel — mirrors the
   * worker GroupPass rules over `knownGroupKeys` (AG semantics:
   * `isGroupOpenByDefault` wins, then `groupDefaultExpandedKeys`, then
   * `groupDefaultExpanded`: -1/'all' = everything, N = number of LEVELS
   * open, 0/other negatives = nothing). Depth derives from the composite
   * key's segment count.
   */
  sparseDefaultExpandedKeys(): Set<string> {
    const cb = this.host.options.isGroupOpenByDefault;
    if (cb) {
      const set = new Set<string>();
      for (const key of this.host.knownGroupKeys) {
        const route = parseCompositeGroupKey(key).map((s) => s.value);
        try {
          if (cb({ key, route })) set.add(key);
        } catch { /* skip */ }
      }
      return set;
    }
    if (this.host.options.groupDefaultExpandedKeys !== undefined) {
      return new Set(this.host.options.groupDefaultExpandedKeys);
    }
    const d = this.host.options.groupDefaultExpanded ?? 0;
    if (d === 'all' || d === -1) return new Set(this.host.knownGroupKeys);
    if (typeof d === 'number' && d > 0) {
      const set = new Set<string>();
      for (const key of this.host.knownGroupKeys) {
        const depth = key.split('::').length - 1;
        if (depth < d) set.add(key);
      }
      return set;
    }
    return new Set();
  }

  /** Under the null sentinel, is `groupKey` expanded? CSRM: yes (null =
   *  expand-all). Sparse SSRM: membership in the default expansion set. */
  isKeyExpandedUnderNullSentinel(groupKey: string): boolean {
    if (this.isSparseSsrm()) return this.sparseDefaultExpandedKeys().has(groupKey);
    return true;
  }

  /** Host-owned-grouping SSRM: v2 skeleton datasource, or v1 with the
   *  client pipeline explicitly disabled. Falls back to the construction
   *  options before the controller mounts (the grouping coordinator can
   *  ship the initial group model earlier in construction). */
  isSparseSsrm(): boolean {
    if (this.host.options.rowModelType !== 'serverSide') return false;
    if (this.host.options.serverSideEnableClientSidePipeline === false) return true;
    if (this.host.ssrm !== null) return this.host.ssrmV2 && !this.host.ssrmClientPipeline;
    return isServerSideDatasourceV2(this.host.options.serverSideDatasource);
  }

  /** Materialise an explicit set when leaving the null sentinel. */
  materializeExpandedKeysFromNull(): Set<string> {
    if (this.isSparseSsrm()) return this.sparseDefaultExpandedKeys();
    return new Set(this.host.knownGroupKeys);
  }

  /** Cycle 15 / Task 7 — toggle a specific group's expanded state.
   *  When the mirror is at the default-all sentinel AND the call
   *  collapses a single group, we materialise against
   *  `knownGroupKeys` first so the worker receives an explicit set
   *  (otherwise the worker would interpret the null sentinel as
   *  "expand everything" and clobber the toggle). Idempotent — no
   *  event fires when the state didn't change. Unknown keys (a
   *  stale key from a prior model) no-op AFTER the materialisation
   *  attempt; this preserves the lossless mirror in either
   *  direction. */
  setExpanded(groupKey: string, expanded: boolean): void {
    if (this.host.destroyed) return;
    // Materialise the mirror if we're entering explicit mode from
    // the null sentinel.
    let next: Set<string>;
    if (this.host.expandedKeys === null) {
      const defaultExpanded = this.isKeyExpandedUnderNullSentinel(groupKey);
      if (expanded === defaultExpanded) return;
      next = this.materializeExpandedKeysFromNull();
    } else {
      next = new Set(this.host.expandedKeys);
    }
    const wasExpanded = next.has(groupKey);
    if (wasExpanded === expanded) return;
    if (expanded) next.add(groupKey);
    else next.delete(groupKey);
    this.host.expandedKeys = next;
    this.shipExpandedKeys(Array.from(next));
    this.host.events.emit({
      type: 'rowGroupOpened',
      key: groupKey,
      expanded,
      source: 'api',
    });
  }

  /** Cycle 15 / Task 7 — snapshot of the currently-expanded composite
   *  group key set. Returns a fresh `Set` each call (mutations don't
   *  affect grid state). When the mirror is at the default-all
   *  sentinel we materialise via `knownGroupKeys` so the snapshot is
   *  honest about which keys are open. Sparse SSRM with
   *  `groupDefaultExpanded: 0` treats null as all-collapsed. */
  getExpandedKeys(): Set<string> {
    if (this.host.expandedKeys === null) {
      return this.materializeExpandedKeysFromNull();
    }
    return new Set(this.host.expandedKeys);
  }

  /** Cycle 15 / Task 7 — internal ship-to-worker for the expanded-keys
   *  set. Refreshes `knownGroupKeys` from the reply (a transaction
   *  that landed mid-flight could have added / removed groups) and
   *  drives the next viewport request so the chunk reflects the
   *  collapsed / expanded set.
   *
   *  Cycle 15 / Task 8 — also refreshes the descendant cache from
   *  `groupDescendants` when the worker is emitting them. The
   *  selection model's membership resolver reads from this cache. */
  shipExpandedKeys(keys: string[] | null): void {
    // Sparse SSRM — expansion state drives the flattened order. v2: local
    // skeleton reflow (same frame). v1: `refreshExpansion` drops the whole
    // block cache (a toggle shifts every flattened index below it;
    // band-only invalidation left stale rows to rehydrate at old offsets).
    if (this.host.ssrm && !this.host.ssrmClientPipeline && this.isSparseSsrm()) {
      void this.host.ssrm.refreshExpansion().then(() => {
        if (this.host.destroyed) return;
        this.host.rowHeightIndex = null;
        this.host.recomputeViewport();
        this.host.cgridCanvas.requestRepaint();
        this.host.requestViewport();
      }).catch((err) => { if (!this.host.destroyed) console.error('[velocity-grid]', err); });
      return;
    }
    this.host.workerCoord
      .setExpandedKeys(keys)
      .then(({ visibleCount, groupKeys, groupDescendants }) => {
        if (this.host.destroyed) return;
        this.host.knownGroupKeys = groupKeys;
        this.updateGroupDescendantsCache(groupKeys, groupDescendants);
        this.host.rowCount = visibleCount;
        this.host.rowHeightIndex = null;
        this.host.recomputeViewport();
        this.host.cgridCanvas.requestRepaint();
        this.host.requestViewport();
      })
      .catch((err) => { if (!this.host.destroyed) console.error('[velocity-grid]', err); });
  }

  /** Apply stashed `expandedRouteIds` from `setState` once grouping is
   *  active on the main thread. Returns true when pending keys were
   *  consumed (including the empty "all collapsed" set). Returns false
   *  only when there is nothing pending — callers must not seed
   *  groupDefaultExpanded in that case when a restore is still queued
   *  behind a failed worker round-trip; use `hasPendingExpandedRoutes`. */
  flushPendingExpandedRoutes(): boolean {
    if (this.host.pendingExpandedRouteIds === null) return false;
    if (this.host.grouping.getRowGroupColumns().length === 0) {
      // Ungrouped restore — drop the stash; nothing to expand.
      this.host.pendingExpandedRouteIds = null;
      this.host.expandedKeys = new Set();
      return true;
    }
    const ids = this.host.pendingExpandedRouteIds;
    this.host.pendingExpandedRouteIds = null;
    this.host.expandedKeys = new Set(ids);
    this.shipExpandedKeys(ids);
    return true;
  }

  /** True while `setState` has stashed expand/collapse keys that have
   *  not yet been flushed to the worker. */
  hasPendingExpandedRoutes(): boolean {
    return this.host.pendingExpandedRouteIds !== null;
  }

  /** Cycle 15 / Task 8 — re-fetch the worker's descendant snapshot
   *  without flipping the emission flag. Used after `modelUpdated`
   *  pushes (data transactions / sort / filter) when
   *  `groupSelectsChildren` is on, so the membership cache stays in
   *  lockstep with the worker's tree. Fire-and-forget; a stale paint
   *  for one frame is acceptable while the round-trip resolves. */
  refreshGroupDescendantsCache(): void {
    this.host.workerCoord
      .setEmitGroupDescendants(true)
      .then(({ groupKeys, groupDescendants }) => {
        if (this.host.destroyed) return;
        this.host.knownGroupKeys = groupKeys;
        this.updateGroupDescendantsCache(groupKeys, groupDescendants);
        this.host.cgridCanvas?.requestRepaint();
      })
      .catch((err) => {
        if (!this.host.destroyed) console.error('[velocity-grid] refreshGroupDescendantsCache:', err);
      });
  }

  /** Cycle 15 / Task 8 — apply a `groupKeysSnapshot` reply's parallel
   *  `groupKeys` + `groupDescendants` arrays to the main-side cache the
   *  `GroupMembershipResolver` reads from. An empty `groupDescendants`
   *  array clears the cache (the worker isn't emitting descendants
   *  right now — the resolver collapses to `'none'` for every key,
   *  which is the correct paint default for "I don't know"). */
  updateGroupDescendantsCache(
    groupKeys: readonly string[],
    groupDescendants: readonly (readonly string[])[] | undefined,
  ): void {
    if (!groupDescendants || groupDescendants.length === 0) {
      // Either grouping bypasses OR the worker isn't emitting
      // descendants (Tasks 1-7 path); clear so the resolver returns
      // empty arrays and the renderer defaults to 'none'.
      if (this.host.groupDescendantsByKey.size > 0) this.host.groupDescendantsByKey.clear();
      return;
    }
    const next = new Map<string, readonly string[]>();
    for (let i = 0; i < groupKeys.length; i++) {
      const key = groupKeys[i]!;
      next.set(key, groupDescendants[i] ?? []);
    }
    this.host.groupDescendantsByKey = next;
  }

  /** Cycle 15 / Task 8 — toggle the tri-state cascading machinery.
   *
   *  Wiring:
   *    1. Toggles the worker's per-snapshot descendant emission so
   *       subsequent `setGroupModel` / `setExpandedKeys` replies carry
   *       (or omit) the `groupDescendants` array.
   *    2. The current snapshot reply primes the main-side cache.
   *    3. Wires (or detaches) the SelectionModel's membership resolver
   *       so its `setGroupSelected` / `getGroupSelectionState` paths
   *       light up with cascade semantics.
   *    4. Triggers a paint so auto-group cells re-render with the
   *       new checkbox slot wide / hidden.
   *
   *  Resolves once the worker has acked the toggle so callers awaiting
   *  the runtime swap know the first paint after the resolve carries
   *  the new behaviour. */
  async applyGroupSelectsChildren(enabled: boolean): Promise<void> {
    if (this.host.destroyed) return;
    try {
      const { groupKeys, groupDescendants } = await this.host.workerCoord
        .setEmitGroupDescendants(enabled);
      if (this.host.destroyed) return;
      this.host.knownGroupKeys = groupKeys;
      this.updateGroupDescendantsCache(groupKeys, enabled ? groupDescendants : undefined);
    } catch (err) {
      if (!this.host.destroyed) console.error('[velocity-grid] setEmitGroupDescendants:', err);
      return;
    }
    if (enabled) {
      this.host.selection.setGroupSelectsChildren(true, {
        getDescendantRowIds: (key) => this.host.groupDescendantsByKey.get(key) ?? [],
      });
    } else {
      this.host.selection.setGroupSelectsChildren(false, null);
    }
    this.host.cgridCanvas?.requestRepaint();
  }

  /** Cycle 19 / Task 5-Grouping — primitive grouping API delegates.
   *  The coordinator owns the `GroupingState` primitive; the
   *  `groupingStateChanged` handler downstream ships the model swap
   *  to the worker (or merges the per-level sort into the sort model
   *  on a pure-sort change). */
  setRowGroupColumns(columns: string[]): void {
    if (!this.host.destroyed) this.host.grouping.setRowGroupColumns(columns);
  }
  addRowGroupColumn(colId: string): void {
    if (!this.host.destroyed) this.host.grouping.addRowGroupColumn(colId);
  }
  removeRowGroupColumn(colId: string): void {
    if (!this.host.destroyed) this.host.grouping.removeRowGroupColumn(colId);
  }
  /** AG v33 plural form — appends each column in order. */
  addRowGroupColumns(colIds: string[]): void {
    for (const colId of colIds) this.addRowGroupColumn(colId);
  }
  /** AG v33 plural form — removes each listed column. */
  removeRowGroupColumns(colIds: string[]): void {
    for (const colId of colIds) this.removeRowGroupColumn(colId);
  }
  moveRowGroupColumn(from: number, to: number): void {
    if (!this.host.destroyed) this.host.grouping.moveRowGroupColumn(from, to);
  }
  setRowGroupColumnSort(colId: string, direction: 'asc' | 'desc' | null): void {
    if (!this.host.destroyed) this.host.grouping.setRowGroupColumnSort(colId, direction);
  }
  getRowGroupColumns(): string[] {
    return this.host.grouping.getRowGroupColumns();
  }
}
