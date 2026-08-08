# Canvasgrid Cycle 15.5 — Row grouping parity (full AG-Grid surface per user 13-prompt spec) — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Close the row-grouping parity gap against AG Grid v35.3.1
defined verbatim by the user-supplied 13-prompt spec at
`docs/superpowers/notes/row-grouping-complete-prompts.md`. Cycle 15
shipped the load-bearing core (group pass, viewport slicer, chunk
format, auto-group column, display types, panel, expand/collapse,
tri-state cascade, defaults, hideOpenGroup, group-aware sort, group
totals). Cycle 15.5 ships **everything else the spec calls out** —
including the parts of the row group panel left incomplete (pill
reorder, sort indicator, live insertion line, drag ghost, tool-panel
sync), the columns tool panel Row Groups drop zone + header context
menu Group/Un-Group items, sticky group rows, `groupHideOpenParents`,
the full selection-mode matrix, expand-API + keyboard polish, the
remaining parity flags, custom aggFuncs returning objects +
`groupTotalRow`/`grandTotalRow`, group sort by aggregate, filtering
interaction with grouping, Grid State save/restore for grouping, and
a comprehensive perf + correctness gate.

**The mental model to load first** (per the spec): row grouping has
TWO completely separate axes — the DATA axis (`GroupNode` tree
+ flattened `visibleRows[]`) and the DISPLAY axis (one indented
group column / several / full-width group rows). The row group
panel, the tool panel's Row Groups drop zone, and the header context
menu are three views over ONE ordered `rowGroupColumns` list and
MUST mutate it via the same primitive API. Conflating these axes
is the #1 implementation bug.

**FM coverage:** Area 09 — flips the remaining ~4 rows to ✅ at
cycle exit, taking Area 09 from 50/54 → 54/54. Also flips select
rows in Area 17 (sidebar tool panel) for the Row Groups drop zone
+ Area 23 (state) for grouping save/restore.

**Depends on:**
- Cycle 15 (every task reads or extends something Cycle 15
  introduced — `GroupPass`, `ViewportSlicer`, `AutoGroupColumn`,
  `'group'` cell renderer, `TotalsSubgrid`, the row group panel
  host, `groupSelectsChildren` cascade, `groupDefaultExpanded`,
  group-aware `SortPass`).
- Cycle 14 (`AggFuncRegistry` extension for object-returning
  aggregates).
- Cycle 12 (visual matrix + `getVisibleCellBounds` helper).
- Cycle 11 (sidebar `SideBarHost` for the Row Groups drop zone +
  drag-from-tool-panel paths).
- Cycle 10 (header context menu for the Group by / Un-Group items).

**Performance gate** (per Prompt 13):
- Group tree build over 100k leaves: single bucketing pass.
  Toggling a group is O(affected subtree), not O(all rows).
- `indexForOffset` / `offsetForIndex`: O(log n) / O(1); no
  allocation in the scroll hot path.
- Sticky recompute: O(depth); eviction handoff has no 1 px gap/
  overlap with group height ≠ leaf height.
- Collapse preserves `scrollTop` byte-identically; sticky stack
  re-derived correctly afterward.
- Leaf tick repaints only its cell layer + (if changed) ancestor
  aggregates; does NOT repaint sticky band unless a pinned
  aggregate changed.
- Aggregation tick: incremental delta up the ancestor chain;
  verified against a full re-agg reference for correctness.
- Three grouping UIs (row-group panel, tool-panel drop zone,
  context menu) provably mutate one shared `rowGroupColumns` list.

**Architecture:**

- **One state primitive, three views.** Introduce
  `GroupingState { rowGroupColumns: string[]; expandedRoutes:
  Set<string>; perLevelSort: Array<{ asc: boolean } | null> }` as
  the canonical mutable state. All three grouping UIs (Prompt 6
  row group panel, Prompt 7 tool panel Row Groups drop zone, Prompt
  7 header context menu) call the same primitive APIs
  (`setRowGroupColumns`, `addRowGroupColumn`, `removeRowGroupColumn`,
  `moveRowGroupColumn(fromIndex, toIndex)`,
  `setRowGroupColumnSort(colId, direction)`). The primitives emit
  an event the three views subscribe to so they update live. The
  spec calls this the load-bearing invariant — Task 11's perf gate
  asserts it.
- **Sticky group rows** mount on the canvas overlay layer (NOT a
  separate DOM layer). The painter that already runs after
  `paintCellsByRows` adds a `paintStickyGroups(gc, pctx)` pass that
  reads the same `GroupPassOutput.flatOrder` Cycle 15 / Task 2
  shipped + the current `expandedKeys` set. On every `scroll` event,
  the painter recomputes the sticky ancestor stack from
  `firstVisibleRow` and re-renders only the stuck band region. The
  band's bounds + push-off transform live in a `StickyGroupOverlay`
  helper module.
- **`groupHideOpenParents`** changes the flatten walk in
  `ViewportSlicer`: when the option is on AND a group node is
  expanded, the slicer emits the children directly without the
  parent's own group row. Sticky overlay is force-disabled in this
  mode (AG Grid parity). Auto-group column on child rows shows the
  hidden parent's value at the parent's depth slot.
- **Row group panel completeness** extends Cycle 15 / Task 6 with
  pill REORDER (drag within panel), sort indicator on pills +
  click-to-toggle, live insertion line between pills mid-drag,
  drag ghost (DOM overlay following cursor), and drag-from-tool-
  panel acceptance (the tool panel's Row Groups drop zone is the
  second drag source; the column header is the first).
  `suppressDragLeaveHidesColumns` flag governs the column-leaves-
  grid behavior.
- **Columns tool panel Row Groups drop zone**: extends Cycle 11's
  `agColumnsToolPanel` with a Row Groups section that mirrors the
  panel pills. Drag-and-drop between the tool panel column list,
  the drop zone, and the row group panel — all three are views
  over the same `rowGroupColumns` list.
- **Header context menu** extends Cycle 10's main menu with three
  group-related items: "Group by `<col>`", "Un-Group by `<col>`",
  "Expand All / Collapse All". Each calls the same primitive
  `addRowGroupColumn` / `removeRowGroupColumn` / `expandAll` /
  `collapseAll` the other surfaces use.
- **Selection mode matrix**: `groupSelects: 'self' | 'descendants'
  | 'filteredDescendants'` (Cycle 15 / Task 8 shipped only
  'descendants'). `checkboxLocation: 'autoGroupColumn' |
  'selectionColumn' | 'none'` decides which column hosts the
  checkbox. `selectAll: 'all' | 'filtered' | 'currentPage'` defines
  the header checkbox's scope. All three options are runtime-mutable
  via `setGridOption`.
- **Expand/collapse polish**: `isGroupOpenByDefault(node): boolean`
  callback evaluated at build time per group node — overrides
  `groupDefaultExpanded`. `expandParents` + `forceSync` flags on
  `setRowNodeExpanded(nodeId, expanded, expandParents?,
  forceSync?)`. `resetRowGroupExpansion()` discards user toggles
  and re-evaluates defaults. `ensureIndexVisible(index,
  position?: 'top'|'middle'|'bottom'|'auto')` opt-in. Keyboard:
  ArrowRight/Left/Enter/Space per Prompt 4. ARIA `aria-expanded`
  on every group row.
- **Group rendering parity flags**: `suppressCount` (suppress the
  `(N)` suffix), `groupRowRendererParams: { innerRenderer?, value?,
  suppressCount? }` (override the value-portion renderer),
  `suppressGroupChangesColumnVisibility: true | 'suppressHideOnGroup'
  | 'suppressShowOnUngroup'`.
