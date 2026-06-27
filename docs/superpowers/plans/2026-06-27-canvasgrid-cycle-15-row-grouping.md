# Canvasgrid Cycle 15 — Row grouping — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Hierarchical **row grouping** — group rows by one or more
columns, render collapsible group rows with chevron + indent +
count, support tri-state selection across the hierarchy
(`groupSelectsChildren`), surface per-group totals (`groupIncludeFooter`),
and ship the auto-group column / `groupDisplayType: 'multipleColumns'`
options. This is the cycle that unblocks Tree data (Cycle 17),
Master/Detail (Cycle 16), and Pivoting (Cycle 18) — every downstream
hierarchy feature reads the group pipeline this cycle puts in place.

**FM coverage:** Area 09 — ~50 of 54 rows ✅ at cycle exit (the
remaining 4 are pivot-specific, deferred to Cycle 18). Also picks
up the two group-footer rows from Area 10 deferred at Cycle 14
exit.

**Depends on:**
- Cycle 14 (`TotalsSubgrid` pattern reused for group-footer rows;
  `aggMath.ts` + `AggFuncRegistry` reused for per-group aggregation
  — no re-implementation).
- Cycle 13 (Status bar — the `agAggregationComponent` continues to
  work; group rows feed it the same selection signal).
- Cycle 12 (Visual matrix + `getVisibleCellBounds` helper — new
  group-row painters must respect the band rules).

**Performance gate:**
- Grouping 1 M rows by 3 columns: ≤ 300 ms on worker (cold).
- Collapsed groups skip rendering — `getRowCount` returns only
  the visible (non-collapsed) row count.
- Toggling a single group: ≤ 16 ms (one frame) main-thread.
- Group-aware sort over 100 K grouped rows: ≤ 100 ms on worker.

**Architecture:**

- **`GroupPass`** is a new worker pipeline stage that runs **after**
  `FilterPass` and **before** `SortPass`. It reads
  `groupModel: { rowGroupCols: string[] }` and produces a tree of
  `GroupNode { key, value, depth, childCount, childIndices,
  childGroups }`. Cost = one O(N) walk + per-group bucket sort by
  group key.
- **`ViewportSlicer`** (refactored) walks the group tree
  honouring `expandedKeys: Set<string>` to produce a flat list of
  visible row indices interleaved with virtual "group rows"
  (rendered, not stored). When a group is collapsed, its descendant
  data rows are skipped entirely.
- **Chunk format** grows by 4 parallel arrays per row:
  `rowKind: Uint8Array` (0=data | 1=group | 2=footer),
  `groupDepth: Uint8Array`, `groupValue: string[]`,
  `groupChildCount: Uint32Array`. `isExpanded: Uint8Array`
  duplicates client-side state for paint efficiency. Existing
  Cycle 4 chunk format readers stay compatible (new fields are
  appended, old offsets unchanged).
- **Auto-group column** is a synthesized column (id =
  `'ag-Grid-AutoColumn'`) that renders chevron + indent + group
  value + optional `(count)`. Inserted at position 0 by default
  unless `groupDisplayType: 'multipleColumns'` is set (then one
  auto-column per `rowGroupCols` entry, in order).
- **`'group'` cell renderer** is a new built-in. Reads the row's
  group depth from the chunk, paints the indent (one chevron-width
  per depth level), the chevron (▶ collapsed / ▼ expanded), the
  group value (formatted via the source column's `valueFormatter`),
  and an optional `(count)` suffix in a muted weight.
- **`groupSelectsChildren`** turns the selection model into a
  tri-state machine. Selecting a group row marks all descendants
  selected; if every child is selected, the group reads "fully
  selected"; if some are selected, it reads "indeterminate"; if
  none, "unselected". The checkbox painter renders these three
  states (Cycle 9 selection painter extends to handle them).
- **Group-aware sort**: when `rowGroupCols.length > 0`,
  `SortPass` sorts within each group bucket independently AND
  sorts the group-level rows by either the group value or by a
  configurable group-level sort key (`columnDefs[].sortComparator`
  + `sortGroupRowsByKey`).
- **Group totals (footer rows)** reuse the `TotalsSubgrid` pattern
  from Cycle 14. Per-group footers compute via the same
  `AggPass` over the group's children — single source of truth.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E
+ visual). No new runtime dependencies. The chunk format extension
adds Uint8Array / Uint32Array typed arrays (already in the project).

**References (READ FIRST when starting any task):**

- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` —
  master plan (Cycle 15 — Row grouping, post-renumber).
- `docs/catalog/09-row-grouping.md` — surface spec: `RowGroupingDisplayType`,
  `GroupCellRendererParams`, `groupSelectsChildren`, `expand/collapse` API,
  events (`rowGroupOpened`, `expandOrCollapseAll`, `columnRowGroupChanged`).
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`** —
  canonical 3-level hierarchy reference: Desk → Region → Type, with
  chevron + indent + `(count)`, tri-state checkboxes, group footers.
- **`docs/catalog/screenshots/09-grouping-group-total-row.png`** —
  per-group footer-row reference.
- **ag-grid website fallback** (per the
  `consult-ui-screenshots-before-shipping` memory): when no
  screenshot covers a sub-surface (auto-group column header, the
  `groupRemoveSingleChildren` elision behaviour, the
  `multipleColumns` layout), consult
  `https://www.ag-grid.com/javascript-data-grid/grouping/`,
  `https://www.ag-grid.com/javascript-data-grid/grouping-display-types/`,
  and `https://www.ag-grid.com/javascript-data-grid/grouping-group-rows/`.
- `docs/catalog/FEATURE_MATRIX.md` — Area 09 rows to flip at cycle
  exit.
- `docs/superpowers/plans/notes/cycle-14-aggregation-design.md` — the
  "hairline lift" totals signature; group-footer rows INHERIT this
  vocabulary so a grouped grid reads with one visual language across
  data → group → footer → total.
- Current source:
  - `cgrid/src/worker/dataPipeline.ts` — pass ordering;
    `GroupPass` slots between `FilterPass` and `SortPass`.
  - `cgrid/src/worker/passes/aggPass.ts` — per-group aggregation
    via the same `aggMath` module.
  - `cgrid/src/worker/chunkFormat.ts` — the format extension.
  - `cgrid/src/core/subgrid.ts` — `TotalsSubgrid` is the model
    for group-footer subgrid embedding.
  - `cgrid/src/renderer/cellRenderers/registry.ts` — `'group'`
    renderer registers here.
  - `cgrid/src/interaction/selectionModel.ts` — tri-state
    selection extension.
  - `cgrid/src/theming/tokens.css` — `.cg-group-row`,
    `.cg-group-chevron`, `.cg-group-indent`, footer rules.

