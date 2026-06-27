# cgrid — Row Grouping: Complete Implementation Prompts (user-supplied 2026-06-27, v2)

Descriptive, agent-ready prompts to implement the **full** AG Grid row-grouping feature in the
**cgrid** canvas-first engine. Grounded in AG Grid's current documentation (v36.0.0 / engine
behavior verified against v35.3.1 docs). Hand the agent one block at a time, in order.

This file SUPERSEDES the earlier `group-column-behaviors-prompts.md` — it includes those
behaviors and adds the data model, the row-group panel drag/drop, sorting, aggregation,
selection, and state.

---

## The mental model to load first (read before any prompt)

Row grouping has **two completely separate axes**, and conflating them is the #1 implementation
bug:

1. **The DATA axis** — rows are organised into a *group tree*. Leaves are your data rows; internal
   nodes are groups keyed by the grouped field values. This tree, flattened to a linear
   `visibleRows[]` honoring expand/collapse, is what the renderer walks. Grouping by N columns =
   a tree N levels deep.

2. **The DISPLAY axis** — *how* that tree is shown: one indented group column, several group
   columns, or full-width group rows. The source columns being grouped are usually hidden; a
   generated **auto group column** shows the keys + chevrons.

A primary column has a `rowGroup` role (it's a grouping level) independent of its visibility. The
row-group **panel** and the columns **tool panel** are just UIs that toggle that role and reorder
the levels. Build the tree + flatten model first (Prompt 1); everything else derives from it.

**Build order:** 1 (tree/flatten) → 2 (auto group column + cell) → 3 (display types) →
4 (expand/collapse) → 5 (sticky) → 6 (row-group panel drag/drop) → 7 (tool-panel + context menu) →
8 (aggregation) → 9 (selection) → 10 (sorting) → 11 (filtering interaction) → 12 (state) →
13 (perf gate). Prompts 1–5 are the load-bearing core.

> Framed as "what AG Grid does, build the canvas equivalent." Reconcile against repo state
> (`git show <sha> --stat`) to mark already-merged prompts done.

---

## Status against Cycle 15 (as of 2026-06-27, Task 11 just committed)

| Prompt | Cycle 15 status | Cycle 15.5 task |
|--------|-----------------|-----------------|
| 1 — group tree & flatten | ✅ Tasks 1–3 (GroupPass + ViewportSlicer + chunk format). Verify: prefix sums, dataIndex→groupId map, no-full-rewalk-on-toggle. | audit only (Task 11) |
| 2 — auto group column & cell renderer | ✅ Task 4 (basic). ❌ missing `suppressCount`, `groupRowRendererParams.innerRenderer`. | Task 7 |
| 3 — group display types | ✅ Task 5. ⚠ clip-rect for `groupRows` mode needs audit. | Task 11 audit |
| 4 — expand/collapse mechanics | ✅ Tasks 7+9 (chevron click, `groupDefaultExpanded`). ❌ missing `isGroupOpenByDefault`, `resetRowGroupExpansion`, `expandParents`/`forceSync` flags, keyboard nav, `ensureIndexVisible`, ARIA `aria-expanded`. | Task 6 |
| 5 — sticky group rows | ❌ entirely new. | Task 3 |
| 5b — `groupHideOpenParents` | ❌ new (distinct from Cycle 15 Task 10's `showOpenedGroup`). | Task 4 |
| 6 — row group panel (drag/drop) | ✅ Task 6 (pill render + add/remove + drag from header). ❌ missing pill REORDER, sort indicator, live insertion indicator, drag ghost, `suppressDragLeaveHidesColumns`, drag-from-tool-panel, three-UIs sync invariant. | Task 1 |
| 7 — tool panel Row Groups drop zone + header context menu | ❌ new (Cycle 11 shipped sidebar Columns panel but not the Row Groups drop zone inside it; no context-menu group items). | Task 2 |
| 8 — group aggregation | ✅ Cycle 14 + Cycle 15 Task 12. ❌ missing multi-component custom aggFuncs returning objects, `groupTotalRow`/`grandTotalRow` row positions. | Task 8 |
| 9 — group selection | ✅ Cycle 15 Task 8 (descendants cascade). ❌ missing `self` + `filteredDescendants` modes, `checkboxLocation`, `selectAll` header. | Task 5 |
| 10 — group sorting | ✅ Cycle 15 Task 11. ❌ missing sort-by-aggregate (auto-group column comparator), panel pill sort-toggle sync, per-level state serialisation. | Task 9 |
| 11 — filtering interaction with grouping | ❌ behavioural correctness audit needed. | Task 9 (combined w/ sort+filter pipeline) |
| 12 — Grid State save/restore | ❌ new. Persist rowGroupColumns + expansion routes + groupDisplayType + per-level sort. | Task 10 |
| 13 — perf + correctness gate | partial (Cycle 15 has perf gates for GroupPass + sort; missing sticky perf, incremental agg gate, three-UIs invariant, ARIA assertions). | Task 11 |

---

## Prompt 1 — Group tree & flattened viewport (foundation)

Implement the row-grouping data model for cgrid. Canvas-first: there is no DOM row recycling,
so everything derives from a flat index.

**GROUP TREE:**
- `rowGroupColumns`: an ORDERED list of column ids. Order defines nesting (group by country, then
  year). This list is the source of truth that all grouping UIs mutate.
- Build a tree by bucketing leaf rows: level 0 keys = distinct values of `rowGroupColumns[0]`;
  within each, level 1 keys = distinct values of `rowGroupColumns[1]`; etc. Leaves hang under the
  deepest group.
- `GroupNode = { id, key, field, level, parentId, childGroupIds, leafDataIndices,
  expanded, descendantLeafCount, aggregates: Record<colId,unknown>, height }`.
- A node has `childGroupIds` (more grouping levels remain) XOR `leafDataIndices` (deepest level).

**FLATTENED VIEW MODEL:**
- `visibleRows[]` = depth-first walk emitting a row ONLY if every ancestor is expanded.
- Each entry is a discriminated union:
  `{ type:'group', node, level, height } | { type:'leaf', dataIndex, level, height }`.
- Group rows and leaf rows may have DIFFERENT heights; everything downstream must handle that.

**PREFIX-SUM OFFSETS** (consistent with cgrid's existing offset arrays):
- `cumHeights[i]` = sum of heights of `visibleRows[0..i-1]`; supports O(1) `offsetForIndex(i)` and
  O(log n) `indexForOffset(scrollTop)` via binary search. Last entry = total content height.

**INCREMENTAL REBUILD:**
- Toggling expand/collapse mutates only `node.expanded`, re-flattens from the toggled subtree, and
  recomputes prefix sums from the first changed index. NEVER a full re-walk on a single toggle.

**INVARIANTS:**
- Expand/collapse MUST NOT change scrollTop (AG Grid parity).
- Group keys are unique only WITHIN a parent — identify a node by its full route (ancestor key
  path), never by key alone.
- Maintain a `Map<dataIndex, groupId>` built at flatten time so leaf→parent lookups are O(1) on
  the hot path (no scans).

**EXPOSE:** `getStickyAncestors(scrollTop)` (used by Prompt 5) and `getRowNode(id)`.

---

## Prompt 2 — Auto group column & the group cell renderer

Implement the auto group column and its cell renderer (canvas-painted, no DOM). This is the
generated column that shows chevron + group key; the grouped source columns are hidden by default.

**GROUP CELL, left to right:**
1. Indent: `level * indentPx` of empty space (level 0 = outermost).
2. Chevron/twistie: points right when collapsed, down when expanded. Hit-testable box of
   `chevronSize` at `x = level*indentPx + chevronPadX`. Leaf rows under the deepest group get NO
   chevron but ARE indented one level past their parent group.
3. Group value: the key for this level. Apply a `valueFormatter` / `keyCreator` if provided. Support a
   custom `innerRenderer` override.
4. Optional count suffix `" (N)"` where N = `descendantLeafCount`. Suppressed when `suppressCount=true`.
5. Optional selection checkbox (Prompt 9) — its hit box is DISTINCT from the chevron's.

**AUTO GROUP COLUMN CONFIG** (parity: `autoGroupColumnDef`): `headerName`, `minWidth`, `cellRendererParams`,
pinning, sortability, width. The auto column participates in the normal column model + horizontal
prefix-sum x-offsets — it is not a special render path.

**CANVAS NOTE:** this exact renderer is reused for sticky pinned headers (Prompt 5) via
`RenderState.sticky`. Do NOT write a second renderer.

---

## Prompt 3 — Group display types

Implement the three `groupDisplayType` modes (parity: `groupDisplayType` grid option). This changes
WHERE keys render and whether dedicated group columns exist. Names must match exactly.

1. **`'singleColumn'`** (default): ONE auto group column holds every level; nesting shown by indentation
   within it. Grouped source columns hidden by default.

2. **`'multipleColumns'`**: ONE auto group column PER grouped field. Each shows only its own level's key;
   a row deeper than a given column's level shows blank in shallower columns. (`autoGroupColumnDef`
   applies to each.)

3. **`'groupRows'`**: NO group column. Each group is a FULL-WIDTH row spanning all columns: chevron + key
   + optional count/aggregates. Leaf rows render normally beneath. Uses a full-width group renderer
   (parity: `groupRowRendererParams`, `suppressCount`).

**CANVAS CLIP-RECT REQUIREMENT** (and for sticky headers in Prompt 5):
- `singleColumn` / `multipleColumns`: the group cell clips to its column's x-range; other columns on
  the group row show aggregates (Prompt 8) or blank.
- `groupRows`: the group band clips to FULL viewport width, ignoring column boundaries.
The dirty-rect layer must set the correct clip rect per mode.

(Custom group columns — overriding the generated columns entirely — is an advanced follow-up, lower
priority.)

---

## Prompt 4 — Expand / collapse mechanics

Implement expand/collapse for group rows.

**INTERACTION:**
- pointerdown → row via prefix-sum offset array. If a group row AND x within the chevron box for
  that level → toggle expanded. (Whole-row-click-to-toggle is a separate configurable action;
  default to chevron-only.)
- Toggle → incremental rebuild (Prompt 1) → recompute prefix sums → re-derive sticky stack
  (Prompt 5) vs UNCHANGED `scrollTop` → repaint body + sticky overlay.

**DEFAULT EXPANSION** (evaluated at build time):
- `groupDefaultExpanded`: number. Expand all groups down to that level. `-1` = all, `0` = none.
- `isGroupOpenByDefault(node)`: callback overriding per-node, identified by full route.

**IMPERATIVE API** (match AG Grid names):
- `expandAll()` / `collapseAll()`
- `setRowNodeExpanded(nodeId, expanded, expandParents?, forceSync?)` — `expandParents` opens ancestors;
  `forceSync` guarantees layout before return.
- `resetRowGroupExpansion()` — discard user toggles, re-evaluate defaults.
- `ensureIndexVisible(index, position?: 'top'|'middle'|'bottom'|'auto')` — AG Grid keeps `scrollTop`
  fixed on expand (children can land off-screen); this opt-in scrolls them into view. Default:
  scroll unchanged.

**KEYBOARD:**
- ArrowRight: collapsed focused group → expand; expanded group → focus first child.
- ArrowLeft: expanded group → collapse; collapsed group OR leaf → focus parent group row.
- Enter/Space on a focused group row toggles it.
- Mirror `aria-expanded` in the ARIA layer.

---

## Prompt 5 — Sticky group rows (pin on scroll)

Implement sticky group headers. AG Grid: "when scrolling through an expanded group, the group row
sticks to the top of the grid." Arbitrary nesting → multiple ancestor headers stack (country pins,
year pins beneath).

**PER SCROLL FRAME** (overlay/volatile layer, NOT the static body layer):
1. `firstIdx = indexForOffset(scrollTop)`.
2. `stickyAncestors` = ordered outermost→innermost chain of expanded groups containing `firstIdx`
   whose descendant range still intersects the viewport.
3. Stack top-down: `ancestor[0]` at `y=0`, `ancestor[1]` at `y=H0`, etc.
4. **EVICTION/PUSH-OFF:** as the next sibling group at level ≤ L scrolls up, translate the pinned
   header at level L upward by the overlap so it slides out exactly as the incoming header arrives.
   No 1px gap/overlap — test with group height ≠ leaf height.
5. Paint the sticky band LAST, highest z; body rows clip under it, never deleted.

**REPAINT DISCIPLINE:** band repaints ONLY when (a) sticky membership/offset changes, or (b) a pinned
header's aggregate ticks. A leaf-cell tick must NOT repaint the band.

**STICKY HEADERS ARE INTERACTIVE:** chevron hit-test (Prompt 4) works on pinned headers — map pointer
y into band space first; collapsing a pinned ancestor is the common "close the group I'm inside" UX.

**PARITY FLAG:** `suppressGroupRowsSticky` (default false) disables steps 2–5.
**NOTE:** `groupHideOpenParents` (Prompt 5b below) AUTO-DISABLES sticky — when on,
`getStickyAncestors` returns `[]`.

---

## Prompt 5b — groupHideOpenParents (parent-replacement mode)

Implement `groupHideOpenParents`. Behavior: "upon expanding a group, the group row is replaced by the
first of its children; only when collapsed is the group row shown again."

1. In the flatten walk: when `groupHideOpenParents===true` AND `node.expanded===true`, do NOT emit
   the node's own group row — emit its children directly.
2. `multipleColumns`/`singleColumn`: the hidden parent's key must still read on child rows (show the
   parent key in that parent's group-column slot on each child).
3. AG Grid AUTO-DISABLES sticky in this mode — force `suppressGroupRowsSticky` behavior.
4. `groupAllowUnbalanced` (follow-up): a group with key `''` behaves as always-expanded, row always
   hidden.

---

## Prompt 6 — Row Group Panel (drag-to-group bar) — THE DRAG/DROP SURFACE

Implement the Row Group Panel: a horizontal bar attached to the TOP of the grid where users drag
columns to control grouping. This is DOM overlay chrome (not canvas cells), consistent with the
hybrid architecture. (Parity: `rowGroupPanelShow`.)

**DISPLAY:**
- One PILL per active row-group column, left-to-right in grouping order. Each pill shows the column
  header text, a drag handle, a remove (×) affordance, and (if not suppressed) a sort indicator.
- Empty-state prompt text when nothing is grouped (e.g. "Drag here to set row groups").
- `rowGroupPanelShow: 'always' | 'onlyWhenGrouping' | 'never'`. `'onlyWhenGrouping'` shows the bar
  only while ≥1 group is active.

**DRAG INTO THE PANEL** (add a grouping level):
- A user drags a COLUMN HEADER from the grid (or a column entry from the tool panel) and drops it on
  the panel. On drop, append (or insert at the drop position) that column id to `rowGroupColumns` →
  rebuild the group tree (Prompt 1) → regenerate the auto group column(s) → repaint.
- Only columns whose colDef permits grouping accept the drop. Gate on `enableRowGroup` (tool-panel
  drags) / the column being groupable. Reject non-groupable drops with visual feedback (no-drop
  cursor, rejected-drop animation).
- While dragging over the panel, show a live insertion indicator between existing pills marking
  where the new level will land.

**REORDER PILLS** (change nesting order):
- Dragging a pill to a new position within the panel reorders `rowGroupColumns` → the group tree
  re-nests (group-by-year-then-country becomes country-then-year) → rebuild + repaint.

**REMOVE** (drag out / click ×):
- Dragging a pill OUT of the panel, or clicking its ×, removes that column id from `rowGroupColumns`
  → rebuild. The source column's default visibility behavior on ungroup is governed by the flags
  below.

**COLUMN VISIBILITY ON GROUP/UNGROUP** (parity — get exact):
- By default, grouping a column HIDES it from the grid body; ungrouping SHOWS it again.
- `suppressGroupChangesColumnVisibility: true | 'suppressHideOnGroup' | 'suppressShowOnUngroup'`
  overrides this.
- `suppressDragLeaveHidesColumns`: when a column is dragged OUT over the panel boundary it is
  normally treated as leaving the grid (hidden); set true to prevent that.

**SORT FROM THE PANEL:**
- Clicking a pill toggles that group level's sort (asc/desc/none), reflected by the pill's sort
  indicator. `rowGroupPanelSuppressSort=true` disables this.

**SYNC:** this panel and the tool panel's Row Groups drop zone (Prompt 7) mutate the SAME ordered
`rowGroupColumns` list. They are two views over one list and must update live together.

**DRAG GHOST:** render the dragged column/pill as a floating ghost following the cursor (DOM
overlay), consistent with how cgrid already handles column-drag ghosts.

---

## Prompt 7 — Columns Tool Panel (sidebar) & header context menu

Two more surfaces that mutate the same `rowGroupColumns` list. DOM overlay chrome.

**A) COLUMNS TOOL PANEL** (sidebar, parity `sideBar: 'columns'`):
- A "Row Groups" drop zone listing the active group columns as pills (mirrors Prompt 6's panel).
- The columns list: each entry has a checkbox + a drag handle. A column can be dragged from the
  list into the Row Groups drop zone to group by it (if `enableRowGroup`), reordered within it, or
  dragged out to ungroup.
- Checkbox semantics when NOT in pivot mode: toggles column VISIBILITY. (Pivot mode changes this —
  out of scope here; see the pivot prompts.)
- `allowDragFromColumnsToolPanel`: lets a column be dragged from the panel directly onto the grid.

**B) COLUMN HEADER CONTEXT MENU** (right-click, DOM popup):
- "Group by `<col>`" when the column is groupable and not already grouped.
- "Un-Group by `<col>`" when it is currently a group level.
- "Expand All" / "Collapse All" group items.
- Selecting an item mutates `rowGroupColumns` exactly as the equivalent drag would — same state
  functions, not a parallel code path.