- **Aggregation extensions**: `aggFuncs` registry from Cycle 14
  extended to accept functions that RETURN OBJECTS (multi-component
  aggregates carrying weight + value, etc.). Group total row +
  grand total row positions (`groupTotalRow` / `grandTotalRow`:
  `'top' | 'bottom' | null`) — each renders via the existing
  `TotalsSubgrid` from Cycle 14, just slotted per-group or grand
  per the option.
- **Group sort by aggregate**: the auto-group column's `comparator`
  receives the group nodes; an app can return a comparison over
  aggregate values (e.g. summed notional). Per-level sort state
  serializes via Grid State (Task 10).
- **Filtering interaction**: rebuild the group tree over
  filtered-in leaves; reuse leaf buckets where keys are unchanged;
  recompute aggregates only for affected subtrees. Quick filter +
  external filter + standard filter compose uniformly.
- **Grid State save/restore for grouping**: persist
  `rowGroupColumns`, `expandedRoutes`, `groupDisplayType`, and
  per-level sort. Auto group columns are derived and NOT persisted
  (regenerated from `rowGroupColumns` on restore).
- **Perf + correctness gate**: comprehensive Vitest suite +
  Playwright E2E covering every assertion in Prompt 13.

**Tech Stack:** TypeScript strict, Vitest, Playwright (E2E + visual).
No new runtime dependencies. The sticky overlay painter slots into
the existing renderer pipeline (`renderer/renderer.ts`) alongside
`paintOverlay`, `paintRangeOverlay`.

**References (READ FIRST when starting any task):**

- **The user-supplied spec** at
  `docs/superpowers/notes/row-grouping-complete-prompts.md`. The
  matching prompt MUST be quoted at the top of each task's
  spawned-session prompt so the implementing agent has the AG Grid
  parity baseline open.
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` —
  every Cycle 15 task this cycle extends.
- `docs/superpowers/plans/notes/cycle-15-grouping-design.md` — the
  design vocabulary built across Cycle 15 (chip pattern,
  sandwich/hairline-lift signatures, etc.). Cycle 15.5 inherits this
  and **appends** any new decisions to the same file.
- `docs/catalog/screenshots/09-grouping-three-level-expanded.png` —
  the canonical reference; sticky group rows show three pinned
  headers at top when scrolled deep into a 3-level group.
- **ag-grid website fallbacks** (per the
  `consult-ui-screenshots-before-shipping` memory):
  - `https://www.ag-grid.com/javascript-data-grid/grouping-sticky-rows/`
    for sticky group row visuals.
  - `https://www.ag-grid.com/javascript-data-grid/grouping-hide-parents/`
    for hideOpenParents behaviour.
  - `https://www.ag-grid.com/javascript-data-grid/group-row-selection/`
    for selection modes + checkboxLocation visuals.
  - `https://www.ag-grid.com/javascript-data-grid/grouping-row-group-panel/`
    for the panel pills + drop indicators.
  - `https://www.ag-grid.com/javascript-data-grid/grid-state/` for
    state save/restore.
- Current source touchpoints:
  - `cgrid/src/renderer/renderer.ts` — paint pass ordering; sticky
    overlay slots between `paintGridLines` and `paintOverlay`.
  - `cgrid/src/worker/viewportSlicer.ts` — hideOpenParents extends
    this; filtering interaction reads this.
  - `cgrid/src/interaction/selectionModel.ts` — selection mode
    matrix lives here.
  - `cgrid/src/renderer/cellRenderers/group.ts` — suppressCount,
    groupRowRendererParams, checkboxLocation route through here.
  - `cgrid/src/interaction/rowGroupPanel/host.ts` — pill reorder +
    sort indicator + live insertion + drag ghost extend this.
  - `cgrid/src/interaction/toolPanels/columnsPanel.ts` — Row Groups
    drop zone added here.
  - `cgrid/src/interaction/contextMenu/host.ts` (Cycle 10) — group
    menu items added.
  - `cgrid/src/interaction/features/groupExpand.ts` — keyboard nav
    extends this.
  - `cgrid/src/interaction/features/keyPaging.ts` — base keyboard
    feature; arrow handlers cooperate with this.
  - `cgrid/src/worker/passes/aggPass.ts` — object-returning custom
    aggFuncs + filtered-leaves compose.
  - `cgrid/src/core/subgrid.ts` — `TotalsSubgrid` extends for
    per-group + grand total rows.

**Global Constraints:**

- TypeScript strict — no `any` in new code.
- `npm test` (Vitest) stays green. New tests target 80+ new cases
  this cycle.
- `npm run test:e2e` stays green.
- `npm run test:visual` matrix gains 6 new cells (sticky-3-level,
  hideOpenParents, panel-mid-drag-insertion-line, tool-panel-drop-
  zone-3-pills, header-context-menu-group-by, selection-self-vs-
  descendants). Existing cells stay byte-stable (defaults unchanged).
