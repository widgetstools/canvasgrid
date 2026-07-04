# Cycle 21i — Column Groups editor tab (2026-07-03)

Branch: `cycle21/customizer-*`. Follows Phase 1
(`specs/2026-07-03-cycle-21i-phase1-design.md`, decisions D-A…D-H).
Tier: **NATIVE** — vanilla DOM in `@cgrid/kernel`, zero new dependencies,
themed by `tokens.css` vars, reusing the Phase 1 `settingsForm` controls.
Built and verified in `apps/cgrid-customizer-demo` on live STOMP data.

## 0. Problem & goal

Let a user author the grid's **column-group hierarchy** — including
**sub-groups nested inside groups** (ag-grid parity) — from a customizer
tab, and style each group's header. The kernel already renders arbitrarily
nested groups: `CColGroupDef.children` is recursively
`(CColDef | CColGroupDef)[]`, the write path is
`updateGridOptions({ columnDefs })` (one re-layout), and open/closed state
is carried by `getColumnGroupState()/setColumnGroupState()`. So this is
**not a kernel model change** — it is a UI that authors the `columnDefs`
tree, plus a small amount of kernel surface to read the current group tree
back out for editing.

Scope (locked): **full column panel** — create/nest/rename groups, assign
columns, show/hide leaf columns, reorder within and across groups, plus
per-group header styling. Not in scope this cycle: per-column pinning and
width editing (they stay in the existing `columns` panel).

## 1. Decisions (locked with user, 2026-07-03)

- **Editing UX = hybrid.** Buttons for structural ops (create / rename /
  delete group, add subgroup); drag only for reorder + move-between-groups
  + nest-by-drop. Echoes the existing `columns` panel's `⋮⋮` drag handle.
- **Scope = full column panel** (grouping + nesting + visibility + order +
  rename + group-header styling).
- **Placement = new tab "Column Groups" after "Options"** in the side
  panel: `sideBar.toolPanels: ['columns','filters','gridOptions','columnGroups']`.
- **Layer = kernel-native tool panel**, built beside
  `columnsPanel.ts` / `gridOptionsPanel.ts`.
- **Apply model = explicit Apply / Reset.** Edits accumulate in the flat
  working model; **Apply** projects → `updateGridOptions`; **Reset**
  re-flattens the last-applied defs. No live/debounced push — never fights
  the 300-upd/s stream.

## 2. Architecture — normalized model + pure projection (the elegant core)

The panel never mutates the nested `CColGroupDef` tree directly. It holds a
**normalized flat working model**; all edits are O(1) field writes; a pure
projection folds it back to the nested tree only on **Apply**.

```ts
// interaction/columnGroups/model.ts
type GroupNode = {
  id: string;            // stable working id (groupId when known)
  kind: 'group';
  parentId: string | null;
  order: number;
  headerName: string;
  openByDefault?: boolean;
  marryChildren?: boolean;
  headerStyle?: ColCellOverrides;   // reuse Phase 1 styling primitive
  headerClass?: HeaderClass;
};
type ColumnNode = {
  id: string;            // colId
  kind: 'column';
  parentId: string | null;   // null = top-level / "Ungrouped"
  order: number;
  colId: string;
  headerName: string;    // rename target (writes CColDef.headerName)
  hide?: boolean;        // visibility checkbox
};
type Node = GroupNode | ColumnNode;
```

Two pure functions bracket the model:

- `flatten(columnDefs: (CColDef|CColGroupDef)[]) : Node[]`
  — walks the nested tree once, emitting flat nodes with `parentId`/`order`.
  Column leaves not inside any group get `parentId: null`.
- `project(nodes: Node[]) : (CColDef|CColGroupDef)[]`
  — groups by `parentId`, sorts by `order`, and folds bottom-up into the
  nested `columnDefs` the kernel consumes. Preserves every non-structural
  `CColDef` field by keeping a reference to the original leaf def keyed by
  `colId` (only `headerName`/`hide`/order are editor-owned).

Consequences (why this is the elegant choice):
- **Every mutation is trivial.** create group = push a `GroupNode`; nest =
  set `parentId`; reorder = renumber `order`; move column = set `parentId`;
  delete group = reparent its children to the group's `parentId`, then drop
  the node (children never orphaned).
- **Apply/Reset need no separate dirty tracking.** The working array IS the
  staging area. Apply = `updateGridOptions({ columnDefs: project(nodes) })`.
  Reset = `nodes = flatten(lastAppliedDefs)`. Dirty = `nodes` differs from
  the flattened last-applied snapshot (cheap structural compare).
- **Validation is a flat pass:** no empty groups, `marryChildren` respected
  on drops, cycle prevention (a group cannot be dropped into its own
  descendant), unique working ids.