**C) DRAG FROM GRID HEADER:**
- Dragging a groupable column header directly onto the Row Group Panel (Prompt 6) is the third entry
  point. All three (panel drop, tool-panel drag, context menu) converge on one `setRowGroupColumns`/
  `addRowGroupColumn`/`removeRowGroupColumn` API.

---

## Prompt 8 — Group aggregation

Implement aggregate values shown on group rows. A group row summarizes its descendant leaves in the
non-group columns.

1. A column with `aggFunc` (`'sum'|'avg'|'min'|'max'|'count'|custom`) shows the aggregate of its
   descendant leaves on each group row, at EVERY level (country row sums all years' leaves; each
   year sums its own).
2. **Custom aggFuncs:** registered functions receiving the child values/nodes; support returning
   OBJECTS for multi-component aggregates (e.g. weighted average carrying a weight).
3. Recompute on: data load, tick updates affecting descendants, expand of a lazily-loaded group,
   filter changes (aggregate over filtered-in leaves when configured).
4. **TICK PERF:** incremental — a changed leaf delta-applies up its ancestor chain; never re-aggregate
   a whole subtree per tick (100k-row target).
5. Pinned sticky headers (Prompt 5) show the SAME aggregate as the inline row; a pinned-aggregate
   tick is one of only two events allowed to repaint the sticky band.