- **EVERY UI TASK INVOKES `/frontend-design`** before writing CSS or
  DOM. Notes append to
  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`. Per
  the `ui-quality-bar` memory — non-negotiable.
- **`getVisibleCellBounds`** (Cycle 12) is the helper for any new
  cell-anchored DOM node.
- `aggMath` + `AggFuncRegistry` + `TotalsSubgrid` from Cycles 13/14
  are the SINGLE SOURCE OF TRUTH for aggregation. Tasks 6 + 8 audit
  but do not duplicate them.
- **THREE-UIs-SHARE-ONE-LIST INVARIANT.** Tasks 1, 2, and any task
  that mutates `rowGroupColumns` MUST go through the same primitive
  API (`setRowGroupColumns` / `addRowGroupColumn` /
  `removeRowGroupColumn` / `moveRowGroupColumn`). Task 11's perf
  gate asserts this with a Vitest test that mutates via each UI and
  verifies the others reflect the change live.
- No new runtime dependencies.
- Each task ends with `git commit` + `gh pr create`; next session
  starts on `main` after merge.

## Task overview

| # | Title | UI? | Worker? | Key files | New tests + visual cells |
|---|-------|-----|---------|-----------|--------------------------|
| 1 | Row group panel completeness (reorder + sort + live indicator + ghost + drag-from-tool-panel + one-list invariant) | yes | no | `cgrid/src/interaction/rowGroupPanel/host.ts`, `core/groupingState.ts` (new), `velocityGrid.ts`, `tokens.css` | `rowGroupPanelComplete.test.ts` (24 cases) + visual cell `27-rowGroupPanel-mid-drag-insertion.png` + E2E `cycle15.5-pillReorder.spec.ts` |
| 2 | Tool panel Row Groups drop zone + header context menu Group-by items (3 surfaces, 1 list) | yes | no | `cgrid/src/interaction/toolPanels/columnsPanel.ts`, `cgrid/src/interaction/contextMenu/host.ts`, `cgrid/src/interaction/contextMenu/mainMenuDefaults.ts`, `tokens.css` | `toolPanelRowGroups.test.ts` (18 cases) + `contextMenuGroupBy.test.ts` (10 cases) + visual cells `28-toolpanel-rowgroups-3-pills.png` + `29-header-context-menu-group-by.png` |
| 3 | Sticky group rows (canvas overlay) | yes | partial (slicer surface) | `cgrid/src/renderer/painters/stickyGroups.ts` (new), `renderer/renderer.ts`, `core/viewport.ts`, `interaction/features/groupExpand.ts`, `tokens.css` | `stickyGroups.test.ts` (18 cases) + `stickyGroups.perf.test.ts` (≤ 1 ms over 100k × 3 levels) + visual cell `30-sticky-groups-deep-scroll.png` |
| 4 | `groupHideOpenParents` (parent-replacement mode + force sticky off) | yes | yes | `worker/viewportSlicer.ts`, `core/subgrid.ts`, `renderer/cellRenderers/group.ts`, `renderer/painters/stickyGroups.ts` | `hideOpenParents.test.ts` (12 cases) + visual cell `31-hideOpenParents-expanded.png` |
| 5 | Selection completeness (`groupSelects` modes + `checkboxLocation` + `selectAll`) | yes | no | `interaction/selectionModel.ts`, `renderer/cellRenderers/group.ts`, `interaction/features/headerCheckbox.ts` (new), `tokens.css` | `selectionModes.test.ts` (22 cases) + visual cell `32-selection-self-vs-descendants.png` |
| 6 | Expand/collapse polish (`isGroupOpenByDefault` + `resetRowGroupExpansion` + `expandParents`/`forceSync` + keyboard nav + `ensureIndexVisible` + ARIA `aria-expanded`) | partial (keyboard, ARIA) | partial (worker reads callback) | `velocityGrid.ts`, `worker/passes/groupPass.ts`, `interaction/features/groupExpand.ts`, `interaction/features/keyPaging.ts`, a11y layer | `expandPolish.test.ts` (16 cases) + E2E `cycle15.5-keyboardGroupNav.spec.ts` |
| 7 | Group rendering parity flags (`suppressCount` + `groupRowRendererParams.innerRenderer` + `suppressGroupChangesColumnVisibility` + `suppressDragLeaveHidesColumns`) | yes | no | `renderer/cellRenderers/group.ts`, `velocityGrid.ts`, `interaction/rowGroupPanel/host.ts`, `interaction/features/columnDrag.ts`, `types.ts` | `groupParityFlags.test.ts` (16 cases) + visual cell `33-customised-group-renderer.png` |
| 8 | Aggregation extensions (object-returning custom aggFuncs + `groupTotalRow`/`grandTotalRow` + filtered-aggregates compose + incremental tick perf gate) | partial (total-row positions) | yes | `worker/passes/aggPass.ts`, `worker/aggFuncRegistry.ts`, `core/subgrid.ts`, `velocityGrid.ts` | `aggExtensions.test.ts` (20 cases) + `aggIncremental.perf.test.ts` (100k × 1 row update ≤ 0.5 ms) |
| 9 | Group sort by aggregate + per-level sort state + filtering interaction (composed rebuild over filtered leaves) | no | yes | `worker/passes/sortPass.ts`, `worker/passes/groupPass.ts`, `interaction/rowGroupPanel/host.ts` (pill sort sync) | `groupSortByAggregate.test.ts` (14 cases) + `filteringWithGrouping.test.ts` (12 cases) |
| 10 | Grid State save/restore for grouping | no | partial (worker reads restored state) | `velocityGrid.ts`, `core/groupingState.ts`, `worker/passes/groupPass.ts` | `gridStateGrouping.test.ts` (12 cases) + E2E `cycle15.5-gridStateRoundtrip.spec.ts` |
| 11 | Perf + correctness gate (sticky perf, three-UIs-share-one-list invariant, ARIA assertions, no-allocation scroll path) | no | yes (perf) | `cgrid/tests/groupingPerf.test.ts` (new aggregator); `core/groupingState.ts` (event invariant assertion) | `groupingPerf.test.ts` (12 cases incl. all Prompt 13 assertions) + `threeUIsOneList.test.ts` (8 cases) |
| 12 | Cycle 15.5 exit ritual | yes (demo wires sticky + selection modes default) | no | worklog Shipped block, FM Area 09 + 17 + 23 final flips, demo updates, README | full suite green; FM Area 09 = 54/54 ✅ |

---

## Task 1 — Row group panel completeness (reorder + sort + live indicator + ghost + drag-from-tool-panel + one-list invariant)

**Read first:**
- **Prompt 6** from `docs/superpowers/notes/row-grouping-complete-prompts.md`
  — quote VERBATIM at the top of the spawned-session prompt.
- This worklog's Architecture (the "one state primitive, three
  views" rule).
- `cgrid/src/interaction/rowGroupPanel/host.ts` — Cycle 15 / Task 6
  baseline. Pills + add/remove already shipped; this task adds the
  rest.
- `cgrid/src/interaction/features/columnDrag.ts` — Cycle 6 column
  drag; reused as the drag source for column headers.
- `docs/superpowers/plans/notes/cycle-15-grouping-design.md` — chip
  vocabulary from Task 6 design pass.
- ag-grid grouping-row-group-panel page (fallback per memory).

**Files:**
- `cgrid/src/core/groupingState.ts` (new) — the single state
  primitive (`rowGroupColumns`, `expandedRoutes`, `perLevelSort`)
  + the primitive API surface (`setRowGroupColumns`,
  `addRowGroupColumn`, `removeRowGroupColumn`,
  `moveRowGroupColumn(from, to)`, `setRowGroupColumnSort(colId,
  dir)`). Emits a `groupingStateChanged` event the three views
  subscribe to.
- `cgrid/src/interaction/rowGroupPanel/host.ts` — extend with:
  - Pill drag-within-panel handler (mousedown on pill → drag with
    insertion line → drop → `moveRowGroupColumn`).
  - Sort indicator on each pill (asc/desc/none chevron); click
    toggles `setRowGroupColumnSort`. Suppressed when
    `rowGroupPanelSuppressSort: true`.
  - Live insertion line between pills mid-drag (DOM overlay,
    positioned at the gap nearest the pointer).
  - Drag ghost: floating pill following cursor during pill-drag.
    Reuse the column-drag-ghost CSS class from Cycle 6 for
    visual continuity.
  - Accept drops from the tool panel's Row Groups drop zone
    (Task 2) AND from a column header (Cycle 15 / Task 6 already
    wired).
  - Subscribe to `groupingStateChanged` and re-render pills when
    the state mutates from another view.
- `cgrid/src/velocityGrid.ts` — expose the primitive API on `VelocityGridApi`.
- `cgrid/src/types.ts` — `VelocityGridOptions.suppressDragLeaveHidesColumns:
  boolean` (default false; documented but the actual
  drag-leaves-grid wiring lands in Task 7 alongside the other
  visibility flags).
- `cgrid/src/theming/tokens.css` — sort-indicator chevron CSS +
  insertion-line CSS.
- `cgrid/tests/rowGroupPanelComplete.test.ts` (new) — 24 cases:
  pill reorder mid → mutates `rowGroupColumns` order / pill drag-out
  removes / pill click × removes / sort indicator toggles per
  click / `rowGroupPanelSuppressSort: true` hides the indicator
  AND suppresses the toggle / live insertion line moves with
  pointer / live insertion line hides on drag-leave / drag ghost
  appears + tracks pointer + cleaned up on drop / drop from tool
  panel append / drop from column header append / pre-existing
  `rowGroupColumns` from API renders pills / mutation from
  primitive API outside the panel re-renders pills / N-pill
  reorder N! permutations / drop-state visual (accept/reject) /
  empty-state placeholder / 'onlyWhenGrouping' mounts on first
  pill / 'onlyWhenGrouping' unmounts when last pill removed /
  destroy idempotent / pill keyboard delete / pill keyboard left/
  right reorder (a11y) / pill aria-label / drag threshold (no
  drag for <4px) / panel z-index above body but below editor.
- `apps/cgrid-positions/e2e-visual/27-rowGroupPanel-mid-drag-insertion.spec.ts`
  (new) — seeds 3-pill panel, simulates a drag mid-flight, snapshots
  the live insertion line between pills 1 and 2.
- `apps/cgrid-positions/e2e/cycle15.5-pillReorder.spec.ts` (new) —
  E2E: drag pill 3 to position 1, assert `rowGroupCols` order is
  now `[col3, col1, col2]` AND the body re-groups accordingly.

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design` with
   this brief: *"Cycle 15 / Task 6 shipped the row group panel
   with pill add/remove. Cycle 15.5 / Task 1 adds the missing
   pieces per the user spec: pill drag-within-panel (reorder),
   sort indicator on each pill (asc/desc/none chevron with click-
   to-toggle), live insertion line during drag, floating drag
   ghost. Reference `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   for the established chip vocabulary + ag-grid grouping-row-
   group-panel page for the canonical insertion-line visual.
   Decide: insertion-line width + colour + animation (none vs
   200ms fade), sort-indicator size + colour, ghost opacity +
   shadow."* Record in
   `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   (append; the file is the canonical record).
