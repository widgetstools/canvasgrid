# Columns tool panel — hierarchical groups + ag-grid-parity drag — design spec

**Date:** 2026-07-05
**Status:** Approved design; ready for implementation planning
**Reference behavior:** `apps/colgroups` (ag-grid Enterprise `agColumnsToolPanel`)

## 1. Summary

Make cgrid's **columns side panel** render the live column-group tree
**hierarchically** and support **ag-grid-parity drag**: reorder columns and
groups, move a group as a unit, and **re-parent** a column into or out of a
group — for both `columnDefs`-defined groups and groups created at runtime via
the separate "Column Groups" creation panel. The target is behavioral parity
with ag-grid's columns tool panel (see `apps/colgroups`).

Non-goal this cycle: changing the grid **header** group rendering, the separate
"Column Groups" creation panel, or the row-group/pivot/values zones (those keep
working unchanged; the columns panel still routes drags out to them).

## 2. Current state

`packages/kernel/src/interaction/toolPanels/columns/visibilityPanel.ts` renders
a **flat** list: `buildRows()` walks `getColumnState()` and emits one row per
column (checkbox + drag handle + label). It has search + select-all + the three
zone drop targets + a row-drag orchestrator whose fallback is an in-list reorder
via `api.moveColumns`. There is **no** group awareness — no group rows, no
indentation, no carets, no group checkboxes, no re-parenting.

## 3. ag-grid target (from `apps/colgroups`)

The columns tool panel is a tree:
- Standalone columns and group rows at the top level.
- Each **group** row: an expand/collapse **caret**, a **tri-state checkbox**
  (checked / indeterminate / unchecked, toggles all descendant leaves), a **drag
  handle**, and the group label. Children (leaf columns and sub-groups) are
  **indented** one level beneath; nested sub-groups indent further.