6. **Total rows** (parity, follow-up): grand total row + per-group total/footer rows
   (`groupTotalRow` / `grandTotalRow` positions `'top'|'bottom'`).

---

## Prompt 9 — Group selection (checkbox cascade)

Implement selection on group rows.

1. `checkboxLocation: 'autoGroupColumn'` renders the checkbox inside the group cell (after chevron +
   value); otherwise it lives in a dedicated checkbox column. Its hit box is distinct from the
   chevron's and must be hittable on inline AND sticky headers.
2. **`groupSelects`:**
   - `'self'`: selecting a group selects only the group node.
   - `'descendants'`: selecting a group selects all descendant leaves; the group checkbox is
     checked when all are selected, indeterminate when some are.
   - `'filteredDescendants'`: as descendants but only filtered-in leaves.
3. Tri-state (checked/unchecked/indeterminate) derived from descendant selection counts,
   recomputed on any selection change within the subtree.
4. `selectAll: 'all' | 'filtered' | 'currentPage'` for the header select-all.

---

## Prompt 10 — Group sorting

Implement sorting interaction with grouping.

1. Groups sort by their key by default. Sorting the auto group column sorts group rows at each
   level; within an expanded group, leaf rows follow the active leaf sort.
2. Sort groups by an AGGREGATE value via the auto group column's `comparator` (e.g. sort country
   groups by summed notional) — needed for FI blotters.
