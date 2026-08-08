// Cycle 19 / Task 5-ColState — owns the column-state round-trip extracted
// from VelocityGrid:
//   • the construction-time `initialColumnStateSnapshot` used by
//     `resetColumnState` to replay the as-coded layout,
//   • `getColumnState()` — the pivot-aware snapshot that always reflects
//     PRIMARY columns (per AG-Grid parity),
//   • `applyColumnState(params)` / `resetColumnState()` — the public
//     restore API,
//   • the shared `applyColumnStateInternal(params, emitReset)` engine
//     that runs a single re-layout + repaint cycle and drains the
//     change queue into deterministic `columnMoved` / `columnVisible` /
//     `columnPinned` / `columnResized` / `sortChanged` / `columnsReset`
//     events,
//   • `applyRoleStateFromColumnState(state)` — the Cycle 18 / Task 8b
//     role fan-out that reconciles the `rowGroup` / `pivot` / `aggFunc`
//     slots into the runtime `GroupingState` + `PivotState` primitives.
//
// VelocityGrid is the thin consumer: the public `getColumnState` /
// `applyColumnState` / `resetColumnState` methods delegate here, and
// `getState` / `setState` reach through `columnState.*` for the snapshot
// + restore leg.
//
// The seam is FAT — column-state restore orchestrates every rendering-
// state field mutation touches (the def slots, the tree, the visible
// order, the layout, the sort model, the role primitives, and the
// worker column metadata) — and routing each one through explicit deps
// callbacks keeps the manager unaware of VelocityGrid's private fields. The
// pivot-aware "snapshot / apply against primaries under pivot mode"
// invariant (Cycle 18 / Task 9) survives untouched: the manager consults
// `deps.isPivotActive()` + `deps.getPrimaryColumnTree()` to pick the
// tree, exactly like the pre-extraction code did.

import type { TypedEventEmitter } from './eventEmitter';
import type { ColumnTree } from './columnTree';
import type { ResolvedColDef } from './propertyChain';
import type { ColumnLayout } from './layout';
import type { VelocityGridEvent, SortModel } from '../types';
import type { CColumnState, CApplyColumnStateParams } from '../types';
import type { CColDef, CColGroupDef } from '../types';
import {
  snapshotState,
  applyStateToTree,
  cloneStateForReset,
  type SnapshotLocks,
} from './columnState';
import {
  reorderLeavesByList,
  type ColumnOrderConstraints,
} from './columnOrder';
import { resolveColumnWidths } from './layout';

/** Value column shape used by the role fan-out. Mirrors the shape the
 *  pivot API surfaces via `getValueColumns()`. */
export interface ColumnStateValueColumn {
  colId: string;
  aggFunc: string;
}

/** Deps interface: every access the manager needs into VelocityGrid state, the
 *  worker plumbing, the layout pipeline, and the runtime state
 *  primitives (pivot + grouping). Intentionally fat — column-state
 *  restore orchestrates every rendering-state field mutation touches,
 *  and routing each one through explicit callbacks keeps the manager
 *  unaware of VelocityGrid's private fields. */
export interface ColumnStateManagerDeps<TRow> {
  events: TypedEventEmitter<VelocityGridEvent>;
  isDestroyed(): boolean;

  // ── column tree / order / layout / defs ──────────────────────────────
  getColumnTree(): ColumnTree;
  getColumnOrder(): ReadonlyArray<ResolvedColDef<TRow>>;
  setColumnOrder(order: ResolvedColDef<TRow>[]): void;
  getColumnLayout(): ReadonlyArray<ColumnLayout>;
  setColumnLayout(layout: ColumnLayout[]): void;
  computeVisibleColumnOrder(): ResolvedColDef<TRow>[];
  getLayoutWidth(): number;
  /** Raw `options.columnDefs` array. Mutated (by reference) on leaf
   *  order changes so `rebuildColumns` sees the reordered defs. */
  getColumnDefs(): (CColDef<TRow> | CColGroupDef<TRow>)[];
  setColumnDefs(defs: (CColDef<TRow> | CColGroupDef<TRow>)[]): void;
  /** Full tree rebuild — used when `applyOrder: true` changes the leaf
   *  order so `columnTree` + `columnDefsMap` are re-resolved from the
   *  reordered `options.columnDefs`. */
  rebuildColumns(): void;

  // ── column-order constraints (locks + marryChildren) ─────────────────
  buildColumnOrderConstraints(): ColumnOrderConstraints;

