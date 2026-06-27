# Canvasgrid Cycle 15.5 — Row grouping parity (sticky groups + hideOpenParents + selection modes + polish) — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Close the row-grouping parity gap against AG Grid v35.3.1
identified in the user-provided 8-prompt spec
(`docs/superpowers/notes/group-column-behaviors-prompts.md`, attached
out-of-tree). Cycle 15 shipped the load-bearing core (group pass,
viewport slicer, chunk format, auto-group column, display types,
panel, expand/collapse, tri-state cascade, defaults, hideOpenGroup,
group-aware sort, group totals). Cycle 15.5 ships the **gaps** the
spec made explicit: sticky group rows, `groupHideOpenParents`, the
full selection-mode matrix, expand-API + keyboard polish, and a small
set of parity flags that downstream apps will look for first
(`suppressCount`, `groupRowRendererParams`, `checkboxLocation`,
`suppressGroupChangesColumnVisibility`, `isGroupOpenByDefault`,
`resetRowGroupExpansion`).

**FM coverage:** Area 09 — flips the remaining ~4 rows (sticky,
hideOpenParents, group selection modes, keyboard nav) to ✅ at cycle
exit, taking Area 09 from 50/54 → 54/54.

**Depends on:** Cycle 15 (every task in this cycle reads or extends
something Cycle 15 introduced — `GroupPass`, `ViewportSlicer`,
`AutoGroupColumn`, `'group'` cell renderer, `TotalsSubgrid`, the row
group panel host).

**Performance gate:**
- Sticky group rows: re-deriving the sticky stack on scroll runs in
  ≤ 1 ms over a 100k-row grid grouped 3 levels deep. The sticky
  band's overlay layer repaints ONLY when (a) sticky membership
  changes or (b) a pinned aggregate ticks — never on a body-only
  paint.
- Incremental aggregation on tick: a single-row update applies a
  delta up the ancestor chain in O(group depth), not O(group size).
  Verified by a Vitest perf assertion (1 row update against a 100k
  grouped grid: ≤ 0.5 ms agg delta).

**Architecture:**

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
- **Selection mode matrix**: `groupSelects: 'self' | 'descendants' |
  'filteredDescendants'` (Cycle 15 / Task 8 shipped only
  'descendants'). `checkboxLocation: 'autoGroupColumn' |
  'selectionColumn' | 'none'` decides which column hosts the
  checkbox. `selectAll: 'all' | 'filtered' | 'currentPage'` defines
  the header checkbox's scope. All three options are runtime-mutable
  via `setGridOption`.
- **Expand/collapse polish**: `isGroupOpenByDefault(node): boolean`
  callback evaluated at build time per group node — overrides
  `groupDefaultExpanded`. `expandParents` flag on
  `setRowNodeExpanded(nodeId, expanded, expandParents?,
  forceSync?)`: when true, ancestor groups also expand so the target
  becomes visible. `resetRowGroupExpansion()` discards user toggles
  and re-evaluates defaults. Keyboard: ArrowRight on collapsed group
  expands; ArrowRight on expanded group focuses first child;
  ArrowLeft on expanded group collapses; ArrowLeft on collapsed
  group / leaf focuses parent; Enter/Space toggles focused group
  row.
- **Group rendering parity flags**: `suppressCount: boolean`
  suppresses the `(N)` suffix in the auto-group cell.
  `groupRowRendererParams: { innerRenderer?, value?, suppressCount?
  }` lets apps override the auto-group renderer's inner painter,
  the rendered value, or the count flag per-grid.