**Global Constraints:**

- TypeScript strict — no `any` in new code.
- `npm test` (Vitest, ~1180 tests at Cycle 14 exit) grows to
  ~1300+ this cycle. Stays green.
- `npm run test:e2e` (Playwright functional) stays green.
- `npm run test:visual` (matrix cells 01–19 + 5 new Cycle 15
  cells added across Tasks 4, 6, 7, 11) stays green.
- Worker perf budget: grouping 1 M × 3 cols ≤ 300 ms. Verified by
  `cgrid/tests/groupPass.perf.test.ts` (new) using a seeded
  synthetic 1 M dataset.
- **EVERY UI TASK MUST INVOKE `/frontend-design`** (or a more
  specific Skill) BEFORE writing CSS or DOM. Cite the design plan
  in the task commit message and the PR body. Notes land in
  `docs/superpowers/plans/notes/cycle-15-grouping-design.md`. Per
  the `ui-quality-bar` memory — non-negotiable.
- **EVERY UI TASK MUST ADD AT LEAST ONE VISUAL MATRIX CELL** under
  `apps/cgrid-positions/e2e-visual/` covering the new surface.
  Baselines committed in the same PR (PR title gets
  `[visual-baseline-new]` or `[visual-baseline-update]`). Spec
  docstring names the regression it catches.
- **`aggMath.ts` (Cycle 13 / Task 3) + `AggFuncRegistry` (Cycle 14 /
  Task 3) are the SINGLE SOURCE OF TRUTH for aggregation.** Group
  footers compute via the same registry. Re-implementing sum / avg
  / min / max / count in this cycle's code = automatic PR rejection.
- **`TotalsSubgrid` (Cycle 14 / Task 1) is the model** for the
  group-footer subgrid. Task 11 extends it; does not replace it.
- **Chunk format additions are append-only** — existing Cycle 4
  readers (filter, sort, viewport) must continue to work against
  ungrouped chunks. Verified by an "ungrouped chunk fixture"
  Vitest test that loads a snapshot from Cycle 4 and round-trips
  through the new readers.
- No new runtime dependencies in `cgrid/`.
- Each task ends with `git commit` + `gh pr create` + wait for CI;
  next session starts on `main` after the merge.

## Task overview

| # | Title | UI? | Worker? | Files touched | New tests |
|---|-------|-----|---------|---------------|-----------|
| 1 | `GroupPass` on worker (tree build + ordering) | no | yes | `cgrid/src/worker/passes/groupPass.ts` (new), `dataPipeline.ts`, `protocol.ts` | `groupPass.test.ts` (18 cases) + `groupPass.perf.test.ts` (1 M rows ≤ 300 ms) |
| 2 | Group-aware `ViewportSlicer` (collapse-skip walk) | no | yes | `cgrid/src/worker/viewportSlicer.ts` | `viewportSlicer.group.test.ts` (14 cases) |
| 3 | `GroupedRow` chunk format extension | no | yes | `cgrid/src/worker/chunkFormat.ts`, `protocol.ts`, `client.ts` | `chunkFormat.group.test.ts` (10 cases + ungrouped fixture round-trip) |
| 4 | Auto-group column + `'group'` cell renderer | yes | no | `cgrid/src/core/autoGroupColumn.ts` (new), `cgrid/src/renderer/cellRenderers/group.ts` (new), `cgrid/src/renderer/cellRenderers/registry.ts`, `tokens.css` | `autoGroupColumn.test.ts` (12 cases) + visual cell `20-group-one-level.png` |
| 5 | `groupDisplayType: 'multipleColumns' | 'groupRows' | 'custom'` | yes | no | `cgrid/src/cgrid.ts`, `cgrid/src/core/autoGroupColumn.ts` | `groupDisplayType.test.ts` (9 cases) + visual cell `21-group-three-level-multipleColumns.png` |
| 6 | **Row group panel** (drop strip above headers) + drag-from-header + `rowGroupPanelShow` + `rowGroupPanelSuppressSort` + `enableRowGroup` | yes | no | `cgrid/src/interaction/rowGroupPanel/host.ts` (new), `cgrid/src/interaction/features/columnDrag.ts` (extend with row-group-panel drop target), `cgrid/src/cgrid.ts`, `tokens.css` | `rowGroupPanel.test.ts` (16 cases) + visual cells `22-rowGroupPanel-empty.png` + `23-rowGroupPanel-three-chips.png` + E2E `cycle15-dragColumnToRowGroupPanel.spec.ts` |
| 7 | Expand/collapse interaction + API | yes | no | `cgrid/src/interaction/features/groupExpand.ts` (new), `cgrid/src/cgrid.ts`, `cgrid/src/worker/passes/groupPass.ts` | `groupExpand.test.ts` (15 cases) + visual cell `24-groups-all-collapsed.png` + E2E `cycle15-groupExpand.spec.ts` |
| 8 | `groupSelectsChildren` + tri-state checkbox | yes | no | `cgrid/src/interaction/selectionModel.ts`, `cgrid/src/renderer/cellRenderers/group.ts`, `tokens.css` | `triStateSelection.test.ts` (13 cases) + visual cell `25-groupSelectsChildren-indeterminate.png` |
| 9 | `groupDefaultExpanded` + `groupDefaultExpandedKeys` | no | partial (worker reads option on init) | `cgrid/src/cgrid.ts`, `cgrid/src/worker/passes/groupPass.ts` | `groupDefaultExpanded.test.ts` (7 cases) |
| 10 | `showOpenedGroup` + `groupRemoveSingleChildren` | yes (polish) | yes | `cgrid/src/worker/passes/groupPass.ts`, `cgrid/src/renderer/cellRenderers/group.ts` | `groupElision.test.ts` (8 cases); visual cell 21 re-baselines if elision changes the demo |
| 11 | Group-aware sort | no | yes | `cgrid/src/worker/passes/sortPass.ts` | `groupSort.test.ts` (10 cases) + `groupSort.perf.test.ts` (100 K ≤ 100 ms) |
| 12 | Group totals (footer rows) | yes | yes | `cgrid/src/core/subgrid.ts` (extend `TotalsSubgrid`), `cgrid/src/worker/passes/aggPass.ts`, `cgrid/src/cgrid.ts`, `tokens.css` | `groupFooter.test.ts` (12 cases) + visual cell `26-group-footer-rows.png` |
| 13 | Cycle 15 exit ritual | yes (demo wires grouping default) | no | worklog Shipped block, FM Area 09 + 10 flips, demo update | full suite green; FM 52/54 rows ✅ |

