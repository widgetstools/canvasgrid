// Cycle 6 / Task 2 — Column state round-trip primitives.
//
// `snapshotState` reads from the column tree + current layout + sort model
// and produces a serialisable `CColumnState[]` covering every leaf
// (hidden ones included so the round-trip is symmetric).
//
// `applyStateToTree` mutates the `ResolvedColDef` slots inside
// `tree.leafById` in place and returns a `ChangeRecord[]` so the cgrid
// layer can fan out the matching events (`columnResized` / `columnVisible`
// / `columnPinned` / `sortChanged`) in a single deterministic pass. When
// `applyOrder: true` the result also carries the rewritten flat leaf
// order so the cgrid layer can rebuild the column tree once instead of
// once-per-mutated-slot.
//
// `cloneStateForReset` deep-clones the construction-time snapshot so
// `resetColumnState` can replay it without aliasing.

import type { ColumnTree } from './columnTree';
import type { ColumnLayout } from './layout';
import type {
  CColumnState, CApplyColumnStateParams, SortModel,
} from '../types';

export type { CColumnState, CApplyColumnStateParams };

/** Lock predicates so the cgrid layer can wire in its `columnDefsMap`
 *  lookups without forcing the primitive to know about `ResolvedColDef`. */
export interface SnapshotLocks {
  lockVisibleOf: (colId: string) => boolean;
  lockPinnedOf: (colId: string) => boolean;
}

export type ChangeKind = 'width' | 'flex' | 'hide' | 'pinned' | 'sort';

export interface ChangeRecord {
  colId: string;
  kind: ChangeKind;
  oldValue: unknown;
  newValue: unknown;
}

export interface ApplyResult {
  changes: ChangeRecord[];
  /** New flat-leaf order when `applyOrder: true` AND the desired list
   *  produced a different order. `null` when applyOrder is false or the
   *  desired list matched the current order. */
  newOrder: string[] | null;
}

/** Cycle 18 / Task 8b — runtime-state providers the snapshot reads from
 *  for the role slots (rowGroup / rowGroupIndex / pivot / pivotIndex /
 *  aggFunc). When supplied, these are the authoritative source — NOT the
 *  static colDef slots — so `api.addRowGroupColumn(...)` / `addPivotColumn`
 *  / `addValueColumn` / `setValueColumnAggFunc` round-trip through
 *  `getColumnState`. Omitting any field falls back to the def slot to
 *  preserve back-compat for callers that don't yet thread runtime state. */
export interface SnapshotRuntimeProviders {
  /** Ordered row-group column ids (GroupingState). */
  rowGroupColumns?: readonly string[];
  /** Ordered pivot column ids (PivotState). */
  pivotColumns?: readonly string[];
  /** Ordered value columns (PivotState). */
  valueColumns?: ReadonlyArray<{ colId: string; aggFunc: string }>;
}

/** Build a `CColumnState[]` snapshot from the tree + the current resolved
 *  layout + sort model. Hidden leaves are still included so a future
 *  `applyColumnState(state)` can round-trip the visibility flip.
 *
 *  Cycle 18 / Task 8b — when `runtime` is supplied, the rowGroup / pivot /
 *  aggFunc slots are derived from runtime state primitives. The role index
 *  fields (`rowGroupIndex` / `pivotIndex`) come from the position in the
 *  ordered list. Otherwise (back-compat) the static colDef slots fill in. */