## 3. Deliverables (tasks)

### T1 — Kernel: read the current group tree for editing
- `CGridApi.getColumnGroupDefs(): (CColDef | CColGroupDef)[]` — returns the
  current, live column-def tree (post user reorders/hides) so the editor
  seeds from what the user sees, not the original static defs. If an
  equivalent internal accessor exists on `columnDefsMap`, expose it; else
  add a thin reader. This is the only genuinely intrinsic kernel need
  (per no-retroactive-layering) — everything else uses existing surface
  (`updateGridOptions`, `getColumnGroupState`/`setColumnGroupState`).

### T2 — `interaction/columnGroups/model.ts`
- `flatten` / `project` / mutation helpers (`createGroup`, `addSubgroup`,
  `renameGroup`, `deleteGroup`, `moveNode`, `reorder`, `setHidden`,
  `setGroupStyle`) — all pure over `Node[]`.
- Validation helpers (`canDrop`, `validate`) returning explicit results.
- Fully unit-testable with no DOM.

### T3 — `interaction/toolPanels/columnGroupsPanel.ts` (tree renderer)
- Registered in `toolPanels/registry.ts` as `'columnGroups'`; tab icon
  (`group` / `columns-2`); `SideBarDef.toolPanels: [...,'columnGroups']`
  shorthand supported, mirroring `gridOptionsPanel` registration.
- Renders the flat model as an indented tree grouped by `parentId`,
  ordered by `order`. Top-level "Ungrouped" section for `parentId:null`
  columns. Group rows show expander + name + `+ Subgroup` + rename +
  delete; column rows show `⋮⋮` handle + visibility checkbox + name.
- **Buttons:** `+ Group` (toolbar), per-group `+ Subgroup`, inline rename,
  delete. **Drag:** reorder (between-row drop) + move/nest (onto-group-row
  drop), reusing the drag idiom/tokens from `columnsPanel`.
- Footer: **Apply** (primary) + **Reset**, Apply disabled when not dirty.

### T4 — Group-header Style section
- Selecting a group row reveals a Style band built from the Phase 1
  `settingsForm` controls (color picker, font weight/style, alignment,
  border → `ColCellOverrides`), plus `openByDefault` / `marryChildren`
  toggles, writing into the selected `GroupNode`. Applied to
  `CColGroupDef.headerStyle` (and `headerClass`) on Apply.

### T5 — Demo wiring
- `apps/cgrid-customizer-demo`: add `'columnGroups'` to `sideBar.toolPanels`
  after `'gridOptions'`; seed the demo `columnDefs` with 2–3 example groups
  (incl. one nested subgroup) so the tab has content to edit on open.

## 4. Data flow

```
open tab ─► api.getColumnGroupDefs() ─► flatten() ─► Node[] (working model)
                                                        │ (buttons + drag)
                                          O(1) mutations ▼
                                                     Node[]'
Apply ─► project(Node[]') ─► api.updateGridOptions({ columnDefs })  ─► one re-layout
Reset ─► flatten(lastAppliedDefs) ─► Node[]
persist ─► existing Phase 1 persistState path already round-trips columnDefs
           + getColumnGroupState()/setColumnGroupState() for open/closed
```

No new persistence code: the group tree already serializes through the
Phase 1 `persistState` snapshot.

## 5. Error handling & edge cases
- **Empty group** on Apply → validation blocks Apply, inline message on the
  offending group (delete it or add a child).
- **marryChildren** group → its leaves cannot be dragged out; `canDrop`
  returns false, no drop indicator shown.
- **Cycle** (group dropped into its own descendant) → rejected by `canDrop`.
- **Column present in defs but hidden by another panel** → shown with an
  unchecked visibility box; editor and `columns` panel write the same
  `hide` field, last-write-wins on Apply.
- **Live tick during edit** → none of the staged edits touch the grid;
  Apply is the only write, so ticking rows are never disturbed mid-edit.

## 6. Testing
- **Unit (T2):** `flatten`∘`project` round-trip is identity for
  representative trees (flat, one-level, nested subgroup, mixed
  grouped/ungrouped); each mutation helper; every validation case.
- **E2E (hard gate):** in the demo — create a group via button, add a
  subgroup, drag a column into it, toggle a column's visibility, restyle a
  group header, click Apply → assert grid header structure + styling; then
  reload → assert state persisted. Kill the automation browser after.
- **Visual:** consult `docs/catalog/screenshots/17-sidebar-columns-panel-open.png`
  and the Options tab before building; run `/frontend-design` for the tree
  rows, drag affordances, and Style band before implementation.

## 7. Out of scope (this cycle)
Per-column pin left/right and width editing (remain in `columns` panel);
value/pivot group interplay; multi-select drag of several columns at once
(single-node drag only for v1).