  /** Helper: rebuild the nested `CColDef` / `CColGroupDef` tree so its
   *  leaf order matches the given flat `newLeafOrder`. Kept as a deps
   *  callback (rather than an import) because the same free function is
   *  used elsewhere on VelocityGrid (e.g. `reorderColumn`) and lives at the top
   *  of `velocityGrid.ts` as a private helper. */
  rebuildColumnDefsByLeafOrder(
    defs: (CColDef<TRow> | CColGroupDef<TRow>)[],
    newLeafOrder: string[],
  ): (CColDef<TRow> | CColGroupDef<TRow>)[];
  /** Helper: diff two flat-leaf orders and return the colIds whose
   *  index changed. Used to fan out `columnMoved` events. */
  collectMovedColIds(oldOrder: string[], newOrder: string[]): string[];

  // ── sort model ───────────────────────────────────────────────────────
  getSortModel(): SortModel;
  setSortModel(m: SortModel): void;

  // ── repaint pipeline ─────────────────────────────────────────────────
  recomputeViewport(): void;
  requestRepaint(): void;

  // ── worker round-trip ────────────────────────────────────────────────
  workerColumns(): unknown[];
  updateWorkerColumns(cols: unknown[]): Promise<{ visibleCount: number }>;
  requestViewport(): void;
  setRowCount(n: number): void;

  // ── pivot engine bridge (Cycle 18 / Task 9 pivot-primary snapshot) ───
  isPivotActive(): boolean;
  getPrimaryColumnTree(): ColumnTree | null;
  getPivotColumns(): string[];
  getPivotValueColumns(): ColumnStateValueColumn[];
  /** Role fan-out target for pivot columns. */
  setPivotColumns(cols: string[]): void;
  /** Role fan-out target for value columns. */
  setValueColumns(list: ColumnStateValueColumn[]): void;

  // ── grouping bridge (Cycle 18 / Task 8b role slots) ──────────────────
  getGroupingRowGroupColumns(): string[];
  /** Role fan-out target for row-group columns. Routes through the
   *  underlying `GroupingState` primitive so the grouping-coordinator's
   *  state-change handler picks up the swap. */
  setGroupingRowGroupColumns(cols: string[]): void;
}

export class ColumnStateManager<TRow = unknown> {
  /** Cycle 6 / Task 2 — construction-time snapshot replayed by
   *  `resetColumnState`. Empty until `captureInitialSnapshot()` runs
   *  (called by VelocityGrid once the initial layout has resolved). */
  private initialSnapshot: CColumnState[] = [];

  constructor(private readonly deps: ColumnStateManagerDeps<TRow>) {}

  // ── Public read surface ───────────────────────────────────────────────────

  /** Capture the initial column state so `resetColumnState` can replay
   *  the as-coded layout. Called by VelocityGrid once at construction, AFTER
   *  the initial `columnLayout` is resolved — snapshotting earlier
   *  would miss `initial*` field defaults + widths. */
  captureInitialSnapshot(): void {
    this.initialSnapshot = snapshotState(
      this.deps.getColumnTree(),
      this.deps.getColumnLayout() as ColumnLayout[],
      this.deps.getSortModel(),
    );
  }

  /** Snapshot the current tree / layout / sort model into a persistable
   *  `CColumnState[]` covering every leaf in declaration order (hidden
   *  leaves included so the round-trip is symmetric).
   *
   *  Cycle 18 / Task 8b — the role slots (rowGroup / rowGroupIndex /
   *  pivot / pivotIndex / aggFunc) source from the runtime GroupingState
   *  + PivotState primitives via deps callbacks. The original Cycle 6
   *  implementation read the static colDef slots and missed runtime API
   *  mutations — a latent bug the tool panel + pivot panel + context
   *  menu items all surfaced as "Restore doesn't restore".
   *
   *  Cycle 18 / Task 9 — under pivot mode the rendered tree is the
   *  SYNTHESIZED pivot result tree (pivotcol* leaves + the auto-group
   *  col), NOT the primary user columns. Snapshotting the synthesized
   *  tree would lose every primary column from the save → the round-
   *  trip restore couldn't reinstate the pivot/value role lists. AG
   *  parity: column state always reflects PRIMARY columns. So when
   *  pivot is active we snapshot against the cached primary tree
   *  instead. */
  getColumnState(): CColumnState[] {
    const treeForSnapshot = this.deps.isPivotActive() && this.deps.getPrimaryColumnTree() !== null
      ? this.deps.getPrimaryColumnTree()!
      : this.deps.getColumnTree();
    return snapshotState(
      treeForSnapshot,
      this.deps.getColumnLayout() as ColumnLayout[],
      this.deps.getSortModel(),
      {
        rowGroupColumns: this.deps.getGroupingRowGroupColumns(),
        pivotColumns: this.deps.getPivotColumns(),
        valueColumns: this.deps.getPivotValueColumns(),
      },
    );
  }