---

## Phase A — Worker pipeline (Tasks 1–3)

These are the worker-only tasks that build the data structure
everything downstream reads. Get them right and the rendering /
interaction work in Phase B+ becomes mechanical.

---

## Task 1 — `GroupPass` on worker (tree build + ordering)

**Read first:**
- This worklog's Architecture + Global Constraints + Performance gate.
- `docs/catalog/09-row-grouping.md` — `groupModel` shape;
  `rowGroupCols`, `groupOrder` resolution rules.
- `cgrid/src/worker/dataPipeline.ts` — existing pass ordering.
- `cgrid/src/worker/passes/filterPass.ts` — closest analogue
  (visits every row, emits a filtered index list); `GroupPass`
  visits the filtered indices.
- `cgrid/src/worker/passes/sortPass.ts` — `GroupPass` runs BEFORE
  this; `SortPass` Task 10 becomes group-aware.

**Files:**
- `cgrid/src/worker/passes/groupPass.ts` (new) — `class GroupPass`
  with `apply(input: GroupPassInput): GroupPassOutput`. Pure-fn;
  no module-level state.
- `cgrid/src/worker/dataPipeline.ts` — wire `GroupPass` between
  `FilterPass` and `SortPass`. When `rowGroupCols.length === 0`,
  bypass cleanly (zero allocations).
- `cgrid/src/worker/protocol.ts` — `setGroupModel(model)` message;
  `GroupPassOutput` carries the `GroupNode` tree + flat ordering.
- `cgrid/src/worker/client.ts` — `setGroupModel` API on client.
- `cgrid/tests/groupPass.test.ts` (new) — 18 cases: empty input /
  one-level / multi-level / sort within group / null group values
  / numeric group values / case sensitivity / collapsed honoured
  (post-Task 6 sees this via `expandedKeys`) / 100-group fixture
  / 1000-group fixture / unknown column id rejected / circular
  groupOrder rejected / group-by-aggFunc-column edge case /
  group-then-filter ordering / setGroupModel re-emits / changing
  rowGroupCols re-emits / removing all rowGroupCols flushes /
  re-grouping by different col reuses bucket cache.
- `cgrid/tests/groupPass.perf.test.ts` (new) — perf assertion:
  1 M synthetic rows × 3 group cols completes in ≤ 300 ms on the
  worker (use `performance.now` deltas).

**Interface produced:**

```ts
export interface GroupNode {
  /** Stable composite key — `${col1}:${val1}::${col2}:${val2}` for nested. */
  key: string;
  /** The raw value of the grouping cell. */
  value: unknown;
  /** Depth in the tree, 0 = root group. */
  depth: number;
  /** Source column id that this group level partitions by. */
  colId: string;
  /** Indices into the post-filter row set that belong to this leaf bucket. */
  childIndices: Uint32Array;
  /** Nested groups, depth + 1. Empty at the leaf depth. */
  childGroups: GroupNode[];
  /** Total descendants count (recursive sum of leaf childIndices.length). */
  childCount: number;
}

export interface GroupPassOutput {
  /** Root group nodes (one per top-level groupValue). */
  roots: GroupNode[];
  /** Flat ordering of (groupKey | rowIndex) used by ViewportSlicer. */
  flatOrder: Array<{ kind: 'group' | 'row'; key?: string; rowIndex?: number; depth: number }>;
  /** True when `rowGroupCols.length === 0` — downstream skips. */
  bypassed: boolean;
}
```

**Steps:**

1. Implement `GroupPass.apply` per the interface above.
2. Wire into `dataPipeline` between `FilterPass` and `SortPass`.
3. Add `setGroupModel` protocol message + client method.
4. Write 18 unit cases. Use the existing `worker.test.ts` test
   harness pattern (synthetic data, message round-trip).
5. Write the perf test — seeded fixture of 1 M rows, 3 group
   cols (random sector / region / sub-region). Assert
   `apply()` returns in ≤ 300 ms.
6. Run `npx vitest run` (cgrid) — clean. TypeScript clean.

**Acceptance:**
- 18 unit cases pass.
- Perf test passes: 1 M × 3 cols ≤ 300 ms.
- `dataPipeline` bypass works (no allocations when
  `rowGroupCols.length === 0`).

**Commit:** `feat(cgrid): GroupPass on worker (tree build + flat ordering)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 2."

---

## Task 2 — Group-aware `ViewportSlicer` (collapse-skip walk)

**Read first:**
- This worklog's Architecture (the `flatOrder` field is the input).
- `cgrid/src/worker/viewportSlicer.ts` — existing slicer; extend
  it to honour the new `flatOrder` when grouping is active.
- Task 1's `GroupPassOutput` interface.

**Files:**
- `cgrid/src/worker/viewportSlicer.ts` — when
  `groupOutput.bypassed === false`, walk `flatOrder` honouring
  `expandedKeys: Set<string>`. Collapsed groups skip their
  `flatOrder` entries up to the next sibling.
- `cgrid/tests/viewportSlicer.group.test.ts` (new) — 14 cases:
  bypass / all expanded / all collapsed / mixed expansion /
  deeply nested / collapsed-then-expanded / `firstRow / lastRow`
  windowing into a grouped tree / `getRowCount` returns
  visible-only count / overscan respects group boundaries (a
  group's first child is the natural overscan anchor) /
  `getRowIndexFor(groupKey)` lookup / etc.

**Steps:**

1. Extend `viewportSlicer` per the architecture note.
2. Build the 14-case test suite.
3. Run `npx vitest run` — clean.

**Acceptance:**
- 14 unit cases pass.
- Slicer correctly skips collapsed-group descendants.
- `getRowCount()` matches "visible row count post-collapse".

**Commit:** `feat(cgrid): group-aware ViewportSlicer (collapse-skip walk over GroupPass.flatOrder)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 3."

---

## Task 3 — `GroupedRow` chunk format extension

**Read first:**
- This worklog's Architecture (chunk format additions are
  append-only).
