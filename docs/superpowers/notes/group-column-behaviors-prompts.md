# cgrid — Group Column Behaviors: Agent Prompts (user-supplied 2026-06-27)

Agent-ready prompts covering the full surface of group-column behaviors for the **cgrid**
canvas-first engine. Grounded in AG Grid's current behavior (v35.3.1). Hand the agent one block
at a time.

**Sequencing:** Prompts 1–4 are the load-bearing core (rendering, display modes, expand/collapse,
sticky) and should land first. Prompts 5–8 layer on top and can be parallelized once the flatten
model and prefix-sum offsets from 1–3 are stable. Prompt 7's incremental aggregation is the one
most likely to bite the tick-rate target if done naively — flag it as needing a perf gate.

> These are framed as "what AG Grid does, build the canvas equivalent" and do **not** assume what
> is already merged. Reconcile against the actual repo state (e.g. `git show <sha> --stat`) to mark
> which prompts are already done.

**Status against Cycle 15 (as of 2026-06-27):**

| Prompt | Cycle 15 status |
|--------|-----------------|
| 1 — group cell rendering + auto group column | ✅ Task 4 (basic); ❌ missing `suppressCount`, `groupRowRendererParams` → Cycle 15.5 / Task 5 |
| 2 — `groupDisplayType` modes | ✅ Task 5; ⚠️ groupRows full-width clip verify → Cycle 15.5 / Task 5 (audit) |
| 3 — expand/collapse mechanics | ✅ Tasks 7+9; ❌ missing `isGroupOpenByDefault`, `resetRowGroupExpansion`, `expandParents`, keyboard → Cycle 15.5 / Task 4 |
| 4 — **sticky group rows** | ❌ entirely new → Cycle 15.5 / Task 1 |
| 5 — **`groupHideOpenParents`** | ❌ new → Cycle 15.5 / Task 2 |
| 6 — group selection | ✅ Task 8 (descendants); ❌ missing `self`, `filteredDescendants`, `checkboxLocation`, `selectAll` → Cycle 15.5 / Task 3 |
| 7 — group aggregation display | ✅ Cycle 14 + Task 12; ⚠️ incremental tick perf gate → Cycle 15.5 / Task 6 |
| 8 — group sorting + row-group panel | ✅ Tasks 6+11; ❌ missing `suppressGroupChangesColumnVisibility` → Cycle 15.5 / Task 5 |

---

## Prompt 1 — Group cell rendering & the auto group column

Implement the group cell renderer for cggrid's auto group column (canvas-painted, no DOM).
This is the cell that shows the expand/collapse chevron + the group key.

Each group cell renders, left to right:
1. Indent: level * indentPx of empty space (level 0 = outermost group).
2. Chevron/twistie: pointing right when collapsed, down when expanded. Hit-testable box of
   chevronSize at (level*indentPx + chevronPadX). Leaf rows under the deepest group get NO
   chevron but ARE indented one level past their parent group.
3. Group value: the key for this level (e.g. "Australia"). Use a valueFormatter if provided.
4. Optional count suffix: " (N)" where N = descendantLeafCount. Suppressed when
   suppressCount === true (parity flag name).
5. Optional checkbox (selection) — see Prompt 6.

**PARITY FLAGS:** suppressCount, and a groupRowRendererParams-style config object that can override
the inner renderer (innerRenderer), the value, and whether the count shows.

**CANVAS NOTE:** this renderer is the same paint(ctx, RenderState) used by sticky pinned headers,
with RenderState.sticky distinguishing them. Do not write a second renderer.

---

## Prompt 2 — Group display types (how groups occupy columns)

Implement the three groupDisplayType modes. This flag changes WHERE group keys render and whether
a dedicated group column exists. Match AG Grid names exactly.

1. **'singleColumn'** (default): ONE auto group column holds every grouping level. Nested levels show
   via indentation within that single column. The grouped source columns are hidden by default.

2. **'multipleColumns'**: ONE auto group column PER grouped field. Each column shows only its own
   level's key (country column shows country, year column shows year). A row deeper than a given
   column's level shows blank in the shallower columns.

3. **'groupRows'**: NO group column at all. Each group renders as a FULL-WIDTH row spanning all
   columns — chevron + key + optional count/aggregates. Leaf rows render normally beneath.

**CANVAS CLIP-RECT REQUIREMENT:**
- singleColumn / multipleColumns: the group cell clips to its column's x-range; other columns on
  the group row show aggregates or blank.
- groupRows: the group band clips to the full viewport width and ignores column boundaries.
The dirty-rect layer must set the correct clip rect per mode, including for sticky pinned headers.

---

## Prompt 3 — Expand / collapse mechanics

Implement expand/collapse for group rows.