  // ── Public mutation surface ───────────────────────────────────────────────

  /** Cycle 6 / Task 2 — restore column state through a single re-layout
   *  + repaint cycle. Mutates `columnDefsMap` (the same ResolvedColDef
   *  objects referenced by `columnTree.leafById`) in place, then fans
   *  the matching events out with `source: 'columnState'`. Returns
   *  `false` when one or more `state[].colId` entries did not match a
   *  known leaf. */
  applyColumnState(params: CApplyColumnStateParams): boolean {
    if (this.deps.isDestroyed()) return true;
    return this.applyColumnStateInternal(params, /* emitReset */ false);
  }

  /** Cycle 6 / Task 2 — restore the construction-time snapshot. Fires
   *  `columnsReset` BEFORE the per-slot change events. */
  resetColumnState(): void {
    if (this.deps.isDestroyed()) return;
    this.applyColumnStateInternal(
      { state: cloneStateForReset(this.initialSnapshot), applyOrder: true },
      /* emitReset */ true,
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Engine entry-point shared by `applyColumnState` and `resetColumnState`.
   *  Single re-layout: mutates resolved slots → optionally rebuilds the
   *  column tree → re-runs the visible-column-order + width pass →
   *  recomputeViewport + requestRepaint → drains the event queue → posts
   *  the worker column-metadata refresh. */
  private applyColumnStateInternal(
    params: CApplyColumnStateParams,
    emitReset: boolean,
  ): boolean {
    // Cycle 18 / Task 9 — under pivot mode the live `columnTree` /
    // `columnDefsMap` describe the SYNTHESIZED pivot result tree
    // (pivotcol* leaves + the auto-group column), NOT the primary
    // user columns. Saved column state always reflects PRIMARY
    // columns (see `getColumnState` above for the AG-parity rationale),
    // so apply must validate + mutate against the primary tree's
    // leaf map under pivot mode. The role fan-out in
    // `applyRoleStateFromColumnState` then drives the pivot synthesis
    // to re-build from the restored primary state.
    const applyTree = this.deps.isPivotActive() && this.deps.getPrimaryColumnTree() !== null
      ? this.deps.getPrimaryColumnTree()!
      : this.deps.getColumnTree();
    const applyLeafById = applyTree.leafById;

    let allFound = true;
    if (params.state) {
      for (const entry of params.state) {
        if (!applyLeafById.has(entry.colId)) { allFound = false; break; }
      }
    }

    const locks: SnapshotLocks = {
      lockVisibleOf: (id) => (applyLeafById.get(id) as { lockVisible?: boolean })?.lockVisible ?? false,
      lockPinnedOf: (id) => (applyLeafById.get(id) as { lockPinned?: boolean })?.lockPinned ?? false,
    };

    const oldOrder = this.deps.getColumnOrder().map((c) => c.colId);
    const result = applyStateToTree(applyTree, params, locks);

    // Cycle 18 / Task 8b — fan the role slots out to the runtime state
    // primitives (GroupingState + PivotState). The Cycle 6 columnState
    // primitive writes the def slots opaquely; without this step
    // mutations made via `api.addRowGroupColumn` / `addPivotColumn` /
    // `addValueColumn` did not round-trip through `applyColumnState`.
    // Semantics: FULL replace — columns NOT present in the input state
    // (or present with rowGroup:false / pivot:false / aggFunc:null) are
    // dropped from the role lists. AG-Grid parity Prompt 8.
    //
    // pivotMode itself is NOT in CColumnState (per AG parity); it
    // persists via the `pivotMode` grid option separately. Apps wanting
    // a single save/restore call use `setPivotMode` + this method.
    if (params.state) {
      this.applyRoleStateFromColumnState(params.state);
    }

    let leafOrderChanged = false;
    if (result.newOrder) {
      // Honor Task-1 locks + marryChildren during the reorder.
      const constraints = this.deps.buildColumnOrderConstraints();
      const finalOrder = reorderLeavesByList(this.deps.getColumnTree(), result.newOrder, constraints);
      const current = Array.from(this.deps.getColumnTree().leafById.keys());
      leafOrderChanged = finalOrder.length !== current.length
        || finalOrder.some((id, i) => id !== current[i]);
      if (leafOrderChanged) {
        const newDefs = this.deps.rebuildColumnDefsByLeafOrder(
          this.deps.getColumnDefs(),
          finalOrder,
        );
        this.deps.setColumnDefs(newDefs);
      }
    }

    if (leafOrderChanged) {
      this.deps.rebuildColumns();
      // rebuildColumns rebuilt the tree from `options.columnDefs` — the
      // raw `CColDef`s do not carry the runtime width / hide / pinned
      // mutations `applyStateToTree` just applied to the now-discarded
      // tree. Re-apply the state against the freshly-resolved leaves so
      // the round-trip lands in ONE call (without this, the demo's
      // Restore button needed two clicks to fully restore). The second
      // call is intentionally a no-op for event reporting — we keep
      // `result.changes` from the first call as the authoritative
      // change log.
      applyStateToTree(this.deps.getColumnTree(), params, locks);
      // Re-run visibility + width pass after the second mutation pass so
      // hide flips light up and widths land before the repaint.
      this.relayout();
    } else {
      // Mutations on existing ResolvedColDef slots — recompute the visible
      // column order so a `hide` flip lights up immediately, then rerun
      // the width pass + viewport.
      this.relayout();
    }

    // Drain the change queue into typed events. Deterministic order:
    // columnsReset → columnMoved → columnVisible → columnPinned →
    // columnResized → sortChanged.
    if (emitReset) this.deps.events.emit({ type: 'columnsReset' });

    if (leafOrderChanged) {
      const newOrder = this.deps.getColumnOrder().map((c) => c.colId);
      const moved = this.deps.collectMovedColIds(oldOrder, newOrder);
      for (const colId of moved) {
        const toIndex = newOrder.indexOf(colId);
        this.deps.events.emit({
          type: 'columnMoved', toIndex, colIds: [colId], source: 'columnState',
        });
      }
    }

    const visibleChanges = result.changes.filter((c) => c.kind === 'hide');
    if (visibleChanges.length > 0) {
      // Group by the new visible boolean (CColumnState.hide is the
      // "should be hidden" flag; the event reports the visible boolean).
      const shown = visibleChanges.filter((c) => c.newValue === false).map((c) => c.colId);
      const hidden = visibleChanges.filter((c) => c.newValue === true).map((c) => c.colId);
      if (shown.length) {
        this.deps.events.emit({
          type: 'columnVisible', visible: true, colIds: shown, source: 'columnState',
        });
      }
      if (hidden.length) {
        this.deps.events.emit({
          type: 'columnVisible', visible: false, colIds: hidden, source: 'columnState',
        });
      }
    }

    const pinnedChanges = result.changes.filter((c) => c.kind === 'pinned');
    if (pinnedChanges.length > 0) {
      const byBucket = new Map<'left' | 'right' | null, string[]>();
      for (const c of pinnedChanges) {
        const key = c.newValue as 'left' | 'right' | null;
        const arr = byBucket.get(key) ?? [];
        arr.push(c.colId);
        byBucket.set(key, arr);
      }
      for (const [pinned, colIds] of byBucket.entries()) {
        this.deps.events.emit({
          type: 'columnPinned', pinned, colIds, source: 'columnState',
        });
      }
    }

    for (const c of result.changes.filter((c) => c.kind === 'width')) {
      this.deps.events.emit({
        type: 'columnResized', colId: c.colId, width: c.newValue as number,
        source: 'columnState',
      });
    }

    // Sort: collect every change record's {colId, direction, sortIndex},
    // drop nulls, and order by sortIndex so multi-column sort restores
    // in the right precedence. The previous implementation walked the
    // filtered array with a stale index against the original array,
    // pairing the wrong colId with each direction.
    const sortChanges = result.changes.filter((c) => c.kind === 'sort');
    if (sortChanges.length > 0) {
      const entries = sortChanges
        .map((c) => {
          const v = c.newValue as { direction: 'asc' | 'desc' | null; index: number | null };
          return { colId: c.colId, direction: v.direction, index: v.index };
        })
        .filter((e): e is { colId: string; direction: 'asc' | 'desc'; index: number | null } =>
          e.direction !== null);
      entries.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const next: SortModel = entries.map(({ colId, direction }) => ({ colId, direction }));
      // Route through setSortModel so the worker re-sorts the chunk —
      // without this, the rendered rows stay in the pre-restore order
      // even though the header sort indicator updates. setSortModel also
      // mutates this.sortModel and emits sortChanged on its own (async
      // after the worker round-trip), so we no longer emit it here.
      const current = this.deps.getSortModel();
      const same = current.length === next.length
        && current.every((e, i) =>
          e.colId === next[i]!.colId && e.direction === next[i]!.direction);
      if (!same) this.deps.setSortModel(next);
    }

    // Push column metadata + visible-set change to the worker so a freshly
    // hidden column stops getting chunked, and a freshly shown column gets
    // populated on the next viewport fetch.
    const displayedSource: 'columnsReset' | 'columnDefsChanged' =
      emitReset ? 'columnsReset' : 'columnDefsChanged';
    this.deps.updateWorkerColumns(this.deps.workerColumns())
      .then(({ visibleCount }) => {
        if (this.deps.isDestroyed()) return;
        this.deps.setRowCount(visibleCount);
        this.deps.recomputeViewport();
        this.deps.events.emit({ type: 'displayedColumnsChanged', source: displayedSource });
        this.deps.requestViewport();
      })
      .catch((err) => { if (!this.deps.isDestroyed()) console.error('[velocity-grid] applyColumnState:', err); });

    return allFound;
  }

  /** Re-run the visible-column-order + width pass + viewport recompute
   *  + repaint request. Shared by both the leaf-order-changed and slot-
   *  mutated branches of `applyColumnStateInternal`. */
  private relayout(): void {
    const order = this.deps.computeVisibleColumnOrder();
    this.deps.setColumnOrder(order);
    this.deps.setColumnLayout(resolveColumnWidths(order, this.deps.getLayoutWidth()));
    this.deps.recomputeViewport();
    this.deps.requestRepaint();
  }

  /** Cycle 18 / Task 8b — derive the rowGroupColumns / pivotColumns /
   *  valueColumns lists from a CColumnState array and replace the
   *  runtime state primitives in one event tick each. The row-group +
   *  pivot lists honor the per-entry `rowGroupIndex` / `pivotIndex` for
   *  ordering (stable for ties; columns without an index sort last).
   *  Value columns preserve the state input order (no separate index).
   *
   *  Routed through `setGroupingRowGroupColumns` / `setPivotColumns` /
   *  `setValueColumns` (batch verbs) so the cross-surface event chain
   *  fires once per role list — NOT once per column. The tool panel +
   *  pivot panel + context menu items + row group panel all repaint
   *  from those events. */
  private applyRoleStateFromColumnState(state: readonly CColumnState[]): void {
    interface Indexed { colId: string; index: number; declOrder: number }
    const rowGroups: Indexed[] = [];
    const pivots: Indexed[] = [];
    const values: ColumnStateValueColumn[] = [];
    // Cycle 18 / Task 9 — under pivot mode `columnDefsMap` covers
    // synthesized leaves only; validate against the primary tree so
    // saved state with primary col ids round-trips.
    const validLeafById = this.deps.isPivotActive() && this.deps.getPrimaryColumnTree() !== null
      ? this.deps.getPrimaryColumnTree()!.leafById
      : this.deps.getColumnTree().leafById;
    state.forEach((entry, declOrder) => {
      if (!validLeafById.has(entry.colId)) return;
      if (entry.rowGroup === true) {
        rowGroups.push({
          colId: entry.colId,
          index: entry.rowGroupIndex ?? Number.MAX_SAFE_INTEGER,
          declOrder,
        });
      }
      if (entry.pivot === true) {
        pivots.push({
          colId: entry.colId,
          index: entry.pivotIndex ?? Number.MAX_SAFE_INTEGER,
          declOrder,
        });
      }
      if (typeof entry.aggFunc === 'string' && entry.aggFunc.length > 0) {
        values.push({ colId: entry.colId, aggFunc: entry.aggFunc });
      }
    });
    const sortByIndex = (a: Indexed, b: Indexed) =>
      (a.index - b.index) || (a.declOrder - b.declOrder);
    rowGroups.sort(sortByIndex);
    pivots.sort(sortByIndex);

    // Always call the batch verbs — even on empty lists — so a state
    // input that omits any column previously assigned to a role clears
    // that role. The verbs short-circuit when the resulting list is
    // identical to the current one (no spurious event emission).
    this.deps.setGroupingRowGroupColumns(rowGroups.map((e) => e.colId));
    this.deps.setPivotColumns(pivots.map((e) => e.colId));
    this.deps.setValueColumns(values);
  }
}