- Each **leaf** row: a visibility checkbox, a drag handle, an indented label.
- **Drag**: dragging a leaf reorders it and can move it **into** a group (drop
  within the group's span) or **out** to top level; dragging a group moves the
  whole group as a unit. An insertion line + target-group highlight indicate the
  drop.
- The panel caret expand/collapse is **panel-local** — independent of the grid
  header's open/closed (`columnGroupShow` / `openByDefault`).

## 4. The core reconciliation (why this is a feature, not a tweak)

cgrid splits into three models that ag-grid's tool panel treats as one:

| Concern | cgrid home |
|---|---|
| Column **order** | `columnState` — flat leaf order via `moveColumns`, with `marryChildren` + locks applied by `reorderLeavesByList` |
| Group **membership** (which cols in which group) | the `columnDefs` **group tree** (`getColumnGroupDefs()`, `core/columnTree.ts`) |
| Group **open/closed** | the `columnGroups` module (`getColumnGroupState` / `setColumnGroupState`) |

Rendering the hierarchy reads all three. **Re-parenting a column edits the
membership tree** (`columnDefs`), which today only the creation panel does, and
only on an explicit Apply (`updateGridOptions({ columnDefs })`). Re-parenting
must also **reconcile order**: the moved leaf's flat-order position moves
adjacent to its new group so the header span stays contiguous.

## 5. Architecture

Three units + a delivery sequence (§9).

### 5.1 Group-membership mutation core (T1)

New pure module `packages/kernel/src/core/columnGroupMutation.ts` operating on
the `columnDefs` tree (`(CColDef | CColGroupDef)[]`), plus two `VelocityGridApi`
methods that call it and apply the result.

**API (on `VelocityGridApi`):**
```ts
/** Move leaf `colId` into group `targetGroupId` (or to top level when null),
 *  positioned before `beforeColId` (or at the group's end / list end when
 *  omitted). Reconciles flat leaf order so the column lands adjacent to its
 *  new group. No-op (no event) when the move changes nothing or is invalid. */
moveColumnToGroup(colId: string, targetGroupId: string | null, beforeColId?: string): void;

/** Move group `groupId` (with its whole subtree) under `targetParentGroupId`
 *  (or to top level when null), positioned before sibling `beforeId` (a colId
 *  or groupId). No-op (no event) on a no-op / invalid move (e.g. into itself
 *  or a descendant). */
moveColumnGroup(groupId: string, targetParentGroupId: string | null, beforeId?: string): void;
```

**Pure transform (`columnGroupMutation.ts`):**
- `moveColumnToGroup(defs, colId, targetGroupId, beforeColId?) → { defs, order }`
  1. Locate + remove the leaf's `CColDef` from its current parent's `children`.
  2. If the old parent group is now empty, remove it (recursively up).
  3. Insert the `CColDef` into the target group's `children` (or the top-level
     array), before `beforeColId` else at the end.
  4. If the target group doesn't exist as a groupId, reject (top-level = `null`,
     not a synthesized group — group *creation* stays the creation panel's job).
  5. Preserve the leaf's `columnGroupShow` and all colDef fields verbatim.
  6. Return the new defs tree **and** the reconciled flat leaf `order` (the
     moved colId repositioned adjacent to its target group's leaves).
- `moveColumnGroup(defs, groupId, targetParentGroupId, beforeId?) → { defs, order }`
  — same shape, moving a whole `CColGroupDef` node; reject moving a group into
  itself or one of its own descendants.
- Invariants preserved (via `resolveColumnTree` validation after the edit):
  no duplicate `groupId`, no duplicate `colId`, no empty `children`.

**`marryChildren`:** a married group keeps its children contiguous and locks
membership. Re-parent **into or out of** a married group is **rejected**
(no-op); reordering *within* it is allowed. Moving a married group as a unit is
allowed.

**Apply step (cgrid layer):** the two methods call the transform, then
`applyGroupMutation(defs, order)` — set the new `columnDefs` (rebuild the tree,
like the creation panel's Apply) and apply the reconciled leaf order via the
existing order path, in one pass. Fires `columnDefsChanged` (already mapped to
the `modules` persist key), so the mutation rides persistence + layouts.

### 5.2 Hierarchical rendering (T2)

Rewrite `visibilityPanel`'s row construction: replace the flat `getColumnState()`
walk with a **recursive walk of `getColumnGroupDefs()`**, emitting rows depth-first:

- **Group row** — `data-group-id`, indent = depth × unit, caret (▸/▾ from
  panel-local expand state), tri-state checkbox, drag handle, label. Caret click
  toggles panel-local expand (show/hide descendant rows). Checkbox click sets
  every descendant leaf's visibility (`setColumnsVisible(descendantLeafIds,
  checked)`); the checkbox renders **indeterminate** when descendants are mixed.
- **Leaf row** — `data-col-id`, indent = depth × unit, the existing visibility
  checkbox + role logic (pivot mode), drag handle, label.
- Panel-local expand state: a `Set<groupId>` of collapsed groups (default: all
  expanded), held on the panel instance. **Not persisted** this cycle.
- Refresh: subscribe to `columnDefsChanged` (rebuild rows) in addition to the
  existing `columnRowGroupChanged`; keep in-place refresh for visibility-only
  changes where possible.

Select-all + search unchanged (search filters leaf rows; a group row shows when
any descendant matches).

### 5.3 Group-aware drag (T3)

Extend the existing row-drag orchestrator (`beginRowDrag`, ghost, external
routers):
- **Grab**: a leaf row drags that leaf; a group row drags the whole group
  subtree (ghost shows the group label + child count).
- **Drop target resolution**: from pointer Y over the rendered rows + the target
  row's depth/indent, compute (a) reorder between two siblings, (b) re-parent
  **into** a group (hovering a group row's body or between its children), or
  (c) move **out** to top level (hovering a top-level gap). 
- **Drop indicators**: an insertion line between rows + a highlight box on the
  target group (ag-grid style), via the existing `setZoneDropState`/ghost CSS
  vocabulary.
- **On drop**: call `moveColumnToGroup` / `moveColumnGroup` (T1), NOT bare
  `moveColumns`. A pure same-level reorder with no membership change may still
  route through `moveColumnToGroup(colId, sameParentOrNull, beforeColId)` for
  one code path.
- **External routes preserved**: dragging a column out of the panel to the
  row-group / pivot / values zones or the header band still works (unchanged
  hit-test priority).

## 6. Data flow

- **Render**: `getColumnGroupDefs()` (membership tree) + `getColumnGroupState()`
  (open — for reference; panel expand is separate) + `getColumnState()`
  (visibility, order, pivot roles) → hierarchical rows.
- **Visibility (group checkbox)**: descendants → `setColumnsVisible(ids, on)`.
- **Caret**: panel-local expand `Set` → re-render subtree.
- **Drop (drag)**: panel computes intent → `moveColumnToGroup` /
  `moveColumnGroup` → tree edit + order reconcile + apply → `columnDefsChanged`
  → panel rebuild.

## 7. Testing

- **Unit (T1)** `columnGroupMutation.test.ts`: leaf top-level↔group; into a
  nested group; before-a-sibling positioning; empty-group cleanup (recursive);
  `columnGroupShow` preserved; order reconcile lands the leaf adjacent to its
  group (header span contiguous); marryChildren re-parent rejected but
  reorder-within allowed; group move (unit) + reject-into-descendant; invalid
  moves are no-ops; `resolveColumnTree` invariants hold after every mutation.
- **Integration (T2, kernel, real grid)**: hierarchy renders from a grid with
  nested groups; tri-state group checkbox (checked/indeterminate/unchecked)
  tracks descendant visibility + toggles all; caret collapses/expands panel
  rows; a runtime-created group (via `updateGridOptions({columnDefs})`) appears
  in the panel on `columnDefsChanged`.
- **Integration (T3)**: a simulated drop re-parents a leaf into a group → the
  grid header shows it in the group; drop to top level removes it; group move;
  external-zone routes still fire.
- **E2E (T4, `cgrid-customizer-demo`)**: drag a column into a group in the panel
  → header reflects it; drag it out; move a group; tri-state group checkbox;
  cross-checked against `apps/colgroups`.

## 8. Edge cases / risks

- **marryChildren**: membership locked (re-parent rejected, reorder-within OK);
  group-as-unit move OK. Pinned in T1.
- **Order ↔ membership contiguity**: the reconcile step is the subtle core;
  covered by T1 unit tests asserting the resulting flat order + header span.
- **Perf**: the tree rebuild happens on **drop only** (not per drag frame), so a
  full `columnDefs` rebuild per drop is acceptable.
- **Consistency with the creation panel**: both edit the same `columnDefs`; the
  creation panel is Apply-only, the columns panel is live — sequential edits are
  fine (each reads the current defs).
- **Auto groupIds**: this cycle does not *create* groups from the columns panel
  (top level = `null`, not a new synthesized group); group creation stays the
  creation panel's job. (Revisit only if parity demands drag-to-create-group.)

## 9. Delivery (one spec, sequenced tasks — like Grid Layouts)

- **T1** — `columnGroupMutation.ts` (pure) + `moveColumnToGroup` /
  `moveColumnGroup` on `VelocityGridApi` + `makeApi` wiring + unit tests. No UI.
- **T2** — hierarchical rendering in `visibilityPanel` (recursive tree walk,
  indentation, carets + panel-local expand, tri-state group checkboxes,
  `columnDefsChanged` refresh) + kernel integration tests. No new drag.
- **T3** — group-aware drag orchestration + drop indicators + live re-parent
  wired to T1; external routes preserved; integration tests.
- **T4** — demo exercise in `cgrid-customizer-demo` (columns tool panel already
  mounted) + browser-verify vs `apps/colgroups` (light + dark; reset state; kill
  browser + server after) + E2E + **single closeout review** + fix wave. Merge.

## 10. Out of scope (this cycle)

- Grid **header** group rendering (unchanged).
- The separate "Column Groups" **creation** panel (unchanged; may adopt the T1
  API later).
- Drag-to-**create** a new group from the columns panel (top level only; no
  synthesized groups).
- Persisting the panel-local expand state across reload (optional T2 add-on if
  desired).