- **`suppressGroupChangesColumnVisibility`**: when true, grouping a
  column via the row group panel doesn't hide the source column
  (and ungrouping doesn't re-show it). Already-grouped columns stay
  visible. Per ag-grid: accepts `true | 'suppressHideOnGroup' |
  'suppressShowOnUngroup'` for fine-grained control.
- **Incremental aggregation perf gate**: audit Cycle 14's `AggPass`
  + Cycle 15 Task 12's group-totals path. Confirm a single-row
  update applies a per-aggregate delta up the ancestor chain in
  O(depth). If the audit finds a full recompute, refactor; if
  already incremental, add a Vitest perf test as a regression
  guard.

**Tech Stack:** TypeScript strict, Vitest, Playwright (E2E + visual).
No new runtime dependencies. The sticky overlay painter slots into
the existing renderer pipeline (`renderer/renderer.ts`) alongside
`paintOverlay`, `paintRangeOverlay`.

**References (READ FIRST when starting any task):**

- The user-provided spec — paste the matching prompt from
  `group-column-behaviors-prompts.md` at the top of each task
  worklog so the implementing session has the AG Grid parity
  baseline open. (The spec lives outside the repo; copy verbatim
  into the task body.)
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
- Current source:
  - `cgrid/src/renderer/renderer.ts` — paint pass ordering; sticky
    overlay slots between `paintGridLines` and `paintOverlay`.
  - `cgrid/src/worker/viewportSlicer.ts` — hideOpenParents extends
    this.
  - `cgrid/src/interaction/selectionModel.ts` — selection mode
    matrix lives here.
  - `cgrid/src/renderer/cellRenderers/group.ts` — suppressCount,
    groupRowRendererParams, checkboxLocation route through here.
  - `cgrid/src/interaction/rowGroupPanel/host.ts` —
    suppressGroupChangesColumnVisibility flag added.
  - `cgrid/src/interaction/features/groupExpand.ts` — keyboard nav
    extends this.
  - `cgrid/src/interaction/features/keyPaging.ts` — base keyboard
    feature; arrow handlers cooperate with this.

**Global Constraints:**

- TypeScript strict — no `any` in new code.
- `npm test` (Vitest) stays green. New tests target 50+ new cases
  this cycle.
- `npm run test:e2e` stays green.
- `npm run test:visual` matrix gains 4 new cells (sticky-3-level,
  hideOpenParents, selection-modes-indeterminate-self,
  groupRowRenderer-customised). Existing cells stay byte-stable
  (defaults unchanged).
- **EVERY UI TASK INVOKES `/frontend-design`** before writing CSS or
  DOM. Notes append to
  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`. Per
  the `ui-quality-bar` memory — non-negotiable.
- **`getVisibleCellBounds`** (Cycle 12) is the helper for any new
  cell-anchored DOM node (none expected this cycle — sticky
  group rows are canvas-painted).
- `aggMath` + `AggFuncRegistry` + `TotalsSubgrid` from Cycles 13/14
  are the SINGLE SOURCE OF TRUTH for aggregation. Task 6 audits
  but does not duplicate them.
- No new runtime dependencies.
- Each task ends with `git commit` + `gh pr create`; next session
  starts on `main` after merge.

## Task overview

| # | Title | UI? | Worker? | Files touched | New tests |
|---|-------|-----|---------|---------------|-----------|
| 1 | Sticky group rows (canvas overlay) | yes | partial (slicer reuse) | `cgrid/src/renderer/painters/stickyGroups.ts` (new), `renderer/renderer.ts`, `core/viewport.ts`, `interaction/features/groupExpand.ts` (sticky chevron hit-test), `tokens.css` | `stickyGroups.test.ts` (18 cases) + `stickyGroups.perf.test.ts` (≤ 1 ms over 100k × 3 levels) + visual cell `27-sticky-groups-deep-scroll.png` |
| 2 | `groupHideOpenParents` | yes | yes | `cgrid/src/worker/viewportSlicer.ts`, `core/subgrid.ts`, `interaction/rowGroupPanel/host.ts` (force sticky off), `renderer/cellRenderers/group.ts` (child-row parent value), `tokens.css` | `hideOpenParents.test.ts` (12 cases) + visual cell `28-hideOpenParents-expanded.png` |
| 3 | Selection completeness (`groupSelects` / `checkboxLocation` / `selectAll`) | yes | no | `interaction/selectionModel.ts`, `renderer/cellRenderers/group.ts`, `interaction/features/headerCheckbox.ts` (new for selectAll), `tokens.css` | `selectionModes.test.ts` (22 cases) + visual cell `29-selection-self-vs-descendants.png` |
| 4 | Expand/collapse polish (`isGroupOpenByDefault` + `resetRowGroupExpansion` + `expandParents` + keyboard nav) | partial (keyboard) | partial (worker reads callback) | `cgrid/src/cgrid.ts`, `worker/passes/groupPass.ts`, `interaction/features/groupExpand.ts`, `interaction/features/keyPaging.ts` | `expandPolish.test.ts` (16 cases) + E2E `cycle15.5-keyboardGroupNav.spec.ts` |
| 5 | Group rendering parity flags (`suppressCount`, `groupRowRendererParams`, `suppressGroupChangesColumnVisibility`) | yes (flags affect render) | no | `renderer/cellRenderers/group.ts`, `cgrid.ts`, `interaction/rowGroupPanel/host.ts`, `types.ts` | `groupParityFlags.test.ts` (14 cases) + visual cell `30-customised-group-renderer.png` |
| 6 | Incremental aggregation perf gate (audit + Vitest assertion) | no | yes (audit only) | `cgrid/tests/aggIncremental.perf.test.ts` (new); refactor `worker/passes/aggPass.ts` ONLY if audit finds full-recompute | `aggIncremental.perf.test.ts` (4 cases incl. 100k × 1 row update ≤ 0.5 ms) |
| 7 | Cycle 15.5 exit ritual | yes (demo wires sticky + selection modes default) | no | worklog Shipped block, FM Area 09 final flips (54/54), demo updates, README | full suite green; FM Area 09 = 54/54 ✅ |

---

## Task 1 — Sticky group rows (canvas overlay)

**Read first:**
- Prompt 4 from the user spec (paste at top of task session):
  ```
  Implement sticky group headers. AG Grid behavior: "when scrolling
  through an expanded group, the group row sticks to the top of the
  grid." Support arbitrary nesting — multiple ancestor headers stack
  at the top (country pins, year pins beneath it). [full prompt body
  inlined here from group-column-behaviors-prompts.md § Prompt 4]
  ```
- This worklog's Architecture + Performance gate sections.
- `cgrid/src/renderer/renderer.ts` — paint pass ordering.
- `cgrid/src/worker/passes/groupPass.ts` — `GroupNode` + `flatOrder`
  shape from Cycle 15 / Task 1.
- `cgrid/src/core/viewport.ts` — viewport state; sticky overlay
  reads `firstRow` + `bodyTop` + `expandedKeys`.
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`**
  — when scrolled deep into 'Securitized > Americas > NonAgencyRMBS'
  the user expects three pinned headers stacked at top.
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
- `cgrid/src/theming/tokens.css` — `.cg-sticky-group-band` selector
  (the band is canvas-painted but a `box-shadow`-based bottom
  border is painted in canvas; CSS only documents the convention).
- `cgrid/src/types.ts` — `CGridOptions.suppressGroupRowsSticky:
  boolean` (default false).
- `cgrid/tests/stickyGroups.test.ts` (new) — 18 cases: no-sticky
  when ungrouped / no-sticky when groupModel empty / single-level
  stack / multi-level stack / push-off transform mid-scroll / no
  stick when scroll above first group / sticky disabled by option /
  chevron hit-test on pinned header collapses correct ancestor /
  agg tick on pinned ancestor repaints band but NOT body / body
  tick does NOT repaint band / hideOpenParents force-disables
  sticky (Task 2 interaction) / sticky bounds respect bodyLeft
  inset / sticky bounds match group row geometry / sticky stacks
  ordered outermost → innermost / no overlap, no gap with non-
  uniform group heights / sticky survives a column resize / sticky
  destroys on grid destroy / setOption flip mid-scroll re-evaluates.
- `cgrid/tests/stickyGroups.perf.test.ts` (new) — 100k × 3-level
  group fixture; assert sticky stack re-derive ≤ 1 ms per scroll.
- `apps/cgrid-positions/e2e-visual/27-sticky-groups-deep-scroll.spec.ts`
  (new) — seeds 1000 rows grouped 3 levels (ticker → desk →
  region), expands all, scrolls deep into one group, snapshots
  with 3 pinned headers at top.

**Interface produced:**

```ts
// cgrid/src/renderer/painters/stickyGroups.ts
export function paintStickyGroups(gc: CachedContext2D, p: PainterCtx): void;

// cgrid/src/types.ts
export interface CGridOptions<TRow> {
  // ...
  /** When true, disables sticky group headers — group rows render
   *  inline only. Default false. */
  suppressGroupRowsSticky?: boolean;
}
```

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design` with
   brief: *"Design the sticky group row band for canvasgrid. When
   the user scrolls deep into an expanded 3-level group, three
   pinned ancestor headers stack at the top of the body. Reference:
   `docs/catalog/screenshots/09-grouping-three-level-expanded.png`
   + ag-grid grouping-sticky-rows page. Subject: financial data
   grid. The pinned band must read as STRUCTURAL — `where you are
   in the tree` — without competing with the body for attention.
   Decide: separator between stacked headers (thin gridline, gap,
   bg shift)? push-off animation (linear translate, ease)? z-order
   vs the range overlay + focus ring (sticky band on top so a
   range selection that crosses the body↔band boundary clips
   correctly under it)."* Record in
   `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   (append; the file is the canonical record).
2. Surface `groupOutput.flatOrder` on the viewport state.
3. Implement `StickyGroupOverlay` helper that computes the sticky
   ancestor stack + push-off transform per scroll frame.
4. Implement `paintStickyGroups` painter.
5. Wire into `renderer.ts` paint pass ordering.
6. Extend `groupExpand` chevron hit-test for pinned headers.
7. Build the 18-case test suite.
8. Build the perf test (100k × 3 levels, ≤ 1 ms scroll).
9. Build visual cell 27 (seeds, scrolls, snapshots).
10. Visual review against reference. If the stacked headers look
    like "regular group rows that got copied to the top" instead
    of considered pinned chrome — **GO BACK TO STEP 1**.

**Acceptance:**
- Sticky stack renders correctly at multi-level nesting.
- Push-off transform produces no gap / no overlap when group
  heights vary.
- Perf gate: ≤ 1 ms sticky re-derive per scroll.
- `suppressGroupRowsSticky: true` cleanly disables the feature.
- Chevron hit-test on pinned header collapses the right ancestor.
- Visual cell 27 baselined.

**Commit:** `feat(cgrid): sticky group rows (canvas overlay, push-off transform, hit-testable)` — body cites design notes.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 2."

---

## Task 2 — `groupHideOpenParents`

**Read first:**
- Prompt 5 from the user spec (paste at top).
- This worklog's Architecture.
- `cgrid/src/worker/viewportSlicer.ts` — the slicer walks
  `flatOrder` honouring expansion; this task adds a parent-skip
  branch when the option is on AND the parent is expanded.
- Task 1's sticky implementation — Task 2 force-disables sticky
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
- `cgrid/src/interaction/rowGroupPanel/host.ts` — no change needed
  beyond honouring the auto-disable.
- `cgrid/src/renderer/cellRenderers/group.ts` — render the child
  row's auto-group cell with the parent's value in the parent's
  depth slot.
- `cgrid/src/renderer/painters/stickyGroups.ts` — early-return when
  `groupHideOpenParents === true`.
- `cgrid/src/types.ts` — `CGridOptions.groupHideOpenParents:
  boolean` (default false). `CGridOptions.groupAllowUnbalanced:
  boolean` (default false; deferred-impl follow-up — declare the
  type but document as "Cycle 16 follow-up").
- `cgrid/tests/hideOpenParents.test.ts` (new) — 12 cases:
  ungrouped / off / on with single level / on with multi-level /
  child row auto-group cell shows parent value / multipleColumns
  mode shows parent at parent's depth slot / single-child group
  with `groupRemoveSingleChildren` overlap / collapsed parent
  re-shows / sticky auto-disabled / changing the option mid-flight
  re-emits / interaction with `groupSelectsChildren` /
  re-evaluating defaults via `resetRowGroupExpansion` (Task 4).
- `apps/cgrid-positions/e2e-visual/28-hideOpenParents-expanded.spec.ts`
  (new) — seeds 100 rows grouped by ticker → sector with
  `groupHideOpenParents: true`, expands one group, snapshots the
  result (parent row replaced by children carrying parent's value).

**Steps:**

1. **DESIGN PASS** (light — primarily a behavioural change, but the
   visual difference in the auto-group cell on child rows needs a
   design call). Brief: *"When `groupHideOpenParents` is on, child
   rows under an expanded parent show the parent's value in the
   auto-group cell instead of leaving it blank. Decide: does the
   parent value render at the parent's depth (indented less than
   the child) or at the child's depth? Reference ag-grid
   grouping-hide-parents page."* Append to notes.
2. Extend `viewportSlicer` per the architecture note.
3. Update `'group'` cell renderer to show parent value on child
   rows when the option is on.
4. Force sticky early-return.
5. Build the 12-case test suite.
6. Build visual cell 28.
7. Visual review.

**Acceptance:**
- `groupHideOpenParents: true` correctly replaces the parent group
  row with its children.
- Child rows show parent context in the auto-group cell.
- Sticky disables automatically.
- Visual cell 28 baselined.

**Commit:** `feat(cgrid): groupHideOpenParents (replace expanded parent row with children + auto-disable sticky)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 3."

---

## Task 3 — Selection completeness (`groupSelects` / `checkboxLocation` / `selectAll`)

**Read first:**
- Prompt 6 from the user spec (paste at top).
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
- `cgrid/src/types.ts` —
  `CGridOptions.groupSelects: 'self' | 'descendants' | 'filteredDescendants'`,
  `checkboxLocation: 'autoGroupColumn' | 'selectionColumn' | 'none'`,
  `selectAll: 'all' | 'filtered' | 'currentPage'`.
- `cgrid/tests/selectionModes.test.ts` (new) — 22 cases per mode ×
  edge cases.
- `apps/cgrid-positions/e2e-visual/29-selection-self-vs-descendants.spec.ts`
  (new) — two-column snapshot showing the same partial group
  selection rendered under `groupSelects: 'self'` vs
  `'descendants'` (different checkbox states on the parent).

**Steps:**

1. **DESIGN PASS.** Brief: *"Design the selectionColumn (when
   `checkboxLocation: 'selectionColumn'`). It's a synthesized
   leftmost column ≤ 32px wide holding the checkbox + tri-state.
   Decide: width (28/32/40?), header checkbox visual (matches the
   row checkbox + tri-state styling), separator from the next
   column (none / hairline / gap). Inherit Cycle 11's sidebar
   chip + Cycle 14's totals chrome where vocabulary overlaps."*
   Append to notes.
2. Implement `groupSelects` mode branch in selectionModel.
3. Implement `checkboxLocation` routing in `'group'` renderer.
4. Implement `selectAll` header checkbox feature.
5. Build the 22-case test suite.
6. Build visual cell 29.

**Acceptance:**
- All three `groupSelects` modes produce correct selection cascade.
- `checkboxLocation` correctly routes the checkbox.
- `selectAll` header tri-state matches scope.
- Visual cell 29 baselined.

**Commit:** `feat(cgrid): selection completeness — groupSelects modes + checkboxLocation + selectAll`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 4."

---

## Task 4 — Expand/collapse polish (`isGroupOpenByDefault` + `resetRowGroupExpansion` + `expandParents` + keyboard nav)

**Read first:**
- Prompt 3 (the additions beyond Cycle 15 / Tasks 7+9) from the
  user spec (paste at top).
- `cgrid/src/cgrid.ts` — public API surface; new methods land here.
- `cgrid/src/worker/passes/groupPass.ts` — `isGroupOpenByDefault`
  callback evaluated at group-pass time per node, after defaults.
- `cgrid/src/interaction/features/keyPaging.ts` — base keyboard
  feature; new arrow handlers cooperate with this.
- `cgrid/src/interaction/features/groupExpand.ts` — Cycle 15 Task 7
  shipped chevron click; this task adds keyboard.

**Files:**
- `cgrid/src/cgrid.ts`:
  - `setRowNodeExpanded(nodeId, expanded, expandParents?, forceSync?)`
    — extend the existing API.
  - `resetRowGroupExpansion(): void` — discard user toggles,
    re-evaluate `groupDefaultExpanded` + `isGroupOpenByDefault`.
- `cgrid/src/worker/passes/groupPass.ts` — call
  `isGroupOpenByDefault(node)` per node when option set.
- `cgrid/src/interaction/features/groupExpand.ts` — ArrowRight /
  ArrowLeft / Enter / Space handlers per the spec.
- `cgrid/src/types.ts` —
  `CGridOptions.isGroupOpenByDefault?: (node: { key: string;
  route: string[] }) => boolean`.
- `cgrid/tests/expandPolish.test.ts` (new) — 16 cases (callback
  identifies by route not key, resetRowGroupExpansion clears user
  toggles, expandParents opens ancestor chain, forceSync layout
  guarantee, keyboard nav handlers).
- `apps/cgrid-positions/e2e/cycle15.5-keyboardGroupNav.spec.ts`
  (new) — E2E for ArrowRight/Left/Enter/Space on group rows.

**Steps:**

1. No design pass (no chrome — keyboard nav + API only).
2. Implement `setRowNodeExpanded` extensions + `resetRowGroupExpansion`.
3. Implement `isGroupOpenByDefault` callback in groupPass.
4. Implement keyboard handlers in `groupExpand`.
5. Build the 16-case test suite.
6. Build the E2E.

**Acceptance:**
- All four API additions work per spec.
- Keyboard nav matches AG Grid behaviour.
- All tests pass.

**Commit:** `feat(cgrid): expand/collapse polish — isGroupOpenByDefault + resetRowGroupExpansion + expandParents + keyboard nav`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 5."

---

## Task 5 — Group rendering parity flags (`suppressCount`, `groupRowRendererParams`, `suppressGroupChangesColumnVisibility`)

**Read first:**
- Prompts 1 (additions) and 8B (additions) from the user spec.
- `cgrid/src/renderer/cellRenderers/group.ts` — Cycle 15 Task 4's
  renderer; new flags route through here.
- `cgrid/src/interaction/rowGroupPanel/host.ts` — Cycle 15 Task 6;
  `suppressGroupChangesColumnVisibility` lives here.

**Files:**
- `cgrid/src/renderer/cellRenderers/group.ts` — read
  `suppressCount` (suppress the `(N)` suffix). Read
  `groupRowRendererParams.innerRenderer` if provided (defer to
  the custom renderer for the value portion only — chevron + indent
  stay native).
- `cgrid/src/interaction/rowGroupPanel/host.ts` — when adding a
  column to `rowGroupCols`, consult
  `suppressGroupChangesColumnVisibility` (or its 'suppressHideOnGroup' /
  'suppressShowOnUngroup' variants) before hiding the source column.
- `cgrid/src/cgrid.ts` — option resolution + runtime
  setGridOption support.
- `cgrid/src/types.ts` — the three new options + the param shape
  for `groupRowRendererParams`.
- `cgrid/tests/groupParityFlags.test.ts` (new) — 14 cases (each
  flag × on/off × edge cases).
- `apps/cgrid-positions/e2e-visual/30-customised-group-renderer.spec.ts`
  (new) — seeds + applies a custom `innerRenderer` that wraps the
  group value in brackets `[Tech]`; snapshots the result.

**Steps:**

1. **DESIGN PASS** (very light — flags affect existing chrome
   variations). Brief: *"`suppressCount` removes the muted `(N)`
   suffix; does the chevron + value spacing change to compensate?
   `groupRowRendererParams.innerRenderer` lets apps swap the value
   portion — define the inner-renderer's contract (what params it
   receives: value, valueFormatted, depth, node, count)."* Append.
2. Implement the three flags.
3. Build the 14-case test suite.
4. Build visual cell 30.

**Acceptance:**
- All three flags work per spec.
- Custom innerRenderer replaces only the value portion.
- Visual cell 30 baselined.

**Commit:** `feat(cgrid): group rendering parity flags (suppressCount + groupRowRendererParams + suppressGroupChangesColumnVisibility)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 6."

---

## Task 6 — Incremental aggregation perf gate (audit + Vitest assertion)

**Read first:**
- Prompt 7 from the user spec.
- `cgrid/src/worker/passes/aggPass.ts` — Cycle 14 / Task 3.
- `cgrid/src/interaction/statusBar/aggMath.ts` — Cycle 13 / Task 3.

**Files:**
- `cgrid/tests/aggIncremental.perf.test.ts` (new) — 4 cases:
  - 100k grouped grid × 1-row update → ≤ 0.5 ms agg delta
  - 100k × 10-row burst → ≤ 5 ms agg delta
  - update that doesn't change a leaf's group → 0 ms agg recompute
  - assert `requestRepaint` count is 1 (body) not 2 (body + sticky)
    when the changed row isn't a sticky ancestor — protects the
    Task 1 perf gate.
- `cgrid/src/worker/passes/aggPass.ts` — refactor ONLY if the audit
  finds a full-subtree recompute. If already incremental (delta up
  ancestor chain), the test alone is the regression guard.

**Steps:**

1. Audit AggPass for tick-path performance. Document findings in
   the commit body.
2. Refactor if needed (likely no-op if Cycle 14 already
   incremental).
3. Build the 4-case perf test.

**Acceptance:**
- 100k × 1-row tick: ≤ 0.5 ms.
- Sticky band repaint counter stays 0 for non-ancestor leaf ticks.

**Commit:** `perf(cgrid): incremental aggregation gate (1-row tick ≤ 0.5 ms over 100k grouped)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md` and execute Task 7."

---

## Task 7 — Cycle 15.5 exit ritual

**Read first:**
- This worklog (every prior task).
- Cycle 15 exit ritual template.
- `docs/catalog/FEATURE_MATRIX.md` — Area 09 remaining rows to
  flip.

**Files:**
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15.5-grouping-parity.md`
  — add "## Shipped" block listing the 6 PRs + commit SHAs.
- `apps/cgrid-positions/src/positionsGrid.ts` — toolbar toggles
  now offer the sticky group rows + the new selection modes (add
  to the toolbar or under `?features=full`).
- `docs/catalog/FEATURE_MATRIX.md` — flip the final Area 09 rows.
- Visual matrix may re-baseline cells affected by sticky-on-by-
  default (cells 20-26 likely). PR title gets
  `[visual-baseline-update]`.

**Steps:**

1. Verify every Task 1–6 PR merged.
2. Wire demo defaults.
3. Re-baseline visual cells if needed.
4. Run full local check.
5. Flip FM Area 09 rows (final 4).
6. Write the "## Shipped" block.

**Acceptance:**
- All 7 Cycle 15.5 PRs merged.
- FM Area 09 = 54/54 ✅.

**Commit:** `docs(cycle-15.5): exit ritual — Shipped log + FM Area 09 final flips`

**Next session prompt:** "Cycle 15.5 complete — STOP. Do NOT proceed to Cycle 16."

---

## Anti-regression checklist (applies to EVERY task)

Tick before commit:

- [ ] Matching spec prompt from `group-column-behaviors-prompts.md`
      pasted at top of the task session.
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
- [ ] Perf gates met (Task 1 sticky ≤ 1 ms, Task 6 incremental agg
      ≤ 0.5 ms).
- [ ] `getVisibleCellBounds` (Cycle 12) used for any new cell-anchored
      DOM node.
- [ ] `aggMath` + `AggFuncRegistry` + `TotalsSubgrid` reused — no
      duplication.
- [ ] No `any` in new code.

---

## Shipped

(Filled in by Task 7 once every PR has merged.)