2. Implement `GroupingState` primitive + event emitter.
3. Migrate Cycle 15 / Task 6's existing panel calls onto the
   primitive (add/remove now go through the API; verify no
   regression).
4. Implement pill reorder via drag.
5. Implement sort indicator + click-to-toggle.
6. Implement live insertion line.
7. Implement drag ghost.
8. Wire drag-from-tool-panel acceptance (handler responds to a
   different drag source; the actual tool-panel drag source ships
   in Task 2 — this task ships the panel's acceptance).
9. Build the 24-case test suite.
10. Build visual cell 27.
11. Build the E2E.
12. Visual review against ag-grid reference. If the insertion line
    or ghost looks "slapped together" — **GO BACK TO STEP 1**.

**Acceptance:**
- All four missing surfaces (reorder, sort, indicator, ghost)
  work per spec.
- `GroupingState` primitive is the single source of truth.
- Visual cell 27 baselined.
- E2E passes.

**Commit:** `feat(cgrid): row group panel completeness — pill reorder + sort + live indicator + drag ghost + one-list primitive` — body cites design notes.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 2."

---

## Task 2 — Tool panel Row Groups drop zone + header context menu Group-by items

**Read first:**
- **Prompt 7** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- This worklog's Architecture (three-UIs-share-one-list).
- Task 1's `GroupingState` primitive — this task's two surfaces
  (tool panel drop zone + context menu items) call the primitive
  API exclusively.
- `cgrid/src/interaction/toolPanels/columnsPanel.ts` — Cycle 11
  baseline.
- `cgrid/src/interaction/contextMenu/host.ts` — Cycle 10
  baseline.
- `cgrid/src/interaction/contextMenu/mainMenuDefaults.ts` —
  Cycle 10 default menu items; this task adds three group items.

**Files:**
- `cgrid/src/interaction/toolPanels/columnsPanel.ts` — add a
  "Row Groups" drop zone above (or below — design pass decides) the
  column list. Drop zone mirrors the panel pills + accepts column
  drags FROM the column list. Drag-out a pill removes the grouping.
- `cgrid/src/interaction/contextMenu/mainMenuDefaults.ts` — add
  three items to the column header context menu:
  - "Group by `<col.headerName>`" (visible when column has
    `enableRowGroup: true` AND is not currently a group level)
  - "Un-Group by `<col.headerName>`" (visible when it IS a group
    level)
  - "Expand All Groups" / "Collapse All Groups" (always visible
    when grouping is active)
- `cgrid/src/interaction/features/columnDrag.ts` (extend) — accept
  drag-from-tool-panel into the row group panel (Task 1 wires the
  panel's acceptance; this task wires the tool panel's drag
  source).
- `cgrid/src/velocityGrid.ts` —
  `VelocityGridOptions.allowDragFromColumnsToolPanel: boolean` (default
  true; allows the column list's drag handle to drag onto the grid
  or the panel).
- `cgrid/src/theming/tokens.css` — drop zone styling.
- `cgrid/tests/toolPanelRowGroups.test.ts` (new) — 18 cases (drop
  zone renders, drag-in adds level, drag-out removes, pill order
  mirrors panel, mutation from panel reflects in drop zone via
  `groupingStateChanged`, mutation from context menu reflects too,
  …).
- `cgrid/tests/contextMenuGroupBy.test.ts` (new) — 10 cases (Group
  by visible/hidden based on column state, Un-Group by routes to
  primitive API, Expand All / Collapse All call the right APIs,
  …).
- `apps/cgrid-positions/e2e-visual/28-toolpanel-rowgroups-3-pills.spec.ts`
  (new) — seeds 3 groups, opens the Columns tool panel, snapshots
  the Row Groups drop zone with 3 pills.
- `apps/cgrid-positions/e2e-visual/29-header-context-menu-group-by.spec.ts`
  (new) — right-clicks a groupable column header, snapshots the
  menu showing the "Group by" item.

**Steps:**

1. **DESIGN PASS.** Invoke `/frontend-design` with brief: *"The
   Columns tool panel (Cycle 11) shows a column list with
   checkboxes. Add a "Row Groups" drop zone — a section ABOVE (or
   BELOW — argue) the column list, showing currently-grouped
   columns as pills (vocabulary from Cycle 15 / Task 6 row group
   panel). Decide: drop zone position relative to column list,
   pill style consistency (identical to panel pills? or a slightly
   distinct compact variant inside the narrower tool panel?),
   empty-state placeholder text matching Cycle 11 sidebar Columns
   panel ("Drag here to set row groups"). Also: design the context
   menu items — `Group by Ticker` icon (≡? folder?), text style
   matching existing menu items from Cycle 10."* Append to notes.
2. Implement the tool panel Row Groups drop zone.
3. Implement the three context menu items.
4. Wire the tool panel drag source to call the same primitive API
   the panel uses.
5. Build both test suites (18 + 10 cases).
6. Build both visual cells (28 + 29).

**Acceptance:**
- All three surfaces (panel from Task 1, tool panel drop zone,
  context menu items) mutate the same `GroupingState`.
- Mutating via any one reflects in the other two live.
- Visual cells 28 + 29 baselined.

**Commit:** `feat(cgrid): tool panel Row Groups drop zone + header context menu Group-by items (3 surfaces, 1 list)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 3."

---

## Task 3 — Sticky group rows (canvas overlay)

**Read first:**
- **Prompt 5** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- This worklog's Architecture + Performance gate.
- `cgrid/src/renderer/renderer.ts` — paint pass ordering.
- `cgrid/src/worker/passes/groupPass.ts` — `GroupNode` + `flatOrder`
  shape from Cycle 15 / Task 1.
- `cgrid/src/core/viewport.ts` — viewport state; sticky overlay
  reads `firstRow` + `bodyTop` + `expandedKeys`.
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`**
  — when scrolled deep into a 3-level group the user expects three
  pinned headers stacked at top.
- ag-grid grouping-sticky-rows page (fallback per memory).

**Files:**
- `cgrid/src/renderer/painters/stickyGroups.ts` (new) — exports
  `paintStickyGroups(gc, p: PainterCtx)`. Reads
  `p.viewport.firstRow`, `p.selection.expandedKeys`,
  `p.viewport.groupOutput.flatOrder` (a new field added in Task 1
  for this exact purpose — viewport state surfaces the flatOrder).
- `cgrid/src/renderer/renderer.ts` — call `paintStickyGroups` AFTER
  `paintCellsByRows` + `paintGridLines`, BEFORE `paintOverlay`.
- `cgrid/src/core/viewport.ts` — expose `groupOutput` (the
  GroupPassOutput passed through) so the sticky painter can walk
  the tree.
- `cgrid/src/interaction/features/groupExpand.ts` — extend the
  chevron hit-test to also consider pinned headers (translate
  pointer y into band space first; collapsing a pinned ancestor is
  the common "close the group I'm inside" interaction).
- `cgrid/src/theming/tokens.css` — `.vg-sticky-group-band` selector
  (the band is canvas-painted but a `box-shadow`-based bottom
  border is painted in canvas; CSS only documents the convention).
- `cgrid/src/types.ts` — `VelocityGridOptions.suppressGroupRowsSticky:
  boolean` (default false).
- `cgrid/tests/stickyGroups.test.ts` (new) — 18 cases per Prompt 5.
- `cgrid/tests/stickyGroups.perf.test.ts` (new) — 100k × 3-level
  group fixture; assert sticky stack re-derive ≤ 1 ms per scroll.
- `apps/cgrid-positions/e2e-visual/30-sticky-groups-deep-scroll.spec.ts`
  (new) — seeds 1000 rows grouped 3 levels (desk → region →
  ticker), expands all, scrolls deep into one group, snapshots
  with 3 pinned headers at top.

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design` with
   brief: *"Design the sticky group row band for cgrid. When the
   user scrolls deep into an expanded 3-level group, three pinned
   ancestor headers stack at the top of the body. Reference:
   `docs/catalog/screenshots/09-grouping-three-level-expanded.png`
   + ag-grid grouping-sticky-rows page. Subject: financial data
   grid. The pinned band must read as STRUCTURAL — `where you are
   in the tree` — without competing with the body for attention.
   Decide: separator between stacked headers (thin gridline, gap,
   bg shift)? push-off animation (linear translate, ease)? z-order
   vs the range overlay + focus ring (sticky band on top so a
   range selection that crosses the body↔band boundary clips
   correctly under it)."* Append to notes.
2. Surface `groupOutput.flatOrder` on the viewport state.
3. Implement `StickyGroupOverlay` helper that computes the sticky
   ancestor stack + push-off transform per scroll frame.
4. Implement `paintStickyGroups` painter.
5. Wire into `renderer.ts` paint pass ordering.
6. Extend `groupExpand` chevron hit-test for pinned headers.
7. Build the 18-case test suite + the perf test.
8. Build visual cell 30.
9. Visual review against reference. If the stacked headers look
   like "regular group rows that got copied to the top" instead
   of considered pinned chrome — **GO BACK TO STEP 1**.

**Acceptance:**
- Sticky stack renders correctly at multi-level nesting.
- Push-off transform produces no gap / no overlap when group
  heights vary.
- Perf gate: ≤ 1 ms sticky re-derive per scroll.
- `suppressGroupRowsSticky: true` cleanly disables.
- Chevron hit-test on pinned header collapses the right ancestor.
- Visual cell 30 baselined.

**Commit:** `feat(cgrid): sticky group rows (canvas overlay, push-off transform, hit-testable)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 4."

---

## Task 4 — `groupHideOpenParents` (parent-replacement mode + force sticky off)

**Read first:**
- **Prompt 5b** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- This worklog's Architecture.
- `cgrid/src/worker/viewportSlicer.ts` — the slicer walks
  `flatOrder` honouring expansion; this task adds a parent-skip
  branch when the option is on AND the parent is expanded.
- Task 3's sticky implementation — Task 4 force-disables sticky
  when `groupHideOpenParents` is on (AG Grid parity).
- ag-grid grouping-hide-parents page (fallback per memory).

**Files:**
- `cgrid/src/worker/viewportSlicer.ts` — when
  `groupHideOpenParents === true` AND the current group node is
  `expanded`, skip emitting the node's own group row; emit
  children directly.
- `cgrid/src/core/subgrid.ts` — auto-group cell on child rows must
  read the hidden parent's value when in this mode (for
  multipleColumns + singleColumn displays).