**INTERACTION:**
- pointerdown maps (x,y) -> row via prefix-sum offset array. If it's a group row AND x is within
  the chevron box for that row's level, toggle expanded. (Whole-row-click-to-toggle is a separate
  configurable action; default to chevron-only toggle.)
- Toggling mutates only node.expanded, then incrementally rebuilds the flattened visibleRows[]
  from the toggled node's subtree downward, recomputes prefix sums from the first changed index,
  and repaints body + sticky overlay.

**HARD INVARIANT (AG Grid parity):** expand/collapse does NOT change scrollTop. After a toggle,
re-derive everything (sticky stack, visible window) against the unchanged scrollTop.

**DEFAULT EXPANSION STATE (evaluated at build time):**
- groupDefaultExpanded: number. Expand all groups down to that level. -1 = expand everything,
  0 = all collapsed.
- isGroupOpenByDefault(node): callback overriding the above per-node. Identify the node by its
  full route (ancestor key path), not just its key — keys are only unique within a parent.

**IMPERATIVE API (match AG Grid names for agent/user familiarity):**
- expandAll() / collapseAll()
- setRowNodeExpanded(nodeId, expanded, expandParents?, forceSync?) — expandParents also opens all
  ancestors; forceSync guarantees the row is laid out before the call returns.
- resetRowGroupExpansion() — discard user toggles, re-evaluate defaults.
- getRowNode(id), and expansion state must be serializable for save/restore (Grid State parity).

**KEYBOARD:**
- ArrowRight on collapsed focused group -> expand. ArrowRight on expanded group -> move focus to
  first child.
- ArrowLeft on expanded group -> collapse. ArrowLeft on collapsed group OR on a leaf -> move focus
  to parent group row.
- Enter/Space on a focused group row toggles it.

---

## Prompt 4 — Sticky group rows (pinning on scroll)

Implement sticky group headers. AG Grid behavior: "when scrolling through an expanded group, the
group row sticks to the top of the grid." Support arbitrary nesting — multiple ancestor headers
stack at the top (country pins, year pins beneath it).

**PER SCROLL FRAME** (on the volatile/overlay layer, not the static body layer):
1. firstIdx = indexForOffset(scrollTop) via prefix-sum array.
2. stickyAncestors = ordered outermost->innermost chain of expanded groups containing firstIdx
   whose descendant range still intersects the viewport.
3. Stack them top-down: ancestor[0] at y=0, ancestor[1] at y=H0, etc.
4. **EVICTION/PUSH-OFF:** as the next sibling group at level <= L scrolls up, translate the pinned
   header at level L upward by the overlap so it slides out exactly as the incoming header
   arrives. (No 1px gap/overlap — test with group height != leaf height.)
5. Paint the sticky band LAST, highest z; body rows clip under it, never deleted.

**REPAINT DISCIPLINE:** the sticky band repaints ONLY when (a) sticky membership/offset changes, or
(b) a pinned header's aggregate ticks. A leaf-cell tick must NOT repaint the band.

**STICKY HEADERS ARE INTERACTIVE:** the chevron hit-test (Prompt 3) must work on pinned headers —
map pointer y into band space first; collapsing a pinned ancestor is the common "close the group
I'm inside" UX.

**PARITY FLAG:** suppressGroupRowsSticky (default false) disables steps 2-5, rendering group rows
inline only.

**ENSURE-CHILDREN-VISIBLE (opt-in):** AG Grid keeps scrollTop fixed on expand, which can leave
children off-screen. Provide ensureIndexVisible(index, position?: 'top'|'middle'|'bottom'|'auto').
Default stays "scroll unchanged"; only scroll when explicitly requested.

---

## Prompt 5 — groupHideOpenParents (the parent-replacement mode)

Implement groupHideOpenParents. Behavior: "upon expanding a group, the group row is replaced by
the first of its children, and only when collapsed is the group row shown again." The expanded
parent's own group row is hidden; its key context migrates into the group column of its children.

**REQUIREMENTS:**
1. In the flatten walk, when groupHideOpenParents===true AND node.expanded===true, do NOT emit the
   node's own group row. Emit its children directly.
