// groupDropTarget — pure drop-target resolver for a column-GROUP header
// drag. Companion to `computeDropTargetIndex` in `columnDrag.ts` (which
// resolves a single-leaf drop), but a group drag can land at ANY depth in
// the header hierarchy — the target may be the top level, an existing
// group (re-nest), or a specific position within a group's children.
//
// The resolution rule: find the insertion GAP nearest the pointer (the
// same "before/after center" rule `computeDropTargetIndex` uses), then take
// the two leaves flanking that gap and compute the DEEPEST COMMON GROUP of
// their ancestor paths. That common group — minus the moving group itself
// or any of its descendants (a group can never be dropped inside itself) —
// is the landing parent; the child of that parent on the right side of the
// gap is the `beforeId` insertion point.
//
// Grid Layouts / column-group-drag feature, Task 1.

/** One visible leaf column's horizontal slot + its ancestor group path
 *  (root→parent). Built per-drag-tick by `columnDrag.ts`'s
 *  `buildHeaderSlots`, which maps `VelocityGridLike.allColIds()` through
 *  `columnLeftOf` / `columnWidthOf` / `getColGroupPath`. */
export interface HeaderLeafSlot {
  colId: string;
  left: number;
  width: number;
  groupPath: string[];
}

export interface GroupDropTarget {
  targetParentGroupId: string | null;
  beforeId?: string;
}

/** Resolve where a dragged group lands. `movingDescendantGroupIds` = the
 *  moving group's id + all its descendant group ids (unused by the
 *  resolution logic below — kept for signature stability with callers that
 *  already compute it via `getGroupDescendantIds` for other purposes).
 *  Returns `null` for a no-op / illegal drop (the gap sits inside the
 *  moving group's own span — dropping a group anywhere within itself,
 *  including within a nested sub-group, is always a no-op). Pure — no DOM,
 *  no `Date`/`Math.random`. */
export function computeGroupDropTarget(
  slots: HeaderLeafSlot[],
  movingGroupId: string,
  _movingDescendantGroupIds: ReadonlySet<string>,
  pointerX: number,
): GroupDropTarget | null {
  if (slots.length === 0) return null;
  // 1. gap index in [0..slots.length]: number of leaves whose center is < pointerX.
  let gap = 0;
  for (const s of slots) { if (pointerX >= s.left + s.width / 2) gap++; else break; }
  const left = gap > 0 ? slots[gap - 1] : null;
  const right = gap < slots.length ? slots[gap] : null;
  // True for any leaf under the moving group OR under one of its
  // sub-groups — the moving group's id sits in the ancestor `groupPath` of
  // every leaf in its subtree, at whatever depth.
  const inMoving = (s: HeaderLeafSlot | null) => s != null && s.groupPath.includes(movingGroupId);

  // 2. Illegal / no-op drop: the gap sits inside the moving group's own
  //    span. Three shapes, all rejected BEFORE the common-prefix
  //    computation below (so the moving group can never end up inside
  //    `common` in the first place):
  //    - both flanking leaves belong to the moving group (gap strictly
  //      inside it, at any depth — top-level or nested);
  //    - only a LEFT neighbour exists and it belongs to the moving group
  //      (gap at the tail end of the moving group's span, header ends
  //      there);
  //    - only a RIGHT neighbour exists and it belongs to the moving group
  //      (gap at the head end of the moving group's span, header starts
  //      there).
  if (left && right && inMoving(left) && inMoving(right)) return null;
  if (left && !right && inMoving(left)) return null;
  if (right && !left && inMoving(right)) return null;

  // 3. deepest common group of the two neighbour paths (root→parent). The
  //    guards above guarantee the moving group (or a descendant) can never
  //    appear in this common prefix: if it did, both neighbours would
  //    share it as an ancestor and so both be `inMoving`, which is already
  //    handled above.
  const lp = left ? left.groupPath : [];
  const rp = right ? right.groupPath : [];
  const common: string[] = [];
  for (let i = 0; i < Math.min(lp.length, rp.length); i++) {
    if (lp[i] !== rp[i]) break;
    common.push(lp[i]!);
  }

  const targetParentGroupId = common.length > 0 ? common[common.length - 1]! : null;

  // 4. beforeId = the child of targetParent on the RIGHT side of the gap:
  //    the next group after `common` in right's path, else the right leaf
  //    itself.
  const beforeId: string | undefined = right
    ? (common.length < rp.length ? rp[common.length]! : right.colId)
    : undefined; // no right neighbour — append at the end of targetParent
  return { targetParentGroupId, beforeId };
}
