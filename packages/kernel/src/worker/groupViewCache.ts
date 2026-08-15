// A-P2 (production hardening) — per-generation memo for the grouped
// viewport walks.
//
// Every `getViewport` under grouping used to re-materialise BOTH the
// collapse-aware visible order (`computeGroupVisibleOrder`, O(flatOrder),
// allocating an entry array as long as the visible row count) AND the
// composite-key → group-meta lookup (`buildGroupMetaLookup`, a full
// recursive walk of the group tree allocating a Map entry per node) — on
// every scroll fetch, with zero data change. `effectiveExpandedKeys()`
// added a third full `flatOrder` walk plus a Set the size of the group
// count whenever the grid is in the "default = all expanded" sentinel
// state. A pure scroll over an idle grouped grid therefore paid three
// O(N) rebuilds per frame.
//
// All three are pure functions of state the pipeline REPLACES wholesale
// rather than mutating in place:
//
//   • `state.groupOutput`  — assigned fresh from `GroupPass.apply` /
//     `SortPass.applyGrouped` on every `buildVisibleAsync`, never mutated
//     afterwards (worker.ts :211/:228/:287).
//   • `state.expandedKeys` — only ever ASSIGNED (`null` sentinel,
//     `new Set(payload.keys)`, or `computeDefaultExpandedKeys(...)`); no
//     call site does `.add` / `.delete` / `.clear` on it
//     (handlers/group.ts :37/:53/:75, worker.ts :221).
//   • `state.columns`      — replaced wholesale by `updateColumns`
//     (handlers/dataPipeline.ts :345).
//
// So an identity-equal key provably implies an identical result, and the
// memo cannot serve a stale walk. Each cached shape ALSO keys on the
// boolean arguments its producer takes, so two callers that pass
// different flags (e.g. `getViewport` passes `suppressLeafRows` from
// `isPivotActive()` while `buildVisibleIndexResolver` takes the default)
// can never be served each other's entry — the memo returns exactly what
// the un-memoized call would have returned at that site.

import { computeGroupVisibleOrder, type VisibleRowEntry } from './viewportSlicer';
import type { GroupNode, GroupPassOutput } from './passes/groupPass';
import type { WorkerColumn } from './protocol';

/** Per-group chrome the slicer + sticky band + autosize all read. Same
 *  shape `WorkerHelpers.buildGroupMetaLookup` produces. */
export interface GroupMetaEntry {
  value: string;
  childCount: number;
  isExpanded: boolean;
  colId: string;
}

/** The three memo slots. Held as ONE `State` field so the worker's state
 *  object grows by a single property. */
export interface GroupViewCaches {
  expanded: {
    groupOutput: GroupPassOutput | null;
    explicit: ReadonlySet<string> | null;
    value: Set<string>;
  } | null;
  order: {
    groupOutput: GroupPassOutput;
    explicit: ReadonlySet<string> | null;
    hideOpenParents: boolean;
    suppressLeafRows: boolean;
    value: readonly VisibleRowEntry[];
  } | null;
  meta: {
    groupOutput: GroupPassOutput;
    explicit: ReadonlySet<string> | null;
    columns: readonly WorkerColumn[];
    value: ReadonlyMap<string, GroupMetaEntry>;
  } | null;
}

export function createGroupViewCaches(): GroupViewCaches {
  return { expanded: null, order: null, meta: null };
}

/**
 * Memoized `effectiveExpandedKeys`. `explicit` is `state.expandedKeys`
 * verbatim — when non-null it IS the answer (returned by identity, exactly
 * as the un-memoized helper did); when null the all-keys set is derived
 * from `groupOutput.flatOrder`.
 *
 * The returned Set is SHARED across calls — treat it as read-only. Every
 * in-repo consumer (`computeGroupVisibleOrder`,
 * `computeGroupVisibleRowCount`, `buildGroupMetaLookup`) only reads it.
 */
export function cachedEffectiveExpandedKeys(
  caches: GroupViewCaches,
  groupOutput: GroupPassOutput | null,
  explicit: Set<string> | null,
): Set<string> {
  if (explicit !== null) return explicit;
  const hit = caches.expanded;
  if (hit !== null && hit.groupOutput === groupOutput && hit.explicit === null) {
    return hit.value;
  }
  const out = new Set<string>();
  if (groupOutput !== null) {
    for (const e of groupOutput.flatOrder) {
      if (e.kind === 'group') out.add(e.key);
    }
  }
  caches.expanded = { groupOutput, explicit: null, value: out };
  return out;
}

/**
 * Memoized `computeGroupVisibleOrder`. `explicit` is `state.expandedKeys`
 * (the raw nullable field, NOT the materialised effective set — that one
 * is derived from `groupOutput` and so is already covered by the
 * `groupOutput` identity).
 *
 * The returned array is SHARED across calls — treat it as read-only.
 * Every consumer (`sliceGroupedViewport`, `computeStickyAncestors`,
 * `buildVisibleIndexResolver`, `findVisibleIndexForGroup`) declares it
 * `readonly VisibleRowEntry[]`.
 */
export function cachedGroupVisibleOrder(
  caches: GroupViewCaches,
  groupOutput: GroupPassOutput,
  explicit: Set<string> | null,
  effectiveExpandedKeys: ReadonlySet<string>,
  hideOpenParents: boolean,
  suppressLeafRows: boolean,
): readonly VisibleRowEntry[] {
  const hit = caches.order;
  if (
    hit !== null
    && hit.groupOutput === groupOutput
    && hit.explicit === explicit
    && hit.hideOpenParents === hideOpenParents
    && hit.suppressLeafRows === suppressLeafRows
  ) {
    return hit.value;
  }
  const value = computeGroupVisibleOrder(
    groupOutput.flatOrder, effectiveExpandedKeys, hideOpenParents, suppressLeafRows,
  );
  caches.order = { groupOutput, explicit, hideOpenParents, suppressLeafRows, value };
  return value;
}

/**
 * Memoized `buildGroupMetaLookup`. `build` is the worker helper closure —
 * injected rather than imported so this module stays free of the
 * `worker.ts` ↔ handler import cycle, and so the memo can never diverge
 * from the one implementation that produces the lookup.
 *
 * The returned Map is SHARED across calls — treat it as read-only.
 */
export function cachedGroupMetaLookup(
  caches: GroupViewCaches,
  groupOutput: GroupPassOutput,
  columns: readonly WorkerColumn[],
  explicit: Set<string> | null,
  effectiveExpandedKeys: ReadonlySet<string>,
  build: (
    roots: readonly GroupNode[],
    columns: readonly WorkerColumn[],
    expandedKeys: ReadonlySet<string>,
  ) => Map<string, GroupMetaEntry>,
): ReadonlyMap<string, GroupMetaEntry> {
  const hit = caches.meta;
  if (
    hit !== null
    && hit.groupOutput === groupOutput
    && hit.explicit === explicit
    && hit.columns === columns
  ) {
    return hit.value;
  }
  const value = build(groupOutput.roots, columns, effectiveExpandedKeys);
  caches.meta = { groupOutput, explicit, columns, value };
  return value;
}
