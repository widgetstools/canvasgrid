# Grid header column-group drag (move + re-nest) — design spec

**Date:** 2026-07-06
**Status:** Approved design; ready for implementation planning
**Reference behavior:** `apps/colgroups` (ag-grid Enterprise — drag a group header to move/re-nest it)
**Builds on:** the columns-panel-hierarchy feature (merged `d694fbe`) — reuses its `CGridApi.moveColumnGroup`.

## 1. Summary

Let the user **drag a column-group header in the grid** to move the whole group
as a unit, with **full ag-grid parity**: reorder the group among its siblings
AND re-nest it into or out of another group. Today only **leaf** column headers
are draggable; group headers are hit-tested but ignored by the drag feature.

The whole group moves together (all its leaf columns, in order); `marryChildren`
and nested sub-groups are respected; a group ghost + insertion indicator show the
drop. Non-goal this cycle: changing leaf-header drag, the columns tool panel, or
the group-membership mutation engine (all reused unchanged).

## 2. Current state

`packages/kernel/src/interaction/features/columnDrag.ts` (472 lines) is the
grid's column-drag feature. Its state machine:
- `handleMouseDown` — `if (ctx.hit.kind !== 'header') { super…; return; }` — only a
  **leaf** header (`{ kind:'header', colId }`) starts a drag; a group-header hit
  (`{ kind:'headerGroup', groupId, colId }`, produced by `hitTester.ts`) is
  forwarded downstream and ignored.
- `handleMouseDrag` — past `DRAG_THRESHOLD_PX`, builds a `DraggingState` with a
  single-header ghost (`createGhostHeader`), `insertionLine`, `pillGhost`; tracks
  `currentX`; dispatches row-group/pivot panel hover.
- `handleMouseUp` — routes to pivot / row-group panels if dropped there, else
  `computeDropTargetIndex(ctx, colId)` → `grid.reorderColumn(colId, target,
  'uiColumnDragged')`.

So the hit (`headerGroup` + `groupId`) and the commit primitive
(`moveColumnGroup`) already exist; only the drag interaction for groups is missing.

## 3. ag-grid target

Dragging a group header moves the entire group: it reorders among sibling
columns/groups at its level, and dropping it within another group's span nests it
into that group (dropping it in the ungrouped area lifts it to top level). A ghost
spans the group; an insertion line marks the landing position. `marryChildren`
groups still move as a unit; a group can't be dropped into itself or a descendant.

## 4. Architecture

All changes live in `columnDrag.ts` plus small helpers; the commit reuses the
merged `moveColumnGroup`.

### 4.1 State discriminant

`PressedState` and `DraggingState` gain `dragKind: 'leaf' | 'group'`. A group
drag additionally carries `groupId: string` and `leafColIds: string[]` (the
group's **visible** leaf columns, left→right — its header span). Leaf drags keep
today's shape (`dragKind: 'leaf'`, `colId`).

### 4.2 Start — `handleMouseDown`

Add a branch: when `ctx.hit.kind === 'headerGroup'`:
- Resolve the group's visible leaf colIds (`grid.getGroupVisibleLeafColIds(groupId)`
  — a thin accessor over the column tree + current `columnGroupShow`/open state;
  add it if absent).
- Movability: the group is movable unless it (or an ancestor) is locked
  (`suppressMovable` on the group def, or any child leaf `lockPosition`). If not
  movable → forward downstream (`super.handleMouseDown`) so header click still works.
- Start `pressed` with `dragKind:'group'`, `groupId`, `leafColIds`; grab offset
  from the group's left edge (`columnLeftOf(leafColIds[0])`).

Leaf branch unchanged.

### 4.3 Ghost — group span

`createGroupGhostHeader(ctx, groupId, leafColIds)` (alongside `createGhostHeader`):
an overlay div spanning the summed width of the group's visible leaf headers at
the group-header row, showing the group's `headerName`. `updateHeaderGhostPosition`
branches on `dragKind` to size/translate the group ghost. The `pillGhost` /
row-group / pivot panel hover paths are **skipped** for group drags (a group is
not a role column).

### 4.4 Drop resolution — `computeGroupDropTarget`

`computeGroupDropTarget(ctx, groupId, pointerX): { targetParentGroupId: string | null; beforeId?: string } | null`
— the horizontal analogue of the tool panel's `resolveDrop`. From the visible
header layout + `pointerX`:
1. Find the header cell/group boundary nearest the pointer.
2. If the pointer is within another group's span (and that group is not the moving
   group, itself, or a descendant), the target is **that group** — nest into it,
   `beforeId` = the sibling (leaf or sub-group) whose left edge the pointer is
   before (else append).