3. Per-level sort state survives expand/collapse and is serializable (Grid State).
4. The row-group panel pills reflect and toggle each level's sort (Prompt 6), unless
   `rowGroupPanelSuppressSort`.
5. When multiple group columns exist (`multipleColumns`), each is independently sortable.

---

## Prompt 11 — Filtering interaction with grouping

Implement how filtering composes with grouping.

1. Filters apply to the underlying leaf rows; the group tree is rebuilt over the filtered-in leaves.
   A group with no surviving leaves disappears.
2. `descendantLeafCount` and aggregates reflect filtered-in leaves (when aggregation-over-filtered is
   configured).
3. `groupSelects: 'filteredDescendants'` and `selectAll: 'filtered'` compose with the active filter.
4. Quick filter / external filter likewise rebuild the tree.
**PERF:** rebuilding the tree on filter change should reuse the leaf bucketing where keys are
unchanged; don't rebuild aggregates for untouched subtrees.

---

## Prompt 12 — Grouping state & save/restore

Implement persistence (parity: Grid State).

- `rowGroupColumns` (which columns + order) saves and restores.
- Row group expansion state saves and restores (the set of expanded node routes).
- `groupDisplayType`, sort-per-level, and aggregation config round-trip.
- Auto group columns are DERIVED — they regenerate deterministically from `rowGroupColumns` + data,
  so they aren't persisted directly (mirrors how pivot secondary columns aren't persisted).