- `cgrid/src/worker/chunkFormat.ts` — existing serialization.
- `cgrid/tests/chunkFormat.test.ts` — existing round-trip tests.
- **An ungrouped chunk fixture must round-trip cleanly through
  the new readers.** Save one from a current Cycle 4 test
  (`tests/fixtures/ungrouped-cycle4-snapshot.bin` — new).

**Files:**
- `cgrid/src/worker/chunkFormat.ts` — add `rowKind: Uint8Array`,
  `groupDepth: Uint8Array`, `groupValue: string[]`,
  `groupChildCount: Uint32Array`, `isExpanded: Uint8Array` to the
  output chunk. Existing fields keep their offsets.
- `cgrid/src/worker/protocol.ts` — version-bump the chunk
  payload type (additive; no breaking change).
- `cgrid/src/worker/client.ts` — main-thread decoder reads the
  new fields, falls back to defaults when missing
  (`rowKind: 0 (data)`, `groupDepth: 0`, `isExpanded: 1`).
- `cgrid/tests/chunkFormat.group.test.ts` (new) — 10 cases:
  serialize / deserialize / round-trip data-only chunk (no group
  fields written → defaults read) / round-trip grouped chunk /
  partial-fields chunk (only rowKind set, others default) /
  large-string groupValue / null/undefined groupValue /
  ungrouped fixture round-trip from
  `tests/fixtures/ungrouped-cycle4-snapshot.bin` / version
  mismatch tolerated / size estimate matches actual.
- `cgrid/tests/fixtures/ungrouped-cycle4-snapshot.bin` (new) —
  binary fixture captured from a current Cycle 4 chunk.

**Steps:**

1. Capture the ungrouped-cycle4 fixture by running an existing
   Cycle 4 chunk test with a `fs.writeFile` hook.
2. Extend `chunkFormat.ts` per the additive rule.
3. Bump the protocol type; main decoder handles default values.
4. Write 10 unit cases. The fixture round-trip is the critical
   regression guard.
5. Run `npx vitest run chunkFormat` — clean.

**Acceptance:**
- 10 unit cases pass including the fixture round-trip.
- Cycle 4 readers continue working against current data.
- Grouped chunks round-trip lossless.

**Commit:** `feat(cgrid): GroupedRow chunk format extension (append-only, Cycle 4 fixture round-trips)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 4."

---

## Phase B — Rendering (Tasks 4–5)

The worker pipeline is now feeding `rowKind / groupDepth / …`
through the chunk. Tasks 4–5 build the visual surface: the auto-group
column and the `'group'` cell renderer.

---

## Task 4 — Auto-group column + `'group'` cell renderer

**Read first:**
- This worklog's Architecture.
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`**
  — pin open. The auto-group column is the leftmost: chevron +
  indent (one chevron-width per depth) + group value + optional
  `(count)` in muted weight.
- `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`
  — the totals signature. The group footer row (Task 11) shares
  this vocabulary; the group ROW (this task) uses a similar but
  lighter treatment (no top border, no bg shift — just the
  chevron + indent + value).
- `cgrid/src/renderer/cellRenderers/registry.ts` — existing
  built-in renderers; `'group'` registers here.

**Files:**
- `cgrid/src/core/autoGroupColumn.ts` (new) — synthesizes the
  auto-group column def. Inserts at index 0 of `columnOrder` when
  `rowGroupCols.length > 0` AND `groupDisplayType !== 'multipleColumns'`.
- `cgrid/src/renderer/cellRenderers/group.ts` (new) — paint
  function. Reads `chunk.rowKind / .groupDepth / .groupValue /
  .groupChildCount / .isExpanded`. Paints: indent + chevron + value
  + optional `(count)`.
- `cgrid/src/renderer/cellRenderers/registry.ts` — register
  `'group'` under that key.
- `cgrid/src/theming/tokens.css` — `.cg-group-cell`,
  `.cg-group-chevron`, `.cg-group-indent`, `.cg-group-count` rules.
  Designed per the design-pass plan.
- `cgrid/src/cgrid.ts` — insert auto-group column when grouping
  is active.
- `cgrid/src/types.ts` — `CGridOptions.autoGroupColumnDef`,
  `groupDisplayType` (Task 5 extends).
- `cgrid/tests/autoGroupColumn.test.ts` (new) — 12 cases: insert
  at idx 0 / no insert when rowGroupCols empty / no insert when
  groupDisplayType='multipleColumns' (Task 5) / autoGroupColumnDef
  overrides defaults / chevron toggles based on isExpanded /
  indent scales with depth / `(count)` formatted per locale /
  custom value formatter applied / null value renders "—" /
  cellClassRules applied / interaction with focus ring (must use
  `getVisibleCellBounds` per Cycle 12) / interaction with
  cellSelection (group cell selectable).
- `apps/cgrid-positions/e2e-visual/20-group-one-level.spec.ts`
  (new) — seeds 100 rows, groups by `ticker`, snapshots
  `20-group-one-level.png` with all groups expanded showing the
  auto-group column + chevron + count.

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design`
   (`Skill` tool, skill name `frontend-design`) with this brief:
   *"Design the auto-group column cell for canvasgrid. Each cell
   shows chevron + indent (one chevron-width per depth) + group
   value + optional (count) suffix. Reference:
   `docs/catalog/screenshots/09-grouping-three-level-expanded.png`.
   The group row should read as STRUCTURAL chrome (you know it's
   a tree node, not a data row) without competing with the data
   cells for attention. Decide: chevron glyph (▶/▼ vs ›/⌄ vs
   custom), chevron colour vs body fg, indent unit (12px? 16px?
   one chevron-width?), count typography (muted weight, paren
   style, leading space). The grouped grid should feel like one
   cohesive page, not 'data rows + interrupting group strips'."*
   Record the returned palette / type / layout decisions in
   `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   (new) and cite that file in the commit message.
2. Implement `autoGroupColumn.ts`.
3. Implement the `'group'` cell renderer.
4. Wire into `cgrid.ts` (insert column when grouping active).
5. Build the 12-case test suite.
6. Build visual cell 20.
7. Visual review against the reference. If the group row looks
   like "data row with weird first column" — **GO BACK TO
   STEP 1**.

**Acceptance:**
- Auto-group column inserts when grouping is active.
- Chevron + indent + value + count paint per the design plan.
- Visual cell 20 baselined.
- Design notes file exists with the design-skill output.

**Commit:** `feat(cgrid): auto-group column + 'group' cell renderer` — body MUST cite the design notes file.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 5."

---

