# Grid Header Column-Group Drag (Move + Re-nest) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a column-GROUP header in the grid to move the whole group as a unit — reorder among siblings AND re-nest into/out of other groups (ag-grid parity), committing through the merged `moveColumnGroup` API.

**Architecture:** Extend the grid's `ColumnDrag` feature (`interaction/features/columnDrag.ts`) with a `dragKind: 'leaf' | 'group'` state discriminant: a `headerGroup` hit starts a group drag with a group-spanning ghost; on drop, a new pure `computeGroupDropTarget` resolves the target group + insertion sibling from header geometry, and `grid.moveColumnGroup(groupId, targetParentGroupId, beforeId)` commits. Leaf-header drag is unchanged.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (kernel unit + integration), Playwright (demo E2E). No new deps. Canvas grid; the drag ghost/insertion line are overlay DOM.

**Spec (source of truth):** `docs/superpowers/specs/2026-07-06-grid-header-group-drag-design.md`. Read it first.

## Global Constraints

- Reuse the merged `VelocityGridApi.moveColumnGroup(groupId, targetParentGroupId, beforeId?)` (from `d694fbe`) as the ONLY commit path — it already rejects marryChildren re-nest / into-self / into-descendant / no-op moves, preserves runtime column state across the rebuild, and fires `columnDefsChanged`. Do NOT add new mutation logic.
- `computeGroupDropTarget` is a PURE function over a plain header-layout description — no DOM, no `Date.now()`/`Math.random()`.
- Leaf-header drag (`dragKind:'leaf'`) MUST remain byte-for-byte the current behavior — only ADD branches, never alter the leaf path.
- Group drags do NOT route to the pivot / row-group panels (groups aren't role columns) — skip `dispatchPanelHover` and the panel-commit branches for `dragKind:'group'`.
- Reuse the merged `ensureGroupIds` (in `core/columnTree.ts`) if a moving/target group is anonymous, so `moveColumnGroup` resolves it.
- Verification gate every task: `cd packages/kernel && npx tsc --noEmit && npm run build && npx vitest run` all green (lone `aggIncremental.perf.test.ts` red = known CPU flake; re-run standalone). Commit per task. NO per-task reviewer — SINGLE closeout review at T3. Branch `feature/grid-header-group-drag` (already created off main); don't switch.

**Key existing symbols (verified):**
- `hitTester.ts`: hit `{ kind:'headerGroup'; groupId: string; colId: string }` is produced for group-header cells; leaf = `{ kind:'header'; colId }`.
- `columnDrag.ts` (472 lines): `handleMouseDown` (only `kind==='header'` today, line 160), `handleMouseDrag` (threshold → `DraggingState` w/ `createGhostHeader`/`createInsertionLine`/`createPillGhost`), `handleMouseUp` (`computeDropTargetIndex` → `grid.reorderColumn(colId, target, 'uiColumnDragged')`; pivot/row-group panel commit branches first), `dispatchPanelHover`, `updateHeaderGhostPosition`, `updateInsertionLinePosition`. `DraggingState`/`PressedState` carry `colId`.
- `feature.ts` `VelocityGridLike` surface (what `ctx.grid` exposes to the feature): `allColIds()`, `columnLeftOf(colId)`, `columnWidthOf(colId)`, `getColDef(colId)`, `getHeaderName(colId)`, `getLeafHeaderHeight()`, `getLeafHeaderTop()`, `getOverlayHost()`, `reorderColumn(...)`. NO group accessors yet.
- `VelocityGridApi` (on the real `VelocityGrid`): `moveColumnGroup(groupId, targetParentGroupId, beforeId?)`, `getColumnGroupDefs()`.
- `core/columnTree.ts`: `resolveColumnTree(defs)` → `ColumnTree { roots, leafById, groupById }`; `ResolvedColGroupDef { groupId, marryChildren, depth, children, leafColIds }`; `ResolvedColLeaf { colDef, groupPath: string[] }` (`groupPath` = ancestor groupIds root→parent). `ensureGroupIds(defs)`.

---

### Task 1: `computeGroupDropTarget` (pure) + group-drag start/ghost/reorder commit

**Files:**
- Create: `packages/kernel/src/interaction/features/groupDropTarget.ts`
- Create: `packages/kernel/tests/groupDropTarget.test.ts`
- Modify: `packages/kernel/src/interaction/features/columnDrag.ts` (state discriminant; `headerGroup` mousedown branch; group ghost; group commit)
- Modify: `packages/kernel/src/interaction/feature.ts` (`VelocityGridLike`: add group accessors)
- Modify: `packages/kernel/src/velocityGrid.ts` (implement the new `VelocityGridLike` accessors)
- Create: `packages/kernel/tests/columnGroupHeaderDrag.integration.test.ts`

**Interfaces:**
- Produces (pure module `groupDropTarget.ts`):
  ```ts
  /** One visible leaf column's horizontal slot + its ancestor group path (root→parent). */
  export interface HeaderLeafSlot { colId: string; left: number; width: number; groupPath: string[]; }
  export interface GroupDropTarget { targetParentGroupId: string | null; beforeId?: string; }
  /** Resolve where a dragged group lands. `movingDescendantGroupIds` = the moving
   *  group's id + all its descendant group ids (targets inside it are rejected).
   *  Returns null for a no-op / illegal drop (gap inside the moving group). */
  export function computeGroupDropTarget(
    slots: HeaderLeafSlot[], movingGroupId: string,
    movingDescendantGroupIds: ReadonlySet<string>, pointerX: number,
  ): GroupDropTarget | null;
  ```
- Produces (`VelocityGridLike` additions, implemented on `VelocityGrid`):
  ```ts
  getGroupLeafColIds(groupId: string): string[];        // ALL leaves under groupId, render order
  getGroupHeaderName(groupId: string): string | undefined;
  getColGroupPath(colId: string): string[];             // ancestor groupIds root→parent for a leaf
  getGroupDescendantIds(groupId: string): string[];     // groupId + all descendant group ids
  moveColumnGroup(groupId: string, targetParentGroupId: string | null, beforeId?: string): void;
  ```

- [ ] **Step 1: Write failing tests for `computeGroupDropTarget`**

Create `packages/kernel/tests/groupDropTarget.test.ts`. Model layout: 6 leaves each width 100 (centers at 50,150,…). Groups: `A[a0,a1]`, `B[b0, C[c0,c1]]`, top-level `t`. So slots (left→right): a0(gp:[A]), a1(gp:[A]), b0(gp:[B]), c0(gp:[B,C]), c1(gp:[B,C]), t(gp:[]).
```ts
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
  it('reorders group A to the front (gap before a0) → top level, before A-side child', () => {
    // pointer at x=-10 (before everything): gap before a0. left neighbour none, right a0(gp [A]).
    const r = computeGroupDropTarget(slots(), 'A', noDesc('A'), -10)!;
    expect(r).toEqual({ targetParentGroupId: null, beforeId: 'A' }); // before group A (its first leaf's top group)
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
  it('skips a target that is the moving group or its descendant (uses next-shallower common group)', () => {
    // moving C; gap between c0 and c1 would be [B,C] but C is the moving group →
    // fall to B; both neighbours are under B → nest into B before c1.
    const r = computeGroupDropTarget(slots(), 'C', new Set(['C']), 400)!;
    expect(r).toEqual({ targetParentGroupId: 'B', beforeId: 'c1' });
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail** — Run: `cd packages/kernel && npx vitest run tests/groupDropTarget.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `groupDropTarget.ts`**

Create the pure module. Algorithm: find the insertion GAP nearest `pointerX` (the boundary between adjacent leaf centers — same "before/after center" rule as `computeDropTargetIndex`), take the left/right neighbour `groupPath`s, compute their longest common prefix, drop any trailing group in that prefix that is the moving group or a descendant, and resolve `targetParentGroupId` + `beforeId`:
```ts
import type { /* only local types */ } from '../feature';
export interface HeaderLeafSlot { colId: string; left: number; width: number; groupPath: string[]; }
export interface GroupDropTarget { targetParentGroupId: string | null; beforeId?: string; }

export function computeGroupDropTarget(
  slots: HeaderLeafSlot[], movingGroupId: string,
  movingDescendantGroupIds: ReadonlySet<string>, pointerX: number,
): GroupDropTarget | null {
  if (slots.length === 0) return null;
  // 1. gap index in [0..slots.length]: number of leaves whose center is < pointerX.
  let gap = 0;
  for (const s of slots) { if (pointerX >= s.left + s.width / 2) gap++; else break; }
  const left = gap > 0 ? slots[gap - 1] : null;
  const right = gap < slots.length ? slots[gap] : null;
  // 2. no-op if BOTH neighbours are inside the moving group (gap within it).
  const inMoving = (s: HeaderLeafSlot | null) => s != null && s.groupPath.includes(movingGroupId);
  if (left && right && inMoving(left) && inMoving(right)) return null;
  if (left && !right && inMoving(left)) return null;
  if (right && !left && inMoving(right)) return null;
  // 3. deepest common group of the two neighbour paths (root→parent), minus moving/descendants.
  const lp = left ? left.groupPath : [];
  const rp = right ? right.groupPath : [];
  const common: string[] = [];
  for (let i = 0; i < Math.min(lp.length, rp.length); i++) {
    if (lp[i] !== rp[i]) break;
    common.push(lp[i]!);
  }
  while (common.length > 0 && movingDescendantGroupIds.has(common[common.length - 1]!)) common.pop();
  const targetParentGroupId = common.length > 0 ? common[common.length - 1]! : null;
  // 4. beforeId = the child of targetParent on the RIGHT side of the gap:
  //    the next group after `common` in right's path, else the right leaf itself.
  let beforeId: string | undefined;
  if (right) {
    beforeId = rp.length > common.length ? rp[common.length]! : right.colId;
  } else {
    beforeId = undefined; // append at the end of targetParent
  }
  // 5. no-op guard: dropping a group exactly where it already sits is caught by
  //    moveColumnGroup (returns without event); computeGroupDropTarget may still
  //    return a target — that's fine, the commit no-ops.
  return { targetParentGroupId, beforeId };
}
```
Note the Step-1 test `beforeId: 'A'` for the "front" case: when `right` is `a0` with path `['A']` and `common` is `[]`, `beforeId = rp[0] = 'A'` (the group on the right side) — matches.

- [ ] **Step 4: Run the tests, verify they pass** — Run: `cd packages/kernel && npx vitest run tests/groupDropTarget.test.ts` — Expected: PASS. If a case is off, adjust the gap/beforeId logic (not the test expectations, which encode the spec's resolution rule).

- [ ] **Step 5: Add the `VelocityGridLike` group accessors + implement on `VelocityGrid`**

In `feature.ts` add to `VelocityGridLike` (with JSDoc) the five signatures from the Interfaces block. In `velocityGrid.ts`, implement them where the other `VelocityGridLike` methods are realized (search the object literal / class methods that back `allColIds`/`columnLeftOf`):
- `getGroupLeafColIds(groupId)` → `this.columnTree.groupById.get(groupId)?.leafColIds.slice() ?? []`.
- `getGroupHeaderName(groupId)` → `this.columnTree.groupById.get(groupId)?.headerName`.
- `getColGroupPath(colId)` → the resolved leaf's `groupPath` (walk `this.columnTree` roots, or read a `leafById`-adjacent structure; if the tree exposes `ResolvedColLeaf.groupPath` only via `roots`, add a `leafGroupPath` map at tree-build or walk once). Return `[]` for unknown/ungrouped.
- `getGroupDescendantIds(groupId)` → BFS/DFS over `groupById.get(groupId)` collecting its groupId + every descendant group's id.
- `moveColumnGroup(groupId, targetParentGroupId, beforeId?)` → delegate to `this.moveColumnGroup` API method (the VelocityGrid class already has it — if the class method and the `VelocityGridLike` member collide by name, the class method already satisfies the interface; just ensure `VelocityGridLike` declares it).

- [ ] **Step 6: Wire group-drag into `columnDrag.ts` (start + ghost + reorder commit)**

1. `PressedState`/`DraggingState`: add `dragKind: 'leaf' | 'group'`; for group add `groupId: string` and `leafColIds: string[]`. Keep `colId` for leaf.
2. `handleMouseDown`: after the leaf branch, add:
   ```ts
   if (ctx.hit.kind === 'headerGroup') {
     const leafColIds = ctx.grid.getGroupLeafColIds(ctx.hit.groupId);
     // movable unless any leaf is lockPosition or the (future) group is suppressed
     const movable = leafColIds.length > 0 && leafColIds.every(id => (ctx.grid.getColDef(id)?.lockPosition ?? null) === null);
     if (!movable) { super.handleMouseDown(ctx); return; }
     const groupLeft = ctx.grid.columnLeftOf(leafColIds[0]!);
     this.state = { kind:'pressed', dragKind:'group', groupId: ctx.hit.groupId, leafColIds,
       colId: leafColIds[0]!, startX: ctx.point.x, startY: ctx.point.y,
       grabOffsetX: groupLeft === null ? 0 : ctx.point.x - groupLeft };
     return; // consume
   }
   ```
   (Keep `colId` populated with the first leaf so shared helpers that read `state.colId` still work.)
3. `handleMouseDrag` (threshold → dragging): branch on `dragKind`. For group: build the ghost via a new `createGroupGhostHeader(ctx, groupId, leafColIds)` (a span-width ghost). Do NOT create/track the `pillGhost` for groups; skip `dispatchPanelHover`.
4. `createGroupGhostHeader(ctx, groupId, leafColIds)`: width = Σ `columnWidthOf(id)` over `leafColIds` (skip nulls); height = `getLeafHeaderHeight()`; label = `getGroupHeaderName(groupId) ?? groupId`; mount on the overlay host (mirror `createGhostHeader`).
5. `updateHeaderGhostPosition` / `updateInsertionLinePosition`: for group drags, position the insertion line at the resolved GAP (see step 6). `updateHeaderGhostPosition` works unchanged (translates by `grabOffsetX`).
6. Add `buildHeaderSlots(ctx): HeaderLeafSlot[]` — map `ctx.grid.allColIds()` to `{ colId, left: columnLeftOf, width: columnWidthOf, groupPath: getColGroupPath }`, filtering out columns with null left/width. For group drags, `updateInsertionLinePosition` calls `computeGroupDropTarget(buildHeaderSlots(ctx), groupId, new Set(getGroupDescendantIds(groupId)), ctx.point.x)` and draws the line at the gap boundary X (left edge of the `beforeId`'s slot, or the right edge of the last slot when `beforeId` is undefined).
7. `handleMouseUp`: branch on `dragKind`. For group: SKIP the pivot/row-group panel commit branches; compute `const t = computeGroupDropTarget(buildHeaderSlots(ctx), state.groupId, new Set(ctx.grid.getGroupDescendantIds(state.groupId)), ctx.point.x); if (t) ctx.grid.moveColumnGroup(state.groupId, t.targetParentGroupId, t.beforeId);` then `this.suppressNextClick = true`. Leaf path unchanged.
8. `handleMouseMove` cursor hint: also show `'grab'` when hovering a `headerGroup` hit on a movable group.

- [ ] **Step 7: Write a failing kernel integration test**

Create `packages/kernel/tests/columnGroupHeaderDrag.integration.test.ts` (mount a real `VelocityGrid` with the fake-worker+canvas harness — copy the `beforeAll` block from `tests/rulesApiKernel.integration.test.ts`). Columns: `[ grp('A',[a0,a1]), grp('B',[b0,b1]), c ]`. Drive the feature by dispatching synthetic header pointer events (find how existing header-drag tests simulate mousedown/drag/up — grep `columnDrag`/`reorderColumn` under `packages/kernel/tests` for the harness; reuse it). Assert:
```ts
it('dragging group A past group B reorders A after B', async () => {
  const grid = await mount();
  // simulate: mousedown on A's group header, drag to x beyond B, mouseup
  dragGroupHeader(grid, 'A', /*toX*/ farRightOfB);
  const order = grid.getColumnGroupDefs().map((d:any)=> d.groupId ?? (d.colId ?? d.field));
  expect(order.indexOf('A')).toBeGreaterThan(order.indexOf('B'));
  grid.destroy();
});
it('a marryChildren group re-nest is a no-op', async () => { /* moveColumnGroup rejects → defs unchanged */ });
```
(If a header-drag simulation helper doesn't exist, build a minimal one that calls the feature's `handleMouseDown/Drag/Up` with synthetic `VelocityGridEventCtx`, mirroring an existing `columnDrag` unit/integration test.)

- [ ] **Step 8: Run the integration test + full suite, verify green** — Run: `cd packages/kernel && npx vitest run tests/columnGroupHeaderDrag.integration.test.ts && npx tsc --noEmit && npm run build && npx vitest run` — Expected: PASS; suite green.

- [ ] **Step 9: Commit**
```bash
git add packages/kernel/src/interaction packages/kernel/src/velocityGrid.ts packages/kernel/tests/groupDropTarget.test.ts packages/kernel/tests/columnGroupHeaderDrag.integration.test.ts
git commit -m "feat(kernel): drag a column-group header to move/re-nest the group (T1)"
```

---

### Task 2: Drop indicators + reject affordance + re-nest polish

**Files:**
- Modify: `packages/kernel/src/interaction/features/columnDrag.ts` (indicator during group drag; reject cursor)
- Modify: the column-drag CSS (grep `INSERTION_LINE_CLASS` / `GHOST_HEADER_CLASS` → the stylesheet) — add a target-group highlight + reject state if needed
- Modify: `packages/kernel/tests/groupDropTarget.test.ts` (add reject-dry-run cases if new logic added)
- Modify: `packages/kernel/tests/columnGroupHeaderDrag.integration.test.ts` (re-nest into/out assertions)

**Interfaces:** Consumes T1's `computeGroupDropTarget` + `moveColumnGroup`. No new exported API.

- [ ] **Step 1: Write failing integration tests for re-nest into/out**
Add to `columnGroupHeaderDrag.integration.test.ts`:
```ts
it('dragging group A into group B nests it (getColumnGroupDefs shows A under B)', async () => {
  const grid = await mount(); // [A[a0,a1], B[b0,b1], c]
  dragGroupHeader(grid, 'A', /*x inside B, between b0 and b1*/ midOfB);
  const B = grid.getColumnGroupDefs().find((d:any)=>d.groupId==='B') as any;
  expect(B.children.some((ch:any)=> ch.groupId==='A')).toBe(true);
  grid.destroy();
});
it('dragging a nested group out to top level lifts it', async () => { /* B[C[..]] → drag C to top gap */ });
```

- [ ] **Step 2: Run, verify fail** (if T1 already re-nests correctly they may pass — then this task is indicator polish only; keep the assertions as regression coverage). Run: `cd packages/kernel && npx vitest run tests/columnGroupHeaderDrag.integration.test.ts`.

- [ ] **Step 3: Implement the drop indicator + reject affordance**
For a group drag, while dragging: draw the insertion line at the resolved gap (T1 step 6.6). When `computeGroupDropTarget` returns null (illegal — gap inside the moving group) OR the resolved target would be rejected by `moveColumnGroup` (a `marryChildren` target — detect by reading the target group's def via a new small dry-run: `ctx.grid.isColumnGroupMarried?.(targetParentGroupId)` accessor, OR accept that the commit no-ops and just hide the line), set the cursor to `'no-drop'` and hide/greytone the insertion line. Optionally add a target-group highlight class on the hovered group's header span. Keep it minimal — match the tool-panel's reject vocabulary.

- [ ] **Step 4: Run tests + suite, verify green** — Run: `cd packages/kernel && npx vitest run tests/columnGroupHeaderDrag.integration.test.ts tests/groupDropTarget.test.ts && npx tsc --noEmit && npm run build && npx vitest run` — Expected: PASS; suite green.

- [ ] **Step 5: Commit**
```bash
git add packages/kernel/src/interaction packages/kernel/tests <css file>
git commit -m "feat(kernel): group-header drag re-nest indicators + reject affordance (T2)"
```

---

### Task 3: Demo + E2E + browser-verify + closeout review + merge

**Files:**
- Create: `apps/cgrid-customizer-demo/e2e/gridHeaderGroupDrag.spec.ts`
- (Demo `main.ts` already renders nested groups Trade→Valuation / Risk with grouped headers — NO code change expected.)

- [ ] **Step 1: Rebuild kernel dist** (the demo consumes it): `cd packages/kernel && npm run build`.

- [ ] **Step 2: Write E2E** `apps/cgrid-customizer-demo/e2e/gridHeaderGroupDrag.spec.ts`, mirroring `e2e/columnGroups.spec.ts` (`waitForGridReady`, `__cgapi.getColumnGroupDefs()`, `STORAGE_KEY` reset). Use a low-level mouse-drag (mousedown on the group header cell in the grid header band → mousemove past another group → mouseup) like the existing column-drag E2E; assert `getColumnGroupDefs()` reflects the reorder, and a re-nest case. If real drag is flaky, ALSO assert the wiring via a direct `__cgapi.moveColumnGroup(...)` call, but keep ≥1 real drag. Reset persisted state per test. Run: `cd apps/cgrid-customizer-demo && npx playwright test e2e/gridHeaderGroupDrag.spec.ts` + full `npx playwright test`; all green. Kill any :5187 server after.

- [ ] **Step 3: Browser-verify** (controller does this): open the demo, drag the Trade/Risk group headers in the grid to reorder; nest one group into another; confirm light+dark vs `apps/colgroups`. Reset state; kill browser + server after.

- [ ] **Step 4: SINGLE closeout review (opus) over T1–T3** (`git diff main..HEAD -- packages apps`) — focus: `computeGroupDropTarget` correctness (gap/common-path/reject-descendant), leaf-drag untouched, group ghost geometry, no listener leaks, marryChildren/no-op via the reused API, external routes for LEAF drag intact. Apply ONE fix wave for Critical/Important; re-run all gates.

- [ ] **Step 5: Merge** — kernel typecheck+build+suite green; demo E2E green. Sync main ff-only; local squash-merge (Phase-B style) if clean else PR; push; delete branch.

---

## Self-review notes (author)
- **Spec coverage:** §4.1 discriminant → T1 step 6.1; §4.2 start → T1 6.2; §4.3 ghost → T1 6.3-6.4; §4.4 `computeGroupDropTarget` → T1 (module+tests) + T2 (re-nest cases); §4.5 commit → T1 6.7; §6 testing → per-task; §7 edge cases (visible leaves, nested groups, marryChildren/self/descendant via API, leaf-untouched, ensureGroupIds) → T1 accessors + the reject test + Global Constraints; §8 delivery → T1/T2/T3.
- **Exec-time confirmations (test-gated):** T1 step 5 — `getColGroupPath` may need a `leafGroupPath` map if `ResolvedColLeaf.groupPath` isn't reachable from `groupById` (build it from a `roots` walk once). T1 step 7 — reuse or build the header-drag simulation harness (grep existing `columnDrag` tests first). T2 step 3 — the reject affordance's exact form (cursor vs hidden line vs highlight) is a small UX call; keep minimal, match the tool panel.
- **Type consistency:** `computeGroupDropTarget(slots, movingGroupId, movingDescendantGroupIds: Set, pointerX)` → `{ targetParentGroupId, beforeId? } | null`; `moveColumnGroup(groupId, targetParentGroupId, beforeId?)` — identical names/params across T1 module, columnDrag commit, and T3 E2E. `HeaderLeafSlot { colId, left, width, groupPath }` consistent T1/T2. `dragKind:'leaf'|'group'` consistent across the state machine.
```