- Restoring must rebuild the tree, reapply expansion routes, and repaint without changing scrollTop
  unexpectedly.

---

## Prompt 13 — Perf & correctness gate

Validate against the cgrid FI workload (250 columns, 100k+ rows, tick updates).

1. Group tree build over 100k leaves is a single bucketing pass; toggling a group is O(affected
   subtree), not O(all rows). Profile: no full re-walk on a single expand/collapse.
2. `indexForOffset` / `offsetForIndex` are O(log n)/O(1); no allocation in the scroll hot path.
3. Sticky recompute is O(depth); eviction handoff has no 1px gap/overlap with group height ≠ leaf
   height.
4. Collapse preserves `scrollTop` byte-identically; sticky stack re-derived correctly afterward.
5. A leaf tick repaints only its cell layer + (if changed) its ancestor aggregates; it does NOT
   repaint the sticky band unless a pinned aggregate changed.
6. Aggregation tick is incremental (delta up the ancestor chain), verified against a full re-agg
   reference for correctness.
7. The three grouping UIs (row-group panel, tool-panel drop zone, context menu) provably mutate one
   shared `rowGroupColumns` list — change via one, the others reflect it live.
8. Drag-to-group: dropping a non-groupable column is rejected; dropping a groupable one hides it
   from the body per `suppressGroupChangesColumnVisibility`; ungrouping restores visibility.