## Task 5 — `groupDisplayType: 'multipleColumns' | 'groupRows' | 'custom'`

**Read first:**
- This worklog's Architecture.
- Task 4 design notes — the multi-column variant inherits the
  same visual vocabulary, just one column per group level.
- ag-grid website fallback for the `'groupRows'` variant (where
  the group label spans the row instead of sitting in one column):
  `https://www.ag-grid.com/javascript-data-grid/grouping-group-rows/`.
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`**
  — the canonical reference is `'singleColumn'` (default); the
  `'multipleColumns'` variant has one auto-group column PER
  rowGroupCols entry.

**Files:**
- `cgrid/src/cgrid.ts` — option resolution for
  `groupDisplayType: 'singleColumn' | 'multipleColumns' | 'groupRows' | 'custom'`.
- `cgrid/src/core/autoGroupColumn.ts` — `'multipleColumns'` mode
  synthesizes one column per rowGroupCol; `'groupRows'` mode
  spans the row in a single header-style strip; `'custom'`
  defers to `groupRowRenderer`.
- `cgrid/src/renderer/cellRenderers/group.ts` — handle the
  `'groupRows'` rendering case (full-row span).
- `cgrid/tests/groupDisplayType.test.ts` (new) — 9 cases per
  mode × edge cases.
- `apps/cgrid-positions/e2e-visual/21-group-three-level-multipleColumns.spec.ts`
  (new) — seeds 200 rows, groups by 3 columns,
  `groupDisplayType: 'multipleColumns'`, snapshots
  `21-group-three-level-multipleColumns.png`.

**Steps:**

1. **DESIGN PASS.** Brief: *"Design the `'multipleColumns'`
   group display variant: one auto-group column per rowGroupCols
   entry, in order. Each column shows its level's chevron + value
   + count for the current row's ancestor at that depth. Decide:
   how do empty cells render when a row's ancestor at depth N
   isn't a group leaf (data rows under a leaf group)? Inherits
   Task 4 vocabulary. Reference the screenshot + the
   ag-grid grouping-display-types page."* Append to notes.
2. Implement option resolution.
3. Extend `autoGroupColumn.ts` to synthesize multiple columns
   per mode.
4. Extend the `'group'` renderer to handle `'groupRows'` full-row
   span.
5. Build the 9-case test suite.
6. Build visual cell 21.

**Acceptance:**
- `'multipleColumns'` synthesizes N auto-group columns.
- `'groupRows'` renders full-row group strips.
- `'custom'` defers to the app's `groupRowRenderer`.
- Visual cell 21 baselined.

**Commit:** `feat(cgrid): groupDisplayType — singleColumn / multipleColumns / groupRows / custom`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 6."

---

## Task 6 — Row group panel (drop strip above headers) + drag-from-header

**Read first:**
- This worklog's Architecture.
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`**
  — pin open. The top strip shows three chips:
  `≡ Desk ✕  ▸  ≡ Region ✕  ▸  ≡ Instrument Type ✕`. That's the
  row group panel: one chip per `rowGroupCols[i]` in order, each
  with a drag-handle glyph, the column header, and an ✕ to
  remove the grouping. Empty-state shows placeholder text like
  "Drag here to set row groups" (see also the side-bar Columns
  panel's Row Groups drop zone shipped in Cycle 11 for vocabulary
  reference).
- `docs/catalog/09-row-grouping.md` — `rowGroupPanelShow`,
  `rowGroupPanelSuppressSort`, `enableRowGroup` definitions.
- `cgrid/src/interaction/features/columnDrag.ts` — existing
  column-header drag wiring (Cycle 6). This task EXTENDS it
  with a new drop target (the row group panel) rather than
  reimplementing drag.
- `cgrid/src/interaction/sideBar/host.ts` — the side bar mounts a
  DOM strip on the right edge; the row group panel mounts a
  horizontal strip on top. Same `setReservedSpace` channel
  reserves the inset.
- Memory: `feedback_ui_quality_bar.md` — **invoke `/frontend-design`
  BEFORE writing CSS or DOM.** This task ships a NEW visual surface
  (the panel + chips); non-negotiable.

**Files:**
- `cgrid/src/interaction/rowGroupPanel/host.ts` (new) —
  `RowGroupPanelHost` class. Mounts a horizontal DOM strip
  between the side bar's top edge and the column header row.
  Renders one chip per `rowGroupCols[i]`. Accepts drop events
  from the column-drag feature.
- `cgrid/src/interaction/rowGroupPanel/types.ts` (new) — public
  types: `RowGroupPanelShow` union, `RowGroupChipParams`.
- `cgrid/src/interaction/features/columnDrag.ts` (extend) — when
  the user drags a column header AND the row group panel is
  visible AND the column has `enableRowGroup: true`, the panel
  becomes a drop target. Drop appends the column to
  `rowGroupCols` (or moves it within the chip strip when
  dragging an existing chip).
- `cgrid/src/cgrid.ts` — mount the host when `rowGroupPanelShow`
  resolves to `'always'` or `'onlyWhenGrouping' AND
  rowGroupCols.length > 0`. Reserve top-inset via the same
  `setHostBounds` channel side bar / status bar use.
- `cgrid/src/core/canvas.ts` — extend `setHostBounds` to also
  accept a `top` inset (currently `top: 0` is hardcoded for the
  header subgrid; the panel sits ABOVE that subgrid).
- `cgrid/src/theming/tokens.css` — `.cg-row-group-panel`,
  `.cg-row-group-chip`, `.cg-row-group-chip-handle`,
  `.cg-row-group-chip-label`, `.cg-row-group-chip-remove`,
  `.cg-row-group-panel-empty` rules. Designed per the
  `/frontend-design` plan.
- `cgrid/src/cgrid.ts` — `CGridOptions.rowGroupPanelShow:
  'always' | 'onlyWhenGrouping' | 'never'` (default `'never'`),
  `rowGroupPanelSuppressSort: boolean`, per-column
  `enableRowGroup: boolean`.
- `cgrid/src/types.ts` — public option types.
- `cgrid/tests/rowGroupPanel.test.ts` (new) — 16 cases: mount /
  hide when `rowGroupPanelShow: 'never'` /
  `'onlyWhenGrouping'` mount on first chip / unmount on last
  chip removed / `'always'` mount empty / chip order matches
  `rowGroupCols` / chip × click removes column from grouping /
  chip drag re-orders / drop from column header appends /
  `enableRowGroup: false` column rejected at drop / chip click
  toggles sort (when `rowGroupPanelSuppressSort: false`) /
  `rowGroupPanelSuppressSort: true` hides sort indicator / panel
  shrinks canvas top inset / empty-state placeholder text /
  destroy unmounts cleanly / setOption mid-flight re-mounts /
  multi-column rowGroupCols renders ordered chips.
