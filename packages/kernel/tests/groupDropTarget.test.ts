import { describe, it, expect } from 'vitest';
import { computeGroupDropTarget, type HeaderLeafSlot } from '../src/interaction/features/groupDropTarget';

const slots = (): HeaderLeafSlot[] => [
  { colId: 'a0', left: 0,   width: 100, groupPath: ['A'] },
  { colId: 'a1', left: 100, width: 100, groupPath: ['A'] },
  { colId: 'b0', left: 200, width: 100, groupPath: ['B'] },
  { colId: 'c0', left: 300, width: 100, groupPath: ['B', 'C'] },
  { colId: 'c1', left: 400, width: 100, groupPath: ['B', 'C'] },
  { colId: 't',  left: 500, width: 100, groupPath: [] },
];
const noDesc = (id: string) => new Set([id]);

describe('computeGroupDropTarget', () => {
  // Gap resolution: the insertion gap nearest pointerX sits between two leaves;
  // target parent = deepest common group of the two neighbours (minus the moving
  // group / its descendants); beforeId = the neighbour-side child at that level.
  it('dropping A before a0 (its own first leaf) is a no-op — A is already there', () => {
    // pointer at x=-10 (before everything): gap before a0. left neighbour none, right a0 ∈ A
    // (the moving group). Dropping a group in its own span is a no-op per §4.4.4.
    expect(computeGroupDropTarget(slots(), 'A', noDesc('A'), -10)).toBeNull();
  });
  it('drops A between B and t (gap at x=500 boundary) → top level, before t', () => {
    const r = computeGroupDropTarget(slots(), 'A', noDesc('A'), 500)!; // gap between c1(end of B) and t
    expect(r).toEqual({ targetParentGroupId: null, beforeId: 't' });
  });
  it('nests moving group A INTO B, before C (gap between b0 and c0, common path [B])', () => {
    const r = computeGroupDropTarget(slots(), 'A', noDesc('A'), 300)!; // gap at 300 = between b0 and c0
    expect(r).toEqual({ targetParentGroupId: 'B', beforeId: 'C' }); // nest into B, before sub-group C
  });
  it('nests A into C (gap between c0 and c1, common path [B,C])', () => {
    const r = computeGroupDropTarget(slots(), 'A', noDesc('A'), 400)!; // gap between c0 and c1
    expect(r).toEqual({ targetParentGroupId: 'C', beforeId: 'c1' });
  });
  it('appends to top level when past the last leaf', () => {
    const r = computeGroupDropTarget(slots(), 'A', noDesc('A'), 999)!;
    expect(r).toEqual({ targetParentGroupId: null, beforeId: undefined });
  });
  it('returns null when the gap is inside the moving group itself', () => {
    // moving B; gap between b0 and c0 is inside B → no-op.
    expect(computeGroupDropTarget(slots(), 'B', new Set(['B', 'C']), 300)).toBeNull();
  });
  it('skips a target that is the moving group or its descendant (gap inside the moving span) → no-op', () => {
    // moving C; gap between c0 and c1 sits strictly inside C's own span
    // (both flanking leaves belong to C) → no-op per §4.4.4, regardless of
    // whether a shallower ancestor (B) would otherwise be a legal target.
    expect(computeGroupDropTarget(slots(), 'C', new Set(['C']), 400)).toBeNull();
  });

  // Regression: FIX 1 (CRITICAL) — dropping a NESTED moving group within its
  // own span must no-op, even when it is NOT the last child of its parent
  // (so popping the common-ancestor prefix would otherwise stop at a
  // surviving ancestor instead of emptying to `[]`). Parent P = [ V[v0,v1],
  // p1, p2 ] — V is first, not last.
  it('no-ops when a nested, non-last-child moving group is dropped within its own span', () => {
    const nestedSlots: HeaderLeafSlot[] = [
      { colId: 'v0', left: 0,   width: 100, groupPath: ['P', 'V'] },
      { colId: 'v1', left: 100, width: 100, groupPath: ['P', 'V'] },
      { colId: 'p1', left: 200, width: 100, groupPath: ['P'] },
      { colId: 'p2', left: 300, width: 100, groupPath: ['P'] },
    ];
    // pointer at x=100: gap between v0 and v1, both inside V's own span.
    expect(computeGroupDropTarget(nestedSlots, 'V', new Set(['V']), 100)).toBeNull();
  });
});