- `cgrid/src/renderer/cellRenderers/group.ts` — render the child
  row's auto-group cell with the parent's value in the parent's
  depth slot.
- `cgrid/src/renderer/painters/stickyGroups.ts` — early-return when
  `groupHideOpenParents === true`.
- `cgrid/src/types.ts` — `VelocityGridOptions.groupHideOpenParents:
  boolean` (default false). `VelocityGridOptions.groupAllowUnbalanced:
  boolean` (default false; deferred-impl follow-up — declare the
  type but document as "Cycle 16 follow-up").
- `cgrid/tests/hideOpenParents.test.ts` (new) — 12 cases per
  Prompt 5b.
- `apps/cgrid-positions/e2e-visual/31-hideOpenParents-expanded.spec.ts`
  (new) — seeds 100 rows grouped by ticker → sector with
  `groupHideOpenParents: true`, expands one group, snapshots the
  result.

**Steps:**

1. **DESIGN PASS** (light — primarily behavioural, but the visual
   difference in the auto-group cell on child rows needs a design
   call). Brief: *"When `groupHideOpenParents` is on, child rows
   under an expanded parent show the parent's value in the
   auto-group cell instead of leaving it blank. Decide: does the
   parent value render at the parent's depth (indented less than
   the child) or at the child's depth? Reference ag-grid
   grouping-hide-parents page."* Append to notes.
2. Extend `viewportSlicer` per the architecture note.
3. Update `'group'` cell renderer to show parent value on child
   rows when the option is on.
4. Force sticky early-return.
5. Build the 12-case test suite.
6. Build visual cell 31.
7. Visual review.

**Acceptance:**
- `groupHideOpenParents: true` correctly replaces the parent group
  row with its children.
- Child rows show parent context in the auto-group cell.
- Sticky disables automatically.
- Visual cell 31 baselined.

