/**
 * Pure group-membership mutation core for `(CColDef | CColGroupDef)[]` trees.
 *
 * These two functions are the shared engine behind `VelocityGridApi.moveColumnToGroup`
 * / `VelocityGridApi.moveColumnGroup` (Columns tool panel hierarchy drag, Task 1).
 * They never touch `Date.now()` / `Math.random()` and never mint a new
 * `groupId` — moving a leaf "out" always means the top level (`targetGroupId:
 * null`), never a freshly-created group. Every function is a pure
 * clone-transform-validate: the input tree is deep-cloned via `cloneDefsTree`
 * (function-safe — see its doc comment in `columnTree.ts`), mutated in
 * place on the clone, then handed to `resolveColumnTree` as a structural
 * validity check (duplicate ids / empty groups would throw there). A `null`
 * return means "rejected — caller should no-op": unknown col/group ids,
 * unknown target, a `marryChildren` guard rejecting a re-parent, moving a
 * group into itself or one of its own descendants, or a move that produces
 * no actual change.
 */
import type { CColDef, CColGroupDef } from '../types';
import { cloneDefsTree, ensureGroupIds, isColGroupDef, resolveColumnTree } from './columnTree';

export type ColDefsTree = (CColDef | CColGroupDef)[];

export interface MutationResult {
  defs: ColDefsTree;
  leafOrder: string[];
}

type TreeNode = CColDef | CColGroupDef;

const clone = <T>(x: T): T => cloneDefsTree(x);

/** A def's identifying key — `colId` for leaves, falling back to `field`
 *  (mirrors `resolveColDef`'s own colId derivation). */
const leafId = (d: CColDef): string => (d.colId ?? d.field) as string;

interface FoundLeaf {
  node: CColDef;
  parentChildren: TreeNode[];
  parentGroup: CColGroupDef | null;
}

interface FoundGroup {
  node: CColGroupDef;
  parentChildren: TreeNode[];
  parentGroup: CColGroupDef | null;
}

interface TargetChildren {
  children: TreeNode[];
  group: CColGroupDef | null;
}

/** Depth-first search for a leaf by colId. Returns the leaf node, the
 *  sibling array it currently lives in, and its immediate parent group
 *  (`null` at top level). */
function findLeaf(defs: TreeNode[], colId: string, parentGroup: CColGroupDef | null = null): FoundLeaf | null {
  for (const node of defs) {
    if (isColGroupDef(node)) {
      const found = findLeaf(node.children, colId, node);
      if (found) return found;
    } else if (leafId(node) === colId) {
      return { node, parentChildren: defs, parentGroup };
    }
  }
  return null;
}

/** Depth-first search for a group by groupId. Returns the group node, the
 *  sibling array it currently lives in, and its immediate parent group. */
function findGroup(defs: TreeNode[], groupId: string, parentGroup: CColGroupDef | null = null): FoundGroup | null {
  for (const node of defs) {
    if (isColGroupDef(node)) {
      if (node.groupId === groupId) return { node, parentChildren: defs, parentGroup };
      const found = findGroup(node.children, groupId, node);
      if (found) return found;
    }
  }
  return null;
}

/** Resolve a move target: `null` = top level (the root `defs` array, no
 *  enclosing group); otherwise the named group's `children` array. */
function findGroupChildren(defs: TreeNode[], groupId: string): TargetChildren | null {
  const found = findGroup(defs, groupId);
  if (!found) return null;
  return { children: found.node.children, group: found.node };
}

/** Every groupId in `node`'s own subtree, including itself (for a group)
 *  or none (for a leaf). Used to reject "move a group into its own
 *  descendant". */
function collectGroupIds(node: TreeNode, out: Set<string>): void {
  if (!isColGroupDef(node)) return;
  out.add(node.groupId as string);
  for (const child of node.children) collectGroupIds(child, out);
}

/** Insert `node` into `arr` before the sibling whose leaf/group id matches
 *  `beforeId`; appends to the end when `beforeId` is omitted or not found
 *  among the current siblings. */
function insertBefore(arr: TreeNode[], node: TreeNode, beforeId?: string): void {
  if (beforeId !== undefined) {
    const idx = arr.findIndex((n) => (isColGroupDef(n) ? n.groupId === beforeId : leafId(n) === beforeId));
    if (idx >= 0) {
      arr.splice(idx, 0, node);
      return;
    }
  }
  arr.push(node);
}

/** Recursively drop any `CColGroupDef` whose `children` array is empty
 *  after a removal — cascades (a group emptied by removing its last child
 *  group also disappears). */
function removeEmptyGroups(defs: TreeNode[]): void {
  for (let i = defs.length - 1; i >= 0; i--) {
    const node = defs[i]!;
    if (!isColGroupDef(node)) continue;
    removeEmptyGroups(node.children);
    if (node.children.length === 0) defs.splice(i, 1);
  }
}

