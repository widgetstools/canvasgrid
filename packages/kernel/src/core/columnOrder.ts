// Column-order primitives — pure functions consumed by ColumnDrag (Task 1),
// applyColumnState (Task 2), and the imperative moveColumns API (Task 5).
//
// `applyReorder` is the splice; `resolveLegalDropIndex` clamps a requested
// target to the nearest index that honors `lockPosition` + `marryChildren`;
// `reorderLeavesByList` rewrites the flat leaf order to match a desired
// permutation, appending unmentioned leaves in their original tree order.

import type { ColumnTree } from './columnTree';

export interface ReorderRequest {
  colId: string;
  /** Insertion index in the FLAT visible-leaf order. The actual landing
   *  index may differ if locks or marryChildren reject it — see
   *  `resolveLegalDropIndex`. */
  toIndex: number;
}

export interface ColumnOrderConstraints {
  /** Lock state of the leaf: `null` for free, `'left'` for start-locked,
   *  `'right'` for end-locked, `'self'` for "stay at current index". */
  lockOf: (colId: string) => null | 'left' | 'right' | 'self';
  /** GroupId of the marryChildren-enclosing group (if any) for a leaf;
   *  null when the leaf is ungrouped or its enclosing group does not
   *  have marryChildren. */
  marryGroupOf: (colId: string) => string | null;
  /** Leaf colIds covered by a marryChildren group. */
  leafIdsOfGroup: (groupId: string) => string[];
}

/** Resolve a requested target index into the nearest legal index that
 *  honors `lockPosition` + `marryChildren`. Returns the request's `toIndex`
 *  unchanged when no constraint applies. */
export function resolveLegalDropIndex(
  currentOrder: string[],
  req: ReorderRequest,
  constraints: ColumnOrderConstraints,
): number {
  const fromIndex = currentOrder.indexOf(req.colId);
  if (fromIndex < 0) return req.toIndex;
  const lastIdx = currentOrder.length - 1;
  let target = Math.max(0, Math.min(lastIdx, req.toIndex));

  // Lock first — strongest constraint.
  const lock = constraints.lockOf(req.colId);
  if (lock === 'left') return 0;
  if (lock === 'right') return lastIdx;
  if (lock === 'self') return fromIndex;

  // Then marryChildren — clamp to the [min, max] index range covered by
  // the enclosing group's leaves in the current order.
  const groupId = constraints.marryGroupOf(req.colId);
  if (groupId !== null) {
    const groupLeaves = constraints.leafIdsOfGroup(groupId);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const id of groupLeaves) {
      const idx = currentOrder.indexOf(id);
      if (idx < 0) continue;
      if (idx < lo) lo = idx;
      if (idx > hi) hi = idx;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      if (target < lo) target = lo;
      else if (target > hi) target = hi;
    }
  }

  // AG-Grid parity ("Groups & Column Moving"): a column from OUTSIDE a
  // marryChildren group cannot land in the MIDDLE of that group — married
  // children stay contiguous in both directions. Compute each foreign
  // married group's index span in POST-REMOVAL coordinates (the insertion
  // index is applied after the moved column is spliced out — see
  // `applyReorder`) and snap an in-span target to the nearest edge.
  const checkedGroups = new Set<string>();
  for (const id of currentOrder) {
    if (id === req.colId) continue;
    const foreignGroup = constraints.marryGroupOf(id);
    if (foreignGroup === null || foreignGroup === groupId || checkedGroups.has(foreignGroup)) continue;
    checkedGroups.add(foreignGroup);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const leafId of constraints.leafIdsOfGroup(foreignGroup)) {
      let idx = currentOrder.indexOf(leafId);
      if (idx < 0) continue;
      if (idx > fromIndex) idx -= 1; // post-removal coordinates
      if (idx < lo) lo = idx;
      if (idx > hi) hi = idx;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    // Inserting at index t places the column between post-removal elements
    // t-1 and t, so the group splits when lo < t <= hi.
    if (target > lo && target <= hi) {
      target = (target - lo <= hi + 1 - target) ? lo : hi + 1;
    }
  }

  return target;
}

/** Pure splice — returns a new colId order after applying `req`. */
export function applyReorder(currentOrder: string[], req: ReorderRequest): string[] {
  const fromIndex = currentOrder.indexOf(req.colId);
  if (fromIndex < 0) return currentOrder.slice();
  const target = Math.max(0, Math.min(currentOrder.length - 1, req.toIndex));
  if (fromIndex === target) return currentOrder.slice();
  const next = currentOrder.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Given a column tree + a partial-order list of colIds, return the
 *  rewritten flat leaf order. Leaves not mentioned keep their relative
 *  order at the end. Honors locks + marryChildren via repeated
 *  `resolveLegalDropIndex` clamps. Unknown colIds in `desiredOrder` are
 *  ignored. */
export function reorderLeavesByList(
  tree: ColumnTree,
  desiredOrder: string[],
  constraints: ColumnOrderConstraints,
): string[] {
  const originalLeafIds = Array.from(tree.leafById.keys());
  const seen = new Set<string>();
  const head: string[] = [];
  for (const id of desiredOrder) {
    if (!tree.leafById.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    head.push(id);
  }
  const tail: string[] = [];
  for (const id of originalLeafIds) {
    if (seen.has(id)) continue;
    tail.push(id);
  }
  let order = head.concat(tail);

  // Re-clamp every leaf against the constraints in declaration order so
  // any lock / marryChildren violation introduced by the desired list is
  // cleaned up. Each pass moves at most one column; we iterate until
  // stable or until we hit the upper bound (one pass per leaf).
  const maxPasses = order.length;
  for (let pass = 0; pass < maxPasses; pass++) {
    let mutated = false;
    for (const id of order.slice()) {
      const idx = order.indexOf(id);
      const legal = resolveLegalDropIndex(order, { colId: id, toIndex: idx }, constraints);
      if (legal !== idx) {
        order = applyReorder(order, { colId: id, toIndex: legal });
        mutated = true;
      }
    }
    if (!mutated) break;
  }
  return order;
}