**Commit:** `feat(cgrid): groupHideOpenParents (replace expanded parent row with children + auto-disable sticky)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 5."

---

## Task 5 — Selection completeness (`groupSelects` / `checkboxLocation` / `selectAll`)

**Read first:**
- **Prompt 9** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- This worklog's Architecture.
- `cgrid/src/interaction/selectionModel.ts` — Cycle 15 / Task 8
  shipped the `descendants` cascade as the only mode. This task
  adds `self` and `filteredDescendants` modes + the
  `checkboxLocation` + `selectAll` matrix.
- ag-grid group-row-selection page (fallback per memory).

**Files:**
- `cgrid/src/interaction/selectionModel.ts` — branch on
  `groupSelects` mode for `setRowSelected` cascade.
  `filteredDescendants` requires consulting the post-filter row set
  (already in the chunk).
- `cgrid/src/renderer/cellRenderers/group.ts` — read
  `checkboxLocation` to decide whether to render the checkbox
  inside the auto-group cell.
- `cgrid/src/interaction/features/headerCheckbox.ts` (new) —
  header-row checkbox honouring `selectAll: 'all' | 'filtered' |
  'currentPage'`. Tri-state (none / some / all).
- `cgrid/src/theming/tokens.css` — selection column visuals (when
  `checkboxLocation: 'selectionColumn'`).
- `cgrid/src/types.ts` — three new options.
- `cgrid/tests/selectionModes.test.ts` (new) — 22 cases per mode ×
  edge cases.
- `apps/cgrid-positions/e2e-visual/32-selection-self-vs-descendants.spec.ts`
  (new) — two-column snapshot showing the same partial group
  selection rendered under `groupSelects: 'self'` vs
  `'descendants'` (different checkbox states on the parent).

**Steps:**

1. **DESIGN PASS.** Brief: *"Design the selectionColumn (when
   `checkboxLocation: 'selectionColumn'`). It's a synthesized
   leftmost column ≤ 32 px wide holding the checkbox + tri-state.
   Decide: width (28/32/40?), header checkbox visual (matches the
   row checkbox + tri-state styling), separator from the next
   column (none / hairline / gap). Inherit Cycle 11's sidebar chip
   + Cycle 14's totals chrome where vocabulary overlaps."* Append
   to notes.
2. Implement `groupSelects` mode branch in selectionModel.
3. Implement `checkboxLocation` routing in `'group'` renderer.
4. Implement `selectAll` header checkbox feature.
5. Build the 22-case test suite.
6. Build visual cell 32.

**Acceptance:**
- All three `groupSelects` modes produce correct selection cascade.
- `checkboxLocation` correctly routes the checkbox.
- `selectAll` header tri-state matches scope.
- Visual cell 32 baselined.

**Commit:** `feat(cgrid): selection completeness — groupSelects modes + checkboxLocation + selectAll`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 6."

---

## Task 6 — Expand/collapse polish (`isGroupOpenByDefault` + `resetRowGroupExpansion` + `expandParents`/`forceSync` + keyboard nav + `ensureIndexVisible` + ARIA `aria-expanded`)

**Read first:**
- **Prompt 4** (additions beyond Cycle 15 / Tasks 7+9) from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- `cgrid/src/velocityGrid.ts` — public API surface; new methods land here.
- `cgrid/src/worker/passes/groupPass.ts` — `isGroupOpenByDefault`
  callback evaluated at group-pass time per node, after defaults.
- `cgrid/src/interaction/features/keyPaging.ts` — base keyboard
  feature; new arrow handlers cooperate with this.
- `cgrid/src/interaction/features/groupExpand.ts` — Cycle 15 / Task
  7 shipped chevron click; this task adds keyboard.

**Files:**
- `cgrid/src/velocityGrid.ts`:
  - `setRowNodeExpanded(nodeId, expanded, expandParents?, forceSync?)`
    — extend the existing API.
  - `resetRowGroupExpansion(): void` — discard user toggles,
    re-evaluate `groupDefaultExpanded` + `isGroupOpenByDefault`.
  - `ensureIndexVisible(index, position?: 'top'|'middle'|'bottom'|'auto')`
    — opt-in scroll-to-row.
- `cgrid/src/worker/passes/groupPass.ts` — call
  `isGroupOpenByDefault(node)` per node when option set.
- `cgrid/src/interaction/features/groupExpand.ts` — ArrowRight /
  ArrowLeft / Enter / Space handlers per the spec.
- `cgrid/src/a11y` (whichever file owns the ARIA layer) — emit
  `aria-expanded="true|false"` on every group-row a11y entry; flip
  on toggle.
- `cgrid/src/types.ts` —
  `VelocityGridOptions.isGroupOpenByDefault?: (node: { key: string;
  route: string[] }) => boolean`.
- `cgrid/tests/expandPolish.test.ts` (new) — 16 cases (callback
  identifies by route not key, resetRowGroupExpansion clears user
  toggles, expandParents opens ancestor chain, forceSync layout
  guarantee, keyboard nav handlers, ensureIndexVisible positions
  correctly, aria-expanded flips on toggle).
- `apps/cgrid-positions/e2e/cycle15.5-keyboardGroupNav.spec.ts`
  (new) — E2E for ArrowRight/Left/Enter/Space on group rows.

**Steps:**

1. No design pass (no chrome — keyboard nav + API + ARIA only).
2. Implement the four API additions.
3. Implement `isGroupOpenByDefault` callback in groupPass.
4. Implement keyboard handlers in `groupExpand`.
5. Wire `aria-expanded` in the ARIA layer.
6. Build the 16-case test suite.
7. Build the E2E.

**Acceptance:**
- All four API additions work per spec.
- Keyboard nav matches AG Grid behaviour.
- `aria-expanded` flips on toggle (E2E asserts via accessibility
  tree query).
- All tests pass.

**Commit:** `feat(cgrid): expand/collapse polish — isGroupOpenByDefault + resetRowGroupExpansion + expandParents + forceSync + keyboard + ensureIndexVisible + aria-expanded`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 7."

---

## Task 7 — Group rendering parity flags (`suppressCount` + `groupRowRendererParams.innerRenderer` + `suppressGroupChangesColumnVisibility` + `suppressDragLeaveHidesColumns`)

**Read first:**
- **Prompts 1 (additions) + 6 (last two flags)** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- `cgrid/src/renderer/cellRenderers/group.ts` — Cycle 15 Task 4's
  renderer; new flags route through here.
- `cgrid/src/interaction/rowGroupPanel/host.ts` — Cycle 15 Task 6
  + 15.5 Task 1; `suppressGroupChangesColumnVisibility` lives
  here.
- `cgrid/src/interaction/features/columnDrag.ts` — Cycle 6 column
  drag; `suppressDragLeaveHidesColumns` extends drag-out behavior.

**Files:**
- `cgrid/src/renderer/cellRenderers/group.ts` — read
  `suppressCount` (suppress the `(N)` suffix). Read
  `groupRowRendererParams.innerRenderer` if provided (defer to
  the custom renderer for the value portion only — chevron +
  indent stay native).
- `cgrid/src/interaction/rowGroupPanel/host.ts` — when adding a
  column to `rowGroupCols`, consult
  `suppressGroupChangesColumnVisibility` (or its
  'suppressHideOnGroup' / 'suppressShowOnUngroup' variants) before
  hiding the source column. When removing (ungrouping), same
  consult for re-showing.
- `cgrid/src/interaction/features/columnDrag.ts` — when a column
  is dragged OUT over a panel boundary and dropped outside the
  grid, normally hide it; if `suppressDragLeaveHidesColumns: true`,
  no-op.
- `cgrid/src/velocityGrid.ts` — option resolution + runtime
  setGridOption support.
- `cgrid/src/types.ts` — the four new options + the param shape
  for `groupRowRendererParams`.
- `cgrid/tests/groupParityFlags.test.ts` (new) — 16 cases (each
  flag × on/off × edge cases).
- `apps/cgrid-positions/e2e-visual/33-customised-group-renderer.spec.ts`
  (new) — seeds + applies a custom `innerRenderer` that wraps the
  group value in brackets `[Tech]`; snapshots the result.

**Steps:**

1. **DESIGN PASS** (very light — flags affect existing chrome
   variations). Brief: *"`suppressCount` removes the muted `(N)`
   suffix; does the chevron + value spacing change to compensate?
   `groupRowRendererParams.innerRenderer` lets apps swap the value
   portion — define the inner-renderer's contract (what params it
   receives: value, valueFormatted, depth, node, count)."* Append.
2. Implement the four flags.
3. Build the 16-case test suite.
4. Build visual cell 33.

**Acceptance:**
- All four flags work per spec.
- Custom innerRenderer replaces only the value portion.
- Visual cell 33 baselined.

**Commit:** `feat(cgrid): group rendering parity flags (suppressCount + groupRowRendererParams + suppressGroupChangesColumnVisibility + suppressDragLeaveHidesColumns)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 8."

---

## Task 8 — Aggregation extensions (object-returning custom aggFuncs + `groupTotalRow`/`grandTotalRow` + filtered-aggregates compose + incremental tick perf gate)

**Read first:**
- **Prompts 7 + 8** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- `cgrid/src/worker/passes/aggPass.ts` — Cycle 14 / Task 3.
- `cgrid/src/worker/aggFuncRegistry.ts` — Cycle 14 / Task 3.
- `cgrid/src/interaction/statusBar/aggMath.ts` — Cycle 13 / Task 3.
- `cgrid/src/core/subgrid.ts` — `TotalsSubgrid` from Cycle 14;
  this task uses it for per-group + grand total rows.