export function snapshotState(
  tree: ColumnTree,
  layout: ColumnLayout[],
  sortModel: SortModel,
  runtime?: SnapshotRuntimeProviders,
): CColumnState[] {
  const widthByCol = new Map<string, number>();
  const pinnedByCol = new Map<string, 'left' | 'right'>();
  for (const slot of layout) {
    widthByCol.set(slot.colId, slot.width);
    if (slot.pinned) pinnedByCol.set(slot.colId, slot.pinned);
  }
  const sortByCol = new Map<string, { direction: 'asc' | 'desc'; index: number }>();
  sortModel.forEach((entry, i) => {
    sortByCol.set(entry.colId, { direction: entry.direction, index: i });
  });

  // Cycle 18 / Task 8b — index the runtime role lists for O(1) lookup.
  // `undefined` providers fall back to the def slot.
  const rowGroupIndexById = new Map<string, number>();
  const pivotIndexById = new Map<string, number>();
  const aggFuncById = new Map<string, string>();
  if (runtime?.rowGroupColumns) {
    runtime.rowGroupColumns.forEach((id, i) => rowGroupIndexById.set(id, i));
  }
  if (runtime?.pivotColumns) {
    runtime.pivotColumns.forEach((id, i) => pivotIndexById.set(id, i));
  }
  if (runtime?.valueColumns) {
    for (const v of runtime.valueColumns) aggFuncById.set(v.colId, v.aggFunc);
  }

  const out: CColumnState[] = [];
  for (const leaf of tree.leaves) {
    const def = leaf as typeof leaf & {
      hide?: boolean; pinned?: 'left' | 'right';
      rowGroup?: boolean; rowGroupIndex?: number | null;
      pivot?: boolean; pivotIndex?: number | null;
      aggFunc?: string;
    };
    const layoutWidth = widthByCol.get(leaf.colId);
    const layoutPinned = pinnedByCol.get(leaf.colId) ?? null;
    // Hidden leaves are absent from layout — fall back to the resolved
    // col-def's own `width` / `pinned` so the round-trip carries them.
    const width = layoutWidth ?? def.width;
    const pinned = layoutPinned ?? (def.pinned ?? null);
    const sort = sortByCol.get(leaf.colId);

    // Cycle 18 / Task 8b — role fields source from runtime state when
    // available; otherwise fall through to the def slot for back-compat.
    let rowGroup: boolean;
    let rowGroupIndex: number | null;
    if (runtime?.rowGroupColumns) {
      const i = rowGroupIndexById.get(leaf.colId);
      rowGroup = i !== undefined;
      rowGroupIndex = i ?? null;
    } else {
      rowGroup = def.rowGroup ?? false;
      rowGroupIndex = def.rowGroupIndex ?? null;
    }
    let pivot: boolean;
    let pivotIndex: number | null;
    if (runtime?.pivotColumns) {
      const i = pivotIndexById.get(leaf.colId);
      pivot = i !== undefined;
      pivotIndex = i ?? null;
    } else {
      pivot = def.pivot ?? false;
      pivotIndex = def.pivotIndex ?? null;
    }
    let aggFunc: string | null;
    if (runtime?.valueColumns) {
      aggFunc = aggFuncById.get(leaf.colId) ?? null;
    } else {
      aggFunc = def.aggFunc ?? null;
    }

    out.push({
      colId: leaf.colId,
      width,
      flex: def.flex ?? null,
      hide: def.hide ?? false,
      pinned,
      sort: sort ? sort.direction : null,
      sortIndex: sort ? sort.index : null,
      rowGroup,
      rowGroupIndex,
      pivot,
      pivotIndex,
      aggFunc,
    });
  }
  return out;
}

/** Pure-mutation plan: walk `state` (and `defaultState` for omitted
 *  leaves), mutate each leaf's resolved col-def slots in place, and
 *  collect a flat `ChangeRecord[]` of every actual change. The cgrid
 *  layer turns the records into events.
 *
 *  `applyOrder: true` produces the rewritten flat-leaf order (honoring
 *  the input list's permutation; locks + `marryChildren` are applied
 *  later by the cgrid layer through `reorderLeavesByList`). */