9. ARIA: `aria-expanded` flips on toggle; a pinned header appears in the a11y tree exactly once.

---

## Parity flag / API quick-reference

| Name | Prompt | Purpose |
| --- | --- | --- |
| `rowGroup` (colDef) | 1 | Column is a grouping level |
| `enableRowGroup` | 6,7 | Allow user to group via UI (drag/menu) |
| `autoGroupColumnDef` | 2 | Configure the generated group column(s) |
| `groupDisplayType` | 3 | `singleColumn` \| `multipleColumns` \| `groupRows` |
| `groupRowRendererParams` / `suppressCount` | 2,3 | Group renderer config / hide `(N)` |
| `groupDefaultExpanded` | 4 | Expand to level N; `-1` = all |
| `isGroupOpenByDefault` | 4 | Per-node default-open (by route) |
| `setRowNodeExpanded` / `expandAll` / `collapseAll` / `resetRowGroupExpansion` | 4 | Expansion API |
| `ensureIndexVisible` | 4 | Scroll a row into view |
| `suppressGroupRowsSticky` | 5 | Disable sticky group headers |
| `groupHideOpenParents` | 5b | Replace expanded parent with first child |
| `groupAllowUnbalanced` | 5b | Empty-key groups always-expanded/hidden |
| `rowGroupPanelShow` | 6 | `always` \| `onlyWhenGrouping` \| `never` |
| `rowGroupPanelSuppressSort` | 6,10 | Disable sort-from-panel |
| `suppressGroupChangesColumnVisibility` | 6 | Keep source columns visible on group/ungroup |
| `suppressDragLeaveHidesColumns` | 6 | Don't hide a column dragged off the grid |
| `sideBar: 'columns'` / `allowDragFromColumnsToolPanel` | 7 | Tool panel + drag-onto-grid |
| `aggFunc` / custom agg | 8 | Aggregation per column |
| `groupTotalRow` / `grandTotalRow` | 8 | Total/footer rows |
| `checkboxLocation` / `groupSelects` / `selectAll` | 9 | Group selection model |
| Auto group column `comparator` | 10 | Sort groups by aggregate |
| Grid State (grouping) | 12 | Save/restore grouping + expansion |