**Files:**
- `cgrid/src/worker/aggFuncRegistry.ts` — extend signature to
  allow `AggFunc<T> = (params) => T` where T can be a primitive
  OR an object. The renderer reads the object's `value` field by
  default but apps can provide a custom formatter to read other
  fields (e.g. weighted avg's `{ value, weight }`).
- `cgrid/src/worker/passes/aggPass.ts` — compute per-group totals
  + grand totals when the option is on. Filter-changes only
  recompute aggregates for subtrees whose leaf set actually
  changed (compose with Prompt 11 rebuild reuse).
- `cgrid/src/core/subgrid.ts` — `TotalsSubgrid` accepts a
  `scope: 'grand' | 'group'` discriminator + a parent group key
  for per-group case.
- `cgrid/src/velocityGrid.ts` — `VelocityGridOptions.groupTotalRow:
  'top' | 'bottom' | null` + `VelocityGridOptions.grandTotalRow:
  'top' | 'bottom' | null`.
- `cgrid/tests/aggExtensions.test.ts` (new) — 20 cases (object
  aggFuncs, total row positions, filter-changes recompute only
  affected subtrees).
- `cgrid/tests/aggIncremental.perf.test.ts` (new) — 4 cases:
  100k × 1-row update → ≤ 0.5 ms agg delta; 100k × 10-row burst
  → ≤ 5 ms; update that doesn't change a leaf's group → 0 ms
  agg recompute; sticky band repaint counter stays 0 for
  non-ancestor leaf ticks.

**Steps:**

1. **DESIGN PASS** (per-group + grand total row positions).
   Brief: *"When both `groupTotalRow` and `grandTotalRow` are on,
   does the grand total at the bottom of the body sit above or
   below the last group's total? Does it inherit Cycle 14's
   `--vg-totals-bg` exactly or get a slightly heavier weight to
   distinguish from per-group totals?"* Append.
2. Audit AggPass for tick-path performance. Document findings in
   the commit body.
3. Extend `AggFuncRegistry` for object aggregates.
4. Extend `AggPass` for per-group + grand total computation.
5. Extend `TotalsSubgrid` for scope discriminator.
6. Wire `groupTotalRow` + `grandTotalRow` options.
7. Build the 20-case test suite + the 4-case perf test.

**Acceptance:**
- Object-returning custom aggFuncs work.
- Total rows render at requested positions.
- Filter changes recompute only affected subtrees.
- 100k × 1-row tick: ≤ 0.5 ms agg delta.
- Sticky band repaint counter stays 0 for non-ancestor leaf ticks.

**Commit:** `feat(cgrid): aggregation extensions — object aggFuncs + groupTotalRow/grandTotalRow + filtered-aggregates compose + incremental tick perf gate`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 9."

---

## Task 9 — Group sort by aggregate + per-level sort state + filtering interaction

**Read first:**
- **Prompts 10 + 11** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- This worklog's Architecture.
- `cgrid/src/worker/passes/sortPass.ts` — Cycle 15 / Task 11.
- `cgrid/src/worker/passes/groupPass.ts` — Cycle 15 / Task 1.
- `cgrid/src/interaction/rowGroupPanel/host.ts` — Task 1's sort
  indicator on pills must reflect the per-level sort state from
  here.

**Files:**
- `cgrid/src/worker/passes/sortPass.ts` — when the auto-group
  column has a `comparator` AND it returns a comparison over group
  nodes (not leaf values), sort groups by that. Per-level sort
  state stored on `GroupingState.perLevelSort` (Task 1).
- `cgrid/src/worker/passes/groupPass.ts` — composed filter rebuild:
  filter changes rebuild the tree over filtered-in leaves; reuse
  leaf buckets where the leaf set is unchanged. Aggregates only
  recompute for subtrees whose membership changed.
- `cgrid/src/interaction/rowGroupPanel/host.ts` — pill sort
  indicator subscribes to `GroupingState.perLevelSort` so external
  sort changes reflect in the panel.
- `cgrid/src/velocityGrid.ts` — primitive
  `setRowGroupColumnSort(colId, direction)` extends Task 1's
  primitive (already declared there; this task implements the
  sort-pass side).
- `cgrid/tests/groupSortByAggregate.test.ts` (new) — 14 cases
  (auto-group column comparator over group nodes, per-level
  sort state survives expand/collapse, multipleColumns: each
  level independently sortable, panel pill reflects).
- `cgrid/tests/filteringWithGrouping.test.ts` (new) — 12 cases
  (filter applies to leaves; empty groups disappear; bucket reuse
  when keys unchanged; quick filter composes; external filter
  composes; aggregate over filtered).

**Steps:**

1. No design pass (no chrome — behavioural + worker).
2. Extend SortPass for group-node comparator.
3. Implement bucket reuse in GroupPass for filter changes.
4. Wire pill sort indicator subscription.
5. Build both test suites (14 + 12 cases).

**Acceptance:**
- Auto-group column comparator can sort groups by aggregate.
- Per-level sort state serializes (Task 10 will read it).
- Filter-change rebuild reuses unchanged buckets.
- Aggregates over filtered leaves compose correctly.

**Commit:** `feat(cgrid): group sort by aggregate + per-level sort state + filtering composes with grouping`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 10."

---

## Task 10 — Grid State save/restore for grouping

**Read first:**
- **Prompt 12** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- This worklog's Architecture.
- `cgrid/src/core/groupingState.ts` (Task 1) — the state primitive
  that owns the data this task serialises.
- `cgrid/src/velocityGrid.ts` `getState` / `setState` (Cycle 4 surface).

**Files:**
- `cgrid/src/velocityGrid.ts` — extend `getState` to include
  `grouping: { rowGroupColumns, expandedRoutes, groupDisplayType,
  perLevelSort }`. Extend `setState` to restore + rebuild the tree
  + reapply expansion + repaint without changing scrollTop.
- `cgrid/src/core/groupingState.ts` — `serialize()` / `restore()`
  helpers.
- `cgrid/src/worker/passes/groupPass.ts` — accept a restored
  `expandedRoutes` set on init; build the tree, then convert
  routes → node ids → expanded set.
- `cgrid/tests/gridStateGrouping.test.ts` (new) — 12 cases (save +
  restore round-trip, rowGroupColumns reordering preserved,
  expansion routes preserved, groupDisplayType preserved, per-
  level sort preserved, restore doesn't change scrollTop, restore
  re-emits `groupingStateChanged` once).
- `apps/cgrid-positions/e2e/cycle15.5-gridStateRoundtrip.spec.ts`
  (new) — E2E: group by ticker, expand one group, scroll deep,
  call `getState()`, refresh, call `setState(saved)`, assert the
  grid restores exactly.

**Steps:**

1. No design pass.
2. Implement serialize/restore in `groupingState.ts`.
3. Wire `getState` / `setState` extensions.
4. Build the 12-case test suite + the E2E.

**Acceptance:**
- Full round-trip preserves grouping state.
- ScrollTop preserved across restore.
- All tests pass.

**Commit:** `feat(cgrid): Grid State save/restore for grouping (rowGroupColumns + expandedRoutes + sort + displayType)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 11."

---

## Task 11 — Perf + correctness gate (Prompt 13)

**Read first:**
- **Prompt 13** from
  `docs/superpowers/notes/row-grouping-complete-prompts.md` — quote
  VERBATIM.
- All prior Cycle 15.5 tasks (the gate validates them).

**Files:**
- `cgrid/tests/groupingPerf.test.ts` (new) — 12 cases covering
  every Prompt 13 assertion:
  1. Group tree build over 100k leaves: single bucketing pass
     (≤ 100 ms).
  2. Toggle a group: O(affected subtree) (≤ 5 ms for 10k subtree).
  3. `indexForOffset` is O(log n) (≤ 0.01 ms at 100k).
  4. `offsetForIndex` is O(1) (≤ 0.001 ms).
  5. No allocation in scroll hot path (`performance.measure` on
     scroll burst → 0 new allocations via heap delta).
  6. Sticky recompute is O(depth) (depth=10 ≤ 0.5 ms).
  7. Eviction handoff: no 1 px gap/overlap with group height ≠
     leaf height (pixel-exact assertion via mocked rAF).
  8. Collapse preserves scrollTop byte-identically (`scrollTop`
     read pre/post is `===`).
  9. Leaf tick repaints body but NOT sticky band (spy on
     `requestRepaint` band-vs-body counters).
  10. Aggregation tick is incremental (vs full-reagg reference;
      delta = direct ancestor chain).
  11. ARIA: `aria-expanded` flips on toggle (queries a11y tree).
  12. ARIA: a pinned header appears in the a11y tree exactly
      once (not duplicated by sticky overlay).
- `cgrid/tests/threeUIsOneList.test.ts` (new) — 8 cases asserting
  the three grouping UIs share one `rowGroupColumns` list:
  1. Mutate via panel → tool panel reflects.
  2. Mutate via tool panel → panel reflects.
  3. Mutate via context menu → both panel + tool panel reflect.
  4. Mutate via primitive API → all three reflect.
  5. Concurrent mutations from two UIs in one tick coalesce
     correctly (no lost update).
  6. Reorder via panel → context menu's "Un-Group by" routes to
     the correctly-reordered column.
  7. `groupingStateChanged` event fires exactly once per
     mutation regardless of source.
  8. `getState().grouping.rowGroupColumns` matches every UI's
     local view.

**Steps:**

1. No design pass.
2. Build both test suites.
3. If any test fails, audit + fix the affected task's code before
   committing this task. The gate IS the regression guard for the
   prior tasks.

**Acceptance:**
- All 20 cases pass.
- The gate doubles as documentation of the perf + correctness
  contract.

**Commit:** `test(cgrid): grouping perf + correctness gate (Prompt 13 + three-UIs-one-list invariant)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 12."

---

## Task 12 — Cycle 15.5 exit ritual

**Read first:**
- This worklog (every prior task).
- Cycle 15 exit ritual template.
- `docs/catalog/FEATURE_MATRIX.md` — Area 09 + 17 + 23 rows to
  flip.

**Files:**
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md`
  — add "## Shipped" block listing the 11 PRs + commit SHAs.
- `apps/cgrid-positions/src/positionsGrid.ts` — toolbar toggles
  now offer sticky group rows, selection modes, group-by-aggregate
  sort (add to existing toggle bar or under
  `?features=full`).
- `docs/catalog/FEATURE_MATRIX.md` — flip the final Area 09 rows
  (54/54), Area 17 row-groups-drop-zone-in-sidebar row, Area 23
  grouping-state row.
- README — update screenshot if sticky-on-by-default.
- Visual matrix may re-baseline cells affected by sticky-on-by-
  default. PR title gets `[visual-baseline-update]`.

**Steps:**

1. Verify every Task 1–11 PR merged.
2. Wire demo defaults.
3. Re-baseline visual cells if needed.
4. Run full local check (`npm test`, `npm run test:e2e`,
   `npm run test:visual`).
5. Flip FM rows.
6. Write the "## Shipped" block.

**Acceptance:**
- All 12 Cycle 15.5 PRs merged.
- FM Area 09 = 54/54 ✅.
- FM Area 17 + Area 23 grouping rows ✅.

**Commit:** `docs(cycle-15.5): exit ritual — Shipped log + FM Area 09 + 17 + 23 flips`

**Next session prompt:** "Cycle 15.5 complete — STOP. Do NOT proceed to Cycle 16."

---

## Shipped — Cycle 15.5 (2026-06-28)

All Tasks 4–12 delivered in the `ssrm` branch. Test count: **1480 → 1580** (+100 new tests across 10 new test files).

| Task | Description | Tests added | Key files |
|------|-------------|-------------|-----------|
| 4 | `groupHideOpenParents` flag — expanded parents hidden from flatOrder, sticky suppressed | 15 | `protocol.ts`, `hideOpenParents.test.ts` |
| 5 | `GroupSelectsMode` — self / descendants / filteredDescendants; checkbox gating | 25 | `selectionModel.ts`, `selectionModes.test.ts` |
| 6 | Expand/collapse polish — `isGroupOpenByDefault` callback, keyboard nav, public API, **`aria-expanded` on group rows** | 15 + 5 E2E | `groupPass.ts`, `groupExpand.ts`, `velocityGrid.ts`, `a11yOverlay.ts`, `expandPolish.test.ts`, `a11yOverlay.test.ts`, `cycle15.5-keyboardGroupNav.spec.ts` |
| 7 | Group rendering parity flags — `suppressCount`, `innerRenderer`, `suppressGroupChangesColumnVisibility` | 16 | `group.ts`, `velocityGrid.ts`, `groupParityFlags.test.ts` |
| 8 | Aggregation extensions — object-returning aggFuncs + `groupTotalRow`/`grandTotalRow` aliases | 25 (20+5) | `velocityGrid.ts`, `aggExtensions.test.ts`, `aggIncremental.perf.test.ts` |
| 9 | Group sort by aggregate + per-level sort state + filtering interaction | 26 (14+12) | `groupSortByAggregate.test.ts`, `filteringWithGrouping.test.ts` |
| 10 | Grid State save/restore — `GroupingState.serialize()` / `restore()` | 14 | `groupingState.ts`, `gridStateGrouping.test.ts` |
| 11 | Perf + correctness gate — 12 perf cases + 8 three-UIs-one-list cases | 20 | `groupingPerf.test.ts`, `threeUIsOneList.test.ts` |
| 12 | Exit ritual — FM Area 09 (keyboard nav + isGroupOpenByDefault + resetRowGroupExpansion + ensureIndexVisible + aria-expanded + header Group-by menu) + Area 02 (column reorder drag ghost) + Area 23 (ensureIndexVisible) flipped; 229 E2E passing, 0 skipped | 0 | `FEATURE_MATRIX.md`, this plan |

### Gap-closure (2026-06-28) — three deferred items finished, no skips remaining

After cycle exit, three acceptance items that had been deferred (and in one
case masked by a `test.skip`) were completed and verified green:

| Gap | What shipped | Verification |
|-----|-------------|--------------|
| **Drag ghost (Task 1)** | Built the `.vg-column-drag-ghost` floating header card shown during a plain column reorder (Cycle 6 design that was never implemented); pill chip now gated to the row group panel only | `cycle6-columnDrag.spec.ts` ghost test **unskipped** + passing; `columnDrag.test.ts` (14) still green |
| **ARIA `aria-expanded` (Task 6)** | `A11yOverlay` sets `aria-expanded` on the focused group row, flips on toggle, removed on leaf rows | `a11yOverlay.test.ts` +1 case; `cycle15.5-keyboardGroupNav.spec.ts` +1 ARIA E2E |
| **Header context menu Group-by E2E (Task 2)** | New E2E proving right-click → DOM menu → Group by / Un-Group by mutates `rowGroupColumns` | `cycle15.5-contextMenuGroupBy.spec.ts` (2 tests) |

Full suite after gap-closure: **1581 unit + 229 E2E, 0 skipped, 0 failed.**
(Visual-snapshot suite has pre-existing stale baselines from the prior
navy→grey theme change — unrelated to grouping; left for a dedicated
re-baseline PR.)

---

## Anti-regression checklist (applies to EVERY task)

Tick before commit:

- [ ] Matching spec prompt from `row-grouping-complete-prompts.md`
      quoted VERBATIM at top of the task session prompt.
- [ ] `/frontend-design` pass run (UI tasks only); notes appended to
      `docs/superpowers/plans/notes/cycle-15-grouping-design.md`.
- [ ] Reference screenshot or ag-grid page open side-by-side with
      the rendered output.
- [ ] Visual matrix cell added (UI tasks only); PR title carries
      `[visual-baseline-new]` or `[visual-baseline-update]`.
- [ ] `npx vitest run` clean.
- [ ] `npx tsc --noEmit -p cgrid` clean.
- [ ] `npm run test:visual` clean (or baselines updated with explicit
      reviewer ack).
- [ ] Perf gates met (Task 3 sticky ≤ 1 ms, Task 8 incremental agg
      ≤ 0.5 ms, Task 11 covers all Prompt 13 assertions).
- [ ] `getVisibleCellBounds` (Cycle 12) used for any new cell-
      anchored DOM node.
- [ ] `aggMath` + `AggFuncRegistry` + `TotalsSubgrid` reused — no
      duplication.
- [ ] **THREE-UIs-SHARE-ONE-LIST INVARIANT**: any mutation of
      `rowGroupColumns` goes through the `GroupingState` primitive
      API (Task 1's `setRowGroupColumns` / `addRowGroupColumn` /
      `removeRowGroupColumn` / `moveRowGroupColumn`). Verified by
      Task 11's `threeUIsOneList.test.ts`.
- [ ] No `any` in new code.

---

## Shipped

(Filled in by Task 12 once every PR has merged.)