export function applyStateToTree(
  tree: ColumnTree,
  params: CApplyColumnStateParams,
  locks: SnapshotLocks,
): ApplyResult {
  const { state = [], defaultState, applyOrder } = params;
  const changes: ChangeRecord[] = [];

  // Build a quick lookup so `defaultState` can find leaves not mentioned.
  const stateById = new Map<string, CColumnState>();
  for (const entry of state) {
    if (tree.leafById.has(entry.colId)) stateById.set(entry.colId, entry);
  }

  // Walk every leaf so `defaultState` can apply uniformly. The leaves' own
  // order is irrelevant for mutation; only `applyOrder` cares about order.
  for (const [colId, leaf] of tree.leafById.entries()) {
    const explicit = stateById.get(colId);
    const slot: CColumnState | undefined = explicit
      ?? (defaultState ? { colId, ...defaultState } : undefined);
    if (!slot) continue;
    applySlot(colId, leaf as MutableColDef, slot, locks, changes);
  }

  let newOrder: string[] | null = null;
  if (applyOrder) {
    const desired: string[] = [];
    const seen = new Set<string>();
    for (const entry of state) {
      if (!tree.leafById.has(entry.colId)) continue;
      if (seen.has(entry.colId)) continue;
      seen.add(entry.colId);
      desired.push(entry.colId);
    }
    // Append unmentioned leaves in their current declaration order.
    for (const colId of tree.leafById.keys()) {
      if (seen.has(colId)) continue;
      desired.push(colId);
    }
    // Only report a new order when it actually differs from the current
    // declaration order — keeps the cgrid layer from rebuilding for a
    // no-op restore.
    const current = Array.from(tree.leafById.keys());
    const differs = desired.length !== current.length
      || desired.some((id, i) => id !== current[i]);
    newOrder = differs ? desired : null;
  }

  return { changes, newOrder };
}

interface MutableColDef {
  width?: number;
  flex?: number;
  pinned?: 'left' | 'right';
  hide: boolean;
  rowGroup?: boolean;
  rowGroupIndex?: number | null;
  pivot?: boolean;
  pivotIndex?: number | null;
  aggFunc?: string;
}

function applySlot(
  colId: string,
  leaf: MutableColDef,
  slot: CColumnState,
  locks: SnapshotLocks,
  changes: ChangeRecord[],
): void {
  // width
  if (slot.width !== undefined && slot.width !== leaf.width) {
    changes.push({ colId, kind: 'width', oldValue: leaf.width, newValue: slot.width });
    leaf.width = slot.width;
  }
  // flex — `null` clears any flex.
  if (slot.flex !== undefined) {
    const next = slot.flex === null ? undefined : slot.flex;
    if (next !== leaf.flex) {
      changes.push({ colId, kind: 'flex', oldValue: leaf.flex, newValue: next });
      leaf.flex = next;
    }
  }
  // hide — guarded by lockVisible.
  if (slot.hide !== undefined && slot.hide !== leaf.hide) {
    if (!locks.lockVisibleOf(colId)) {
      changes.push({ colId, kind: 'hide', oldValue: leaf.hide, newValue: slot.hide });
      leaf.hide = slot.hide;
    }
  }
  // pinned — guarded by lockPinned. `null` unpins.
  if (slot.pinned !== undefined) {
    const currentPinned: 'left' | 'right' | null = leaf.pinned ?? null;
    if (slot.pinned !== currentPinned) {
      if (!locks.lockPinnedOf(colId)) {
        const next: 'left' | 'right' | undefined = slot.pinned === null ? undefined : slot.pinned;
        changes.push({ colId, kind: 'pinned', oldValue: currentPinned, newValue: slot.pinned });
        leaf.pinned = next;
      }
    }
  }
  // sort — change records carry the request; the cgrid layer rebuilds the
  // SortModel from the union of all sort entries (sorted by sortIndex).
  if (slot.sort !== undefined) {
    changes.push({
      colId, kind: 'sort',
      oldValue: null,
      newValue: { direction: slot.sort, index: slot.sortIndex ?? null },
    });
  }
  // Opaque round-trip slots — stored, no event surface yet.
  if (slot.rowGroup !== undefined) leaf.rowGroup = slot.rowGroup;
  if (slot.rowGroupIndex !== undefined) leaf.rowGroupIndex = slot.rowGroupIndex;
  if (slot.pivot !== undefined) leaf.pivot = slot.pivot;
  if (slot.pivotIndex !== undefined) leaf.pivotIndex = slot.pivotIndex;
  if (slot.aggFunc !== undefined) {
    leaf.aggFunc = slot.aggFunc === null ? undefined : slot.aggFunc;
  }
}

/** Deep clone so `resetColumnState` can replay the snapshot any number of
 *  times without aliasing the live state. */
export function cloneStateForReset(state: CColumnState[]): CColumnState[] {
  return state.map((entry) => ({ ...entry }));
}