3. Otherwise the target is the **level the pointer sits at** (top level or the
   enclosing group), `beforeId` = the next sibling at that level.
4. Return `null` when the resolved move is a no-op or the pointer is over the
   moving group itself.

`beforeId` is a colId or a groupId (whichever sibling comes next), matching
`moveColumnGroup(groupId, targetParentGroupId, beforeId)`'s contract.

### 4.5 Commit — `handleMouseUp`

For `dragKind:'group'`: `ctx.grid.moveColumnGroup(groupId, target.targetParentGroupId,
target.beforeId)` when `computeGroupDropTarget` returns non-null. The API already:
rejects `marryChildren` re-nest, into-self/descendant, and no-ops (returns without
event); preserves runtime column state across the rebuild; fires `columnDefsChanged`.
Skip the pivot/row-group panel commit branches for group drags. Suppress the
follow-up click (same as leaf drag) so header-click sort doesn't fire.

## 5. Data flow

mousedown(`headerGroup`) → `pressed{group}` → drag past threshold →
`dragging{group}` + group ghost + insertion line → mouseup →
`computeGroupDropTarget` → `moveColumnGroup` → `columnDefs` rebuild → header
re-renders in the new order/nesting.

## 6. Testing

- **Unit** `computeGroupDropTarget`: reorder among top-level siblings (before/after);
  nest into an adjacent group (`beforeId` = first/among its children); lift out to
  top level; pointer over the moving group / into its own descendant → `null`;
  `beforeId` picks the correct next sibling. Drive with a synthetic visible-header
  layout (colId → {left,right} + group spans).
- **Integration (kernel, real grid)**: synthetic mousedown on a group-header cell →
  mousemove past threshold to a target X → mouseup; assert `getColumnGroupDefs()`
  shows the group reordered / re-nested, and a `marryChildren` group re-nest is a
  no-op. Reuse the fake-worker+canvas mount harness.
- **E2E (`cgrid-customizer-demo`)**: drag the "Trade"/"Risk" group header to
  reposition it; nest one group into another; assert via `__cgapi.getColumnGroupDefs()`.
  Browser-verify light+dark vs `apps/colgroups`; reset state + kill browser/server after.

## 7. Edge cases / risks

- **Visible leaves only**: a `columnGroupShow` group hides some children; the ghost
  span + `leafColIds` use the currently-visible leaves. Moving the group still moves
  ALL its member columns (membership is in the tree; `moveColumnGroup` moves the node).
- **Nested groups**: the hit-tester returns the `groupId` at the hovered header-row
  level, so dragging a sub-group vs its parent is unambiguous.
- **marryChildren / into-self / descendant**: guarded by `moveColumnGroup` (no-op) —
  the drag reflects a reject cursor/indicator when `computeGroupDropTarget` would
  resolve to such a target (dry-run the resolution; no live mutation mid-drag).
- **Leaf drag unaffected**: the `dragKind:'leaf'` path is byte-for-byte the current
  behavior; only new branches are added.
- **Auto groupIds**: reuse the merged `ensureGroupIds` if a hovered/moving group is
  anonymous, so `moveColumnGroup` resolves it (same normalization the tool panel uses).

## 8. Delivery (one spec, sequenced tasks)

- **T1** — group-drag START + ghost + REORDER commit: state discriminant, the
  `headerGroup` mousedown branch, `createGroupGhostHeader`, `getGroupVisibleLeafColIds`,
  `computeGroupDropTarget` reorder-among-siblings path, `moveColumnGroup` commit,
  insertion line. Unit (`computeGroupDropTarget` reorder) + kernel integration
  (drag reorders a group). Leaf drag untouched.
- **T2** — RE-NEST drop resolution: extend `computeGroupDropTarget` to nest into /
  out of groups, reject-into-descendant/self + marryChildren dry-run indicator.
  Unit + integration.
- **T3** — demo + E2E + browser-verify vs `apps/colgroups` + **single closeout
  review** + fix wave + merge.

## 9. Out of scope

- Leaf-header drag (unchanged), the columns tool panel (unchanged), the group
  membership mutation engine (`columnGroupMutation.ts` reused as-is).
- Dragging a group into the row-group / pivot panels (groups aren't role columns).
- Creating a new group by dragging (no synthesized groups — top level = `null`).