const isMarried = (group: CColGroupDef | null | undefined): boolean => group?.marryChildren === true;

/** Structural equality on the cloned trees — used to detect a would-be
 *  no-op move (e.g. "insert before the sibling that's already right
 *  after it"). */
function sameShape(a: TreeNode[], b: TreeNode[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Re-parent (or reorder) a single leaf column.
 *
 * @param defsIn the current columnDefs tree (not mutated — cloned internally).
 * @param colId the leaf to move.
 * @param targetGroupId the destination group's id, or `null` for top level.
 * @param beforeColId when set, the leaf/group id `colId` should land before
 *   within the target's children; omitted/unmatched → append at the end.
 * @returns `{ defs, leafOrder }` on success, `null` when rejected/no-op.
 */
export function moveColumnToGroup(
  defsIn: ColDefsTree,
  colId: string,
  targetGroupId: string | null,
  beforeColId?: string,
): MutationResult | null {
  // Normalize FIRST — a group authored without an explicit `groupId` (a
  // legal ag-grid pattern) still needs an id that `findGroup`/
  // `findGroupChildren` can match against. `ensureGroupIds` synthesizes
  // the SAME `vg-grp-N` ids `resolveColumnTree` (and the panel's own
  // `data-group-id` rendering) would assign, so a caller passing the
  // panel-synthesized id as `targetGroupId` resolves correctly. Kept as
  // its own clone (`normalizedIn`) — the no-op check below compares
  // against this normalized baseline, not the raw un-normalized input, so
  // id-stabilization alone never masquerades as a real move.
  const normalizedIn = ensureGroupIds(defsIn) as TreeNode[];
  const defs = clone(normalizedIn) as TreeNode[];
  const found = findLeaf(defs, colId);
  if (!found) return null;

  const target: TargetChildren | null =
    targetGroupId === null ? { children: defs, group: null } : findGroupChildren(defs, targetGroupId);
  if (!target) return null;

  const sourceGroupId = found.parentGroup?.groupId ?? null;
  const isReparent = sourceGroupId !== targetGroupId;
  if (isReparent && (isMarried(found.parentGroup) || isMarried(target.group))) return null;

  // Remove from its current position.
  const idx = found.parentChildren.indexOf(found.node);
  found.parentChildren.splice(idx, 1);
  // Insert at the new position.
  insertBefore(target.children, found.node, beforeColId);
  removeEmptyGroups(defs);

  let leafOrder: string[];
  try {
    leafOrder = resolveColumnTree(defs).leaves.map((l) => l.colId);
  } catch {
    return null;
  }
  if (sameShape(normalizedIn, defs)) return null;
  return { defs, leafOrder };
}

/**
 * Re-parent (or reorder) a whole column group.
 *
 * @param defsIn the current columnDefs tree (not mutated — cloned internally).
 * @param groupId the group to move.
 * @param targetParentGroupId the destination parent group's id, or `null`
 *   for top level.
 * @param beforeId when set, the leaf/group id `groupId` should land before
 *   within the target's children; omitted/unmatched → append at the end.
 * @returns `{ defs, leafOrder }` on success, `null` when rejected/no-op.
 */
export function moveColumnGroup(
  defsIn: ColDefsTree,
  groupId: string,
  targetParentGroupId: string | null,
  beforeId?: string,
): MutationResult | null {
  // See `moveColumnToGroup` above — normalize anonymous-group ids first so
  // both the moved group's own id and `targetParentGroupId` resolve, and
  // compare the no-op check against the normalized baseline.
  const normalizedIn = ensureGroupIds(defsIn) as TreeNode[];
  const defs = clone(normalizedIn) as TreeNode[];
  const found = findGroup(defs, groupId);
  if (!found) return null;

  // Reject moving a group into itself or one of its own descendants.
  const ownIds = new Set<string>();
  collectGroupIds(found.node, ownIds);
  if (targetParentGroupId !== null && ownIds.has(targetParentGroupId)) return null;

  const target: TargetChildren | null =
    targetParentGroupId === null ? { children: defs, group: null } : findGroupChildren(defs, targetParentGroupId);
  if (!target) return null;

  const sourceParentGroupId = found.parentGroup?.groupId ?? null;
  const isReparent = sourceParentGroupId !== targetParentGroupId;
  if (isReparent && (isMarried(found.parentGroup) || isMarried(target.group))) return null;

  const idx = found.parentChildren.indexOf(found.node);
  found.parentChildren.splice(idx, 1);
  insertBefore(target.children, found.node, beforeId);
  removeEmptyGroups(defs);

  let leafOrder: string[];
  try {
    leafOrder = resolveColumnTree(defs).leaves.map((l) => l.colId);
  } catch {
    return null;
  }
  if (sameShape(normalizedIn, defs)) return null;
  return { defs, leafOrder };
}