2. In multipleColumns/singleColumn display, the hidden parent's key must still be readable on the
   child rows (show the parent key in the parent's group column slot on each child row).
3. AG Grid AUTO-DISABLES sticky groups in this mode. Replicate: if groupHideOpenParents is on,
   force suppressGroupRowsSticky behavior (getStickyAncestors returns []).
4. This also interacts with unbalanced groups (a group whose key is '' behaves as always-expanded
   with its row always hidden) — support groupAllowUnbalanced as a follow-up flag, lower priority.

---

## Prompt 6 — Group selection (checkboxes + descendant cascade)

Implement selection on group rows.

1. **checkboxLocation: 'autoGroupColumn'** renders the selection checkbox inside the group cell (after
   the chevron + value). Otherwise the group checkbox lives in the dedicated checkbox column.
2. **groupSelects modes:**
   - 'self'        : selecting a group selects only the group node.
   - 'descendants' : selecting a group selects all its leaf descendants; the group checkbox shows
                     checked when all descendants selected, indeterminate when some are.
   - 'filteredDescendants': like descendants but only currently-filtered-in leaves.
3. The group checkbox **tri-state** (checked / unchecked / indeterminate) must be derived from
   descendant selection counts, recomputed on any selection change within the subtree.
4. Header **"select all" parity:** selectAll: 'all' | 'filtered' | 'currentPage'.

**CANVAS NOTE:** the checkbox is a hit-testable box painted by the group renderer; its bounds are
distinct from the chevron's. Both must be independently hittable on inline AND sticky headers.

---

## Prompt 7 — Group aggregation display

Implement aggregate values shown on group rows. Group rows summarize their descendants in the
non-group columns.

1. A column with an aggFunc ('sum'|'avg'|'min'|'max'|'count'|custom) shows the aggregated value of
   its descendant leaves on each group row, at every group level (the country row sums all its
   years' leaves; each year row sums its own).
2. Aggregates recompute on: data load, tick updates affecting descendants, expand of a
   lazily-loaded group, and filter changes (aggregate over filtered-in leaves if configured).
3. Pinned sticky headers show the SAME aggregate as the inline group row — and a tick that changes
   a pinned aggregate is one of the only two events allowed to repaint the sticky band (Prompt 4).
4. Optional grand-total / group-total rows (aggregation total rows) as a follow-up.

**TICK PERF:** aggregate recompute on the hot path must be incremental (delta applied up the ancestor
chain), not a full re-aggregation of the subtree, to hold the 100k-row tick target.

---

## Prompt 8 — Group sorting & the row-group panel

Two related behaviors.

**A) GROUP SORTING:**
- Groups sort by their key by default. A sort on the auto group column sorts the group rows at
  each level; within an expanded group, leaf rows sort by the active leaf sort.
- Support sorting groups by an aggregate value (e.g. sort country groups by summed notional) via
  the group column's comparator.
- Sort state is per-level and must survive expand/collapse and be serializable (Grid State).

**B) ROW-GROUP PANEL (drag-to-group UI):**
- A panel showing a pill per active grouped field, in grouping order. Dragging a column header
  into the panel adds it as a grouping level; dragging a pill out removes it; reordering pills
  reorders grouping levels.
- On grouping a column, hide the source column by default; on ungrouping, show it again. Parity
  flags to override: suppressGroupChangesColumnVisibility ('suppressHideOnGroup' |
  'suppressShowOnUngroup' | true).
- rowGroupPanelShow: 'always' | 'onlyWhenGrouping' | 'never'.

This panel is part of the DOM overlay layer (it's chrome, not grid cells), consistent with the
hybrid canvas+DOM architecture.

---

## Parity flag quick-reference

| Flag | Prompt | Purpose | Cycle |
| --- | --- | --- | --- |
| `suppressCount` | 1 | Hide the `(N)` leaf-count suffix | 15.5 / Task 5 |
| `groupRowRendererParams` | 1 | Override inner renderer / value / count | 15.5 / Task 5 |
| `groupDisplayType` | 2 | `singleColumn` \| `multipleColumns` \| `groupRows` | ✅ 15 / Task 5 |
| `groupDefaultExpanded` | 3 | Expand to level N; `-1` = all | ✅ 15 / Task 9 |
| `isGroupOpenByDefault` | 3 | Per-node default-open callback (by route) | 15.5 / Task 4 |
| `suppressGroupRowsSticky` | 4 | Disable sticky group headers | 15.5 / Task 1 |
| `groupHideOpenParents` | 5 | Replace expanded parent row with first child | 15.5 / Task 2 |
| `groupAllowUnbalanced` | 5 | Empty-key groups always-expanded/hidden | Cycle 16+ follow-up |
| `checkboxLocation` | 6 | `autoGroupColumn` vs dedicated checkbox column | 15.5 / Task 3 |
| `groupSelects` | 6 | `self` \| `descendants` \| `filteredDescendants` | 15.5 / Task 3 (✅ 'descendants' in 15 / Task 8) |
| `selectAll` | 6 | `all` \| `filtered` \| `currentPage` | 15.5 / Task 3 |
| `suppressGroupChangesColumnVisibility` | 8 | Keep source columns visible on group/ungroup | 15.5 / Task 5 |
| `rowGroupPanelShow` | 8 | `always` \| `onlyWhenGrouping` \| `never` | ✅ 15 / Task 6 |