- `apps/cgrid-positions/e2e-visual/22-rowGroupPanel-empty.spec.ts`
  (new) — seeds 50 rows, `rowGroupPanelShow: 'always'`, no
  `rowGroupCols`, snapshots
  `22-rowGroupPanel-empty.png` showing the empty-state strip.
- `apps/cgrid-positions/e2e-visual/23-rowGroupPanel-three-chips.spec.ts`
  (new) — seeds 200 rows, groups by 3 columns, snapshots
  `23-rowGroupPanel-three-chips.png` matching the reference.
- `apps/cgrid-positions/e2e/cycle15-dragColumnToRowGroupPanel.spec.ts`
  (new) — E2E: drag a column header into the panel; assert
  `rowGroupCols` updates AND grouping applies.

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design`
   (`Skill` tool, skill name `frontend-design`) with this brief:
   *"Design the row group panel for canvasgrid — a horizontal
   drop strip ABOVE the column header row. It hosts one chip per
   grouped column. Each chip: drag-handle glyph, column label,
   × remove button. Empty state: placeholder text 'Drag here to
   set row groups' (matches the side-bar Columns panel's
   drop-zone vocabulary from Cycle 11 — keep the language
   coherent). Reference:
   `docs/catalog/screenshots/09-grouping-three-level-expanded.png`
   (top strip). The panel is functional, not decorative — users
   change grouping by dragging columns in / chips out. Decide:
   chip border-radius (4 vs 6 vs pill?), chip horizontal
   separator (› arrow vs no separator vs vertical rule?), drop
   indicator (dashed outline on the whole panel? a vertical
   insertion line between chips?), hover/active states for
   chips, empty-state typography. Vocabulary continuity:
   cycle-11 sidebar v2 chips + cycle-13 status-bar 'sandwich' —
   does this panel match either, or is it its own thing? Argue
   the choice."* Record the returned palette / type / layout
   decisions in `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   (append; the file was created in Task 4) and cite it in the
   commit message.
2. Implement `RowGroupPanelHost` mirroring `SideBarHost` /
   `StatusBarHost` patterns.
3. Extend `setHostBounds` for a `top` inset (currently
   hardcoded 0).
4. Extend `columnDrag.ts` with the row-group-panel drop target.
   Reuse the existing drag-start / drag-move event flow; only
   the drop handler is new.
5. Wire option resolution in `cgrid.ts`. The panel mounts based
   on the `rowGroupPanelShow` value and current
   `rowGroupCols.length`.
6. Build the 16-case test suite.
7. Build BOTH visual cells (22 empty, 23 three chips).
8. Build the E2E spec — drag a column from the header into the
   panel.
9. Visual review against the reference. If the chips look like
   "rectangular labels with an x button" instead of considered
   chip controls — **GO BACK TO STEP 1**.

**Acceptance:**
- Panel mounts per `rowGroupPanelShow`.
- Chips render in `rowGroupCols` order.
- Drag column from header onto panel appends to `rowGroupCols`.
- Click chip × removes column from grouping.
- Empty-state placeholder reads "Drag here to set row groups"
  matching Cycle 11 vocabulary.
- Visual cells 22 + 23 baselined.
- E2E passes.
- Design notes appended.

**Commit:** `feat(cgrid): row group panel (drop strip above headers) + drag-from-header + rowGroupPanelShow / Suppress / enableRowGroup` — body MUST cite the design notes file.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 7."

---

## Phase C — Interaction (Tasks 6–8)

Group rows are rendering. Add the **row group panel** that lets the
user drag column headers to change the grouping, then make the group
rows clickable (expand/collapse), then extend selection to handle
hierarchical tri-state.

---

## Task 7 — Expand/collapse interaction + API

**Read first:**
- This worklog's Architecture.
- `cgrid/src/interaction/features/featureChain.ts` — feature
  registration; `GroupExpandFeature` slots into the chain before
  `EditTriggerFeature`.
- `cgrid/src/interaction/feature.ts` — `CGridLike` interface.
- `cgrid/src/worker/passes/groupPass.ts` (Task 1) —
  `expandedKeys` is the input that drives slicing.

**Files:**
- `cgrid/src/interaction/features/groupExpand.ts` (new) — hit-test
  on the chevron region of an auto-group cell; toggle the group's
  `expandedKeys` entry; dispatch to the worker via
  `workerClient.setExpandedKeys(Set<string>)`.
- `cgrid/src/cgrid.ts` — API: `expandAll()` / `collapseAll()` /
  `setExpanded(groupKey: string, expanded: boolean)` /
  `getExpandedKeys(): Set<string>`. Event: `rowGroupOpened`
  fires when an individual group toggles;
  `expandOrCollapseAll` fires on the bulk APIs.
- `cgrid/src/worker/passes/groupPass.ts` — accept
  `expandedKeys: Set<string>` from the protocol.
- `cgrid/src/types.ts` — event payload types.
- `cgrid/tests/groupExpand.test.ts` (new) — 15 cases.
- `apps/cgrid-positions/e2e-visual/24-groups-all-collapsed.spec.ts`
  (new) — seeds 100 rows, groups by ticker, calls `collapseAll()`,
  snapshots `24-groups-all-collapsed.png` (all groups closed,
  chevron right-facing).
- `apps/cgrid-positions/e2e/cycle15-groupExpand.spec.ts` (new) —
  E2E for the chevron click flow.

**Steps:**

1. **DESIGN PASS** (light — chevron hit zone + animation). Brief:
   *"The chevron toggles groups. Decide: hit zone (the chevron
   itself, or the whole indent column?), hover state (faint
   highlight, none?), expand/collapse animation (none vs 200ms
   chevron rotate)."* Append to notes.
2. Implement `GroupExpandFeature`.
3. Implement the API on `cgrid.ts`.
4. Wire the worker `setExpandedKeys` message.
5. Build the 15-case test suite.
6. Build visual cell 22.
7. Build the E2E spec.

**Acceptance:**
- Click chevron toggles group; viewport recomputes.
- `expandAll / collapseAll / setExpanded / getExpandedKeys` work.
- Events fire with correct payloads.
- Visual cell 22 baselined.
- E2E passes.

**Commit:** `feat(cgrid): group expand/collapse interaction + API`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 8."

---

## Task 8 — `groupSelectsChildren` + tri-state checkbox

**Read first:**
- This worklog's Architecture.
- `cgrid/src/interaction/selectionModel.ts` — existing
  selection model. Extend (don't replace) for tri-state.
- **`docs/catalog/screenshots/09-grouping-three-level-expanded.png`**
  — pin open. Notice the checkboxes on group rows; in the
  screenshot they're shown checked (descendants all selected
  shows checked; mixed shows indeterminate).
- `cgrid/src/renderer/cellRenderers/checkbox.ts` (if it exists,
  otherwise the registry's checkbox renderer) — extend to handle
  `state: 'unchecked' | 'checked' | 'indeterminate'`.

**Files:**
- `cgrid/src/interaction/selectionModel.ts` — `setRowSelected`
  cascades to descendants when the row is a group AND
  `groupSelectsChildren` is on. `getSelectedRowIds()` returns the
  flat list of leaf rows (no group keys). New
  `getGroupSelectionState(groupKey): 'none' | 'partial' | 'all'`.
- `cgrid/src/renderer/cellRenderers/group.ts` — render the
  tri-state checkbox per the design.
- `cgrid/src/theming/tokens.css` — indeterminate checkbox visual
  (often a dash inside the box).
- `cgrid/src/cgrid.ts` — `CGridOptions.groupSelectsChildren:
  boolean` option.
- `cgrid/tests/triStateSelection.test.ts` (new) — 13 cases.
- `apps/cgrid-positions/e2e-visual/25-groupSelectsChildren-indeterminate.spec.ts`
  (new) — seeds 50 rows, groups by ticker, selects ~half the
  children of one group, snapshots
  `25-groupSelectsChildren-indeterminate.png` (showing one
  group's checkbox in the indeterminate state).

**Steps:**

1. **DESIGN PASS** (medium — the indeterminate state's visual
   is the design risk). Brief: *"Decide the indeterminate
   checkbox visual: dash inside box (Excel/macOS pattern)? Half-fill?
   Filled-but-muted? Reference the ag-grid screenshot — the
   indeterminate state must read distinctly from both 'checked'
   AND 'unchecked' at body-row font size."* Append to notes.
2. Extend `selectionModel.ts` for tri-state.
3. Extend the `'group'` renderer's checkbox path.
4. Add the tri-state CSS.
5. Build the 13-case test suite.
6. Build visual cell 23.

**Acceptance:**
- Selecting a group selects all descendants.
- Selecting all children selects the group.
- Partial child selection renders indeterminate.
- Visual cell 23 baselined.

**Commit:** `feat(cgrid): groupSelectsChildren + tri-state checkbox`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 9."

---

## Phase D — Polish (Tasks 9–11)

These tasks refine behaviour around an existing surface; minimal new
chrome.

---

## Task 9 — `groupDefaultExpanded` + `groupDefaultExpandedKeys`

**Read first:** This worklog's Architecture; Task 6.

**Files:**
- `cgrid/src/cgrid.ts` — `groupDefaultExpanded: number | 'all'`
  (number = expand depth ≤ N) + `groupDefaultExpandedKeys: string[]`
  (explicit list overrides depth).
- `cgrid/src/worker/passes/groupPass.ts` — read the option on
  init; seed `expandedKeys` accordingly.
- `cgrid/tests/groupDefaultExpanded.test.ts` (new) — 7 cases.

**Steps:** Standard. No design pass (no new chrome).

**Commit:** `feat(cgrid): groupDefaultExpanded + groupDefaultExpandedKeys`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 10."

---

## Task 10 — `showOpenedGroup` + `groupRemoveSingleChildren`

**Read first:** This worklog's Architecture; the ag-grid website's
"grouping-opening-groups" page for `showOpenedGroup` behaviour.

**Files:**
- `cgrid/src/worker/passes/groupPass.ts` — when
  `groupRemoveSingleChildren: true`, elide groups whose
  `childCount === 1` (the lone child renders directly under the
  parent group's parent).
- `cgrid/src/renderer/cellRenderers/group.ts` — when
  `showOpenedGroup: true`, an expanded group's value also renders
  in its data rows' auto-group cell (the group "follows" its
  children visually).
- `cgrid/tests/groupElision.test.ts` (new) — 8 cases.

**Steps:** Standard. Light design pass — if `showOpenedGroup`
changes the cell composition, briefly /frontend-design check.

**Commit:** `feat(cgrid): showOpenedGroup + groupRemoveSingleChildren`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 11."

---

## Task 11 — Group-aware sort

**Read first:**
- This worklog's Architecture (perf gate: 100 K rows ≤ 100 ms).
- `cgrid/src/worker/passes/sortPass.ts` — the existing sort pass.
- Cycle 8 worklog (sorting) for the comparator chain.

**Files:**
- `cgrid/src/worker/passes/sortPass.ts` — when
  `rowGroupCols.length > 0`, sort within each group bucket
  independently (faster than global sort then group). Sort
  group-level rows by group value OR
  `columnDefs[].sortComparator` if provided.
- `cgrid/src/types.ts` — `CColDef.sortGroupRowsByKey: boolean`.
- `cgrid/tests/groupSort.test.ts` (new) — 10 cases.
- `cgrid/tests/groupSort.perf.test.ts` (new) — 100 K grouped rows
  sort ≤ 100 ms.

**Steps:** Standard. No design pass (no chrome).

**Commit:** `feat(cgrid): group-aware sort (within-bucket + group-level)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 12."

---

## Phase E — Group totals (Task 12)

The aggregation feedback loop: per-group totals via the same
`TotalsSubgrid` + `aggMath` modules.

---

## Task 12 — Group totals (footer rows)

**Read first:**
- This worklog's Architecture (reuse `TotalsSubgrid` +
  `aggMath` + `AggFuncRegistry` — DO NOT re-implement).
- `cgrid/src/core/subgrid.ts` — `TotalsSubgrid` from Cycle 14;
  this task generalises it to per-group footer rows.
- **`docs/catalog/screenshots/09-grouping-group-total-row.png`** —
  pin open. Group footers ("Total APAC", "Total Rates", "Total")
  carry the totals signature from Cycle 14 ("hairline lift") —
  same visual language.
- `docs/superpowers/plans/notes/cycle-14-aggregation-design.md` —
  the canonical totals vocabulary.

**Files:**
- `cgrid/src/core/subgrid.ts` — extend `TotalsSubgrid` to accept
  a `parentGroupKey: string` and a per-group totals lookup.
- `cgrid/src/worker/passes/aggPass.ts` — compute per-group
  totals during the same pass that computes the grand total.
  Reuse `AggFuncRegistry`.
- `cgrid/src/cgrid.ts` — `CGridOptions.groupIncludeFooter: boolean`
  + `groupIncludeTotalFooter: boolean`. When true, mount a
  footer row at the bottom of each expanded group.
- `cgrid/src/theming/tokens.css` — extend `.cg-totals-row` /
  `.cg-totals-cell` to handle the per-group case (slightly less
  weight than the grand total).
- `cgrid/tests/groupFooter.test.ts` (new) — 12 cases.
- `apps/cgrid-positions/e2e-visual/26-group-footer-rows.spec.ts`
  (new) — seeds 100 rows, groups by ticker, enables
  `groupIncludeFooter: true`, snapshots
  `26-group-footer-rows.png`.

**Steps:**

1. **DESIGN PASS.** Brief: *"Group footer rows show per-group
   totals. They INHERIT the totals signature from Cycle 14
   (hairline lift). Decide: do per-group footers get the FULL
   totals treatment or a LIGHTER one (the grand total stays the
   heaviest)? Reference: cycle-14-aggregation-design.md +
   `09-grouping-group-total-row.png`."* Append to notes.
2. Extend `TotalsSubgrid` for per-group case.
3. Extend `AggPass` for per-group totals.
4. Wire `groupIncludeFooter / groupIncludeTotalFooter` options.
5. Build the 12-case test suite.
6. Build visual cell 24.
7. Visual review — the data → group → footer → total hierarchy
   should read as a deliberate weight ladder.

**Acceptance:**
- Per-group footers render with correct totals.
- The 4 deferred Area 10 rows flip to ✅.
- Visual cell 24 baselined.

**Commit:** `feat(cgrid): group totals (footer rows under each expanded group, hairline-lift vocabulary)` — body cites design notes.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md` and execute Task 13."

---

## Task 13 — Cycle 15 exit ritual

**Read first:**
- This worklog (every prior task).
- Cycle 14 exit ritual template.
- `docs/catalog/FEATURE_MATRIX.md` — Area 09 + Area 10 rows to
  flip.

**Files:**
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-15-row-grouping.md`
  — add the "## Shipped" block listing the 12 PRs + commit
  SHAs + which matrix cell each new visual covers.
- `apps/cgrid-positions/src/positionsGrid.ts` — enable grouping
  by `ticker` (1 level) in the demo with `groupIncludeFooter:
  true`. Toggle via `?grouping=demo` flag; default off so visual
  cells 01–19 stay byte-stable.
- `docs/catalog/FEATURE_MATRIX.md` — flip Area 09 rows (50 of 54)
  and the deferred Area 10 rows (2 of 2 group-footer rows).
- `README.md` — update screenshot if grouping is on by default.
- Visual matrix re-baseline: if `?grouping=demo` becomes the
  default, cells 01–19 + 20–24 re-baseline. PR title gets
  `[visual-baseline-update]`.

**Steps:**

1. Verify every Task 1–11 PR is merged on `main`.
2. Wire the demo.
3. Re-baseline affected visual cells.
4. Run full local check (`npm test`, `npm run test:e2e`,
   `npm run test:visual`).
5. Flip FM rows.
6. Write the "## Shipped" block.

**Acceptance:**
- All 12 Cycle 15 PRs merged.
- Three test suites green locally.
- FM Area 09 = 50/54 ✅ (pivot-specific 4 rows deferred to Cycle 18).
- FM Area 10 = 26/26 ✅ (the two group-footer rows from Cycle 14
  finally land).
- Demo loads with a visible, professional-looking grouped grid.

**Commit:** `docs(cycle-15): exit ritual — Shipped log + FM Area 09 + 10 flips + demo wires grouping default`

**Next session prompt:** "Cycle 15 complete — STOP. Do NOT proceed to Cycle 16."

---

## Anti-regression checklist (applies to EVERY task in this cycle)

Tick each item before pressing `git commit`. If any item is unticked,
**fix the cause before committing** — the cost of a patch PR after
review is 10× the cost of catching it now.

- [ ] **Design pass run via `/frontend-design`** (UI tasks only).
      Plan recorded in `docs/superpowers/plans/notes/cycle-15-grouping-design.md`.
      Commit message cites the file.
- [ ] **Reference screenshot opened side-by-side** with the rendered
      output. If no screenshot exists for the sub-surface, the
      ag-grid website page is open instead (per
      `consult-ui-screenshots-before-shipping` memory).
- [ ] **Visual matrix cell added** (UI tasks only). Baseline PNG
      committed. Spec docstring names the regression it catches.
      PR title carries `[visual-baseline-new]` or
      `[visual-baseline-update]`.
- [ ] **Unit tests pass** locally: `npx vitest run` clean.
- [ ] **TypeScript clean**: `npx tsc --noEmit -p cgrid` zero errors.
- [ ] **Visual matrix passes** locally: `cd apps/cgrid-positions
      && npm run test:visual` clean.
- [ ] **Worker perf gate** met (Tasks 1, 10 specifically).
- [ ] **`aggMath` + `AggFuncRegistry` are the single source of
      truth for aggregation.** Group footers compute via the same
      registry. If you wrote sum / avg / min / max / count again,
      delete and reuse.
- [ ] **`TotalsSubgrid` (Cycle 14) is the model for the group-footer
      subgrid.** Task 11 extends it; does not replace it.
- [ ] **Chunk format additions are append-only.** Cycle 4 readers
      continue to work against current data. Verified by the
      ungrouped-fixture round-trip in `chunkFormat.group.test.ts`.
- [ ] **Body-band clip respected** for any new DOM overlay or
      canvas paint. Use `getVisibleCellBounds` for cell-anchored
      DOM nodes (Cycle 12 helper).
- [ ] **No `any` in new code.** Use the public types
      (`GroupNode`, `GroupPassOutput`, …).
- [ ] **`docs/superpowers/plans/notes/cycle-15-grouping-design.md`
      updated** with any design decisions made during the task so
      Task N+1 inherits the vocabulary.

---

## Shipped

(Filled in by Task 12 once every PR has merged.)
