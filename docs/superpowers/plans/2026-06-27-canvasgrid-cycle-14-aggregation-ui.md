# Canvasgrid Cycle 14 — Aggregation UI — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Surface the worker's existing aggregation pipeline. Ship the
**`TotalsSubgrid`** that renders pinned at top or bottom showing totals
across all rows; **`pinnedTopRowData` / `pinnedBottomRowData`** for
arbitrary static pinned rows; **custom `aggFunc` registration**;
**`suppressAggFuncInHeader`** toggle; the **`'totals'` cell renderer**
with deliberate visual hierarchy; and the **`aggregationChanged` event
polish**. Group-footer totals are scoped out — those land in Cycle 15
(Row grouping) where they have their natural home.

**FM coverage:** Area 10 — ~24 of 26 rows ✅ at cycle exit (the
remaining two are group-footer specific; covered by Cycle 15).

**Depends on:** Cycle 5 (variable row heights — totals rows can have
distinct heights), Cycle 13 (Status bar — the `agAggregationComponent`
shares the aggFunc registry; do not duplicate the math).

**Performance gate:** Totals row reads already-computed totals from
the `ViewportChunk` — zero recomputation on scroll. Custom aggFuncs
run on the worker (the registry ships function bodies or named
references via the protocol).

**Architecture:**

- **`TotalsSubgrid`** is a new `Subgrid` implementation with
  `isTotals: true`. Its `getCell(row, colId)` returns
  `chunk.totals[colId]`. It mounts INTO `this.subgrids` as a
  pinned-top or pinned-bottom subgrid (same mechanism the
  header subgrid uses — already non-scrolling per the viewport
  math). One row tall by default; per-column height override via
  `pinnedRowHeight`.
- **Pinned rows** (top / bottom) generalise the same subgrid:
  `pinnedTopRowData: TRow[]` and `pinnedBottomRowData: TRow[]` mount
  one row per array entry. Static data — the main thread owns it;
  no worker round-trip.
- **Custom aggFunc registry**: `CGridOptions.aggFuncs: Record<string,
  AggFunc>` lives on the main thread; the keys ship to the worker
  on init + on `setGridOption('aggFuncs', …)`. Function bodies
  serialise via the same `Function.toString()` channel
  `processCellForClipboard` uses (Cycle 10). Named-registry
  shortcuts (`'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' |
  'last'`) bypass serialisation.
- **`suppressAggFuncInHeader`** is a per-grid (and per-column)
  boolean. When `false` (default) the header cell renders `sum(price)`;
  when `true` it renders `price` and pushes the agg context to the
  totals row only.
- **Totals cell renderer** is a new built-in `'totals'` renderer.
  Subtle top border, slightly heavier weight, value formatted via
  the column's `valueFormatter` (same channel data cells use).
  Designed per the `/frontend-design` pass — not freehand.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E
+ visual). No new runtime dependencies. The aggregation math lives
on the worker (already there from Cycle 13 / Task 3's `aggMath`
module — pull that into the worker side as a shared module).

**References (READ FIRST when starting any task):**

- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` —
  master plan (Cycle 14 — Aggregation UI, post-renumber).
- `docs/catalog/10-aggregation.md` — surface spec: `AggFunc` shape,
  `aggregationStage` field, `valueGetter` precedence rules,
  `aggregationChanged` event payload.
- **`docs/catalog/screenshots/10-aggregation-aggfunc-in-header-real.png`**
  — canonical light-theme reference. Headers render as
  `sum(Notional)`, `sum(Market...)`, `avg(...)`. Bottom "Total" row
  shows grand totals. Status bar at the bottom is Cycle 13's; do
  not re-implement.
- **`docs/catalog/screenshots/10-aggregation-aggfunc-in-header.png`**
  — alternate angle showing the toggle's effect.
- **ag-grid website fallback** (per the
  `consult-ui-screenshots-before-shipping` memory): when a
  sub-surface isn't covered by a screenshot (the totals row's
  dark-theme variant, pinned-top vs pinned-bottom appearance, custom
  aggFunc edge cases), consult
  `https://www.ag-grid.com/javascript-data-grid/aggregation/` and
  `https://www.ag-grid.com/javascript-data-grid/grid-options/#reference-rowPinning`.
- `docs/catalog/FEATURE_MATRIX.md` — Area 10 rows to flip at cycle
  exit.
- `docs/superpowers/plans/notes/cycle-13-statusbar-design.md` — the
  `agAggregationComponent` design vocabulary. The totals row uses
  the **same** aggregated values; reuse the format / weight
  language so a user reading both the agg panel and the totals row
  sees one design.
- Current source:
  - `cgrid/src/core/subgrid.ts` — Subgrid interface +
    HeaderSubgrid / DataSubgrid impls. `TotalsSubgrid` lands here.
  - `cgrid/src/worker/dataPipeline.ts` — already computes totals
    per chunk. Audit + expose under `chunk.totals[colId]` if not
    already there.
  - `cgrid/src/worker/passes/` — pass folder for aggFunc resolution.
    New `aggFuncRegistry.ts` lives here.
  - `cgrid/src/interaction/statusBar/aggMath.ts` (Cycle 13 / Task 3)
    — `aggregate(values, funcs)` pure-fn. PROMOTE to a shared module
    used by both the status panel AND the totals subgrid — single
    source of truth.
  - `cgrid/src/renderer/cellRenderers/registry.ts` — built-in
    renderers. `'totals'` registers here.
  - `cgrid/src/theming/tokens.css` — `.cg-totals-row`,
    `.cg-totals-cell`, header-suffix rules. Designed per the
    `/frontend-design` pass, not freehand.

**Global Constraints:**

- TypeScript strict — no `any` in new code.
- `npm test` (Vitest, ~1098 tests at Cycle 13 exit, grows to ~1160
  this cycle) stays green.
- `npm run test:e2e` (existing Playwright functional) stays green.
- `npm run test:visual` (matrix cells 01–16 from Cycles 12–13 +
  3 new Cycle 14 cells added across Tasks 1, 4, 5) stays green.
- The totals row must NOT trigger an extra worker pass per scroll
  — verified with a Vitest test that spies on `workerClient.send`
  and counts agg-related messages.
- **EVERY UI TASK MUST INVOKE `/frontend-design`** (or a more specific
  Skill) BEFORE writing CSS or DOM. Cite the design plan in the
  task commit message and the PR body. Rationale: per the
  `ui-quality-bar` memory — this is non-negotiable, baked into the
  acceptance gate.
- **EVERY UI TASK MUST ADD AT LEAST ONE VISUAL MATRIX CELL** under
  `apps/cgrid-positions/e2e-visual/` covering the new surface.
  Baselines committed in the same PR (PR title gets the
  `[visual-baseline-new]` marker so reviewers know to expect new
  PNGs). The cell maps explicitly to "what regression would this
  catch" in the spec's docstring.
- **`aggMath.ts` from Cycle 13 / Task 3 is the single source of
  truth for agg math.** Do not re-implement `sum / min / max / avg /
  count` in the worker. Either (a) import the module from the worker
  bundle (Vite handles the shared-code split) or (b) duplicate as
  a generated artifact with a `// @generated` header — but the
  master-thread version stays canonical.
- No new runtime dependencies in `cgrid/`.
- Each task ends with `git commit` + `gh pr create` + wait for CI;
  next session starts on `main` after the merge.

## Task overview

| # | Title | UI? | Files touched | New tests |
|---|-------|-----|---------------|-----------|
| 1 | `TotalsSubgrid` + chunk.totals plumbing | yes | `cgrid/src/core/subgrid.ts`, `cgrid/src/worker/dataPipeline.ts`, `cgrid/src/cgrid.ts`, `cgrid/src/types.ts`, `tokens.css` | `totalsSubgrid.test.ts` (14 cases) + visual cell `17-totals-row-bottom.png` |
| 2 | `pinnedTopRowData` + `pinnedBottomRowData` | partial UI (renders rows but reuses cell renderers) | `cgrid/src/core/subgrid.ts`, `cgrid/src/cgrid.ts`, `cgrid/src/types.ts` | `pinnedRows.test.ts` (10 cases) + visual cell `18-pinned-top-row.png` |
| 3 | Custom aggFunc registry (main + worker) | no | `cgrid/src/worker/aggFuncRegistry.ts` (new), `cgrid/src/worker/passes/aggPass.ts`, `cgrid/src/worker/client.ts`, `cgrid/src/cgrid.ts`, `cgrid/src/types.ts` | `aggFuncRegistry.test.ts` (16 cases) |
| 4 | `suppressAggFuncInHeader` toggle | yes (header text changes) | `cgrid/src/renderer/painters/byRows.ts` (header cell text path), `cgrid/src/cgrid.ts`, `cgrid/src/types.ts` | `suppressAggFuncInHeader.test.ts` (6 cases) + visual cell `19-aggfunc-in-header.png` |
| 5 | `'totals'` cell renderer + visual polish | yes | `cgrid/src/renderer/cellRenderers/totals.ts` (new), `cgrid/src/renderer/cellRenderers/registry.ts`, `tokens.css` | `totalsRenderer.test.ts` (8 cases); visual cells 17 + 18 re-baseline against the polished renderer |
| 6 | `aggregationChanged` event polish | no | `cgrid/src/cgrid.ts`, `cgrid/src/types.ts` | `aggregationEvent.test.ts` (5 cases) |
| 7 | Cycle 14 exit ritual | yes (demo wires totals row by default) | worklog Shipped block, FM Area 10 flips, demo update | full suite green; FM 24/26 rows ✅ |

---

## Task 1 — `TotalsSubgrid` + chunk.totals plumbing

**Read first:**
- This worklog's Architecture + Global Constraints.
- **`docs/catalog/screenshots/10-aggregation-aggfunc-in-header-real.png`**
  — pin this open. Note the bottom "Total" row's visual weight:
  subtle top border, slightly heavier text, sits flush with the
  body bg (no dramatic colour shift).
- `cgrid/src/core/subgrid.ts` — Subgrid interface; the
  `HeaderSubgrid` is the closest analogue (non-scrolling,
  pinned, multi-row capable). `TotalsSubgrid` mirrors that shape.
- `cgrid/src/worker/dataPipeline.ts` — audit for an existing
  totals accumulator. If `chunk.totals` already exists, just expose
  it. If not, add per-column accumulators to the pass that emits
  the chunk.
- `cgrid/src/core/viewport.ts` — viewport math already accounts
  for multiple non-data subgrids (`bodyTop` is the sum of their
  heights). Add the totals subgrid to the subgrid stack at the
  correct position (after data when `pinnedBottom`, before data
  when `pinnedTop`).
- Memory: `feedback_ui_quality_bar.md` — **invoke `/frontend-design`
  BEFORE writing CSS or DOM.** The renderer itself lands in
  Task 5 but the subgrid's chrome (border-top placement, row
  height, bg behaviour) is decided here.

**Files:**
- `cgrid/src/core/subgrid.ts` — `class TotalsSubgrid implements
  Subgrid` with `isTotals: true`, `getRowCount(): 1`,
  `getRowHeight(): number`, `getCell(row, colId)` returning
  `chunk.totals[colId]`.
- `cgrid/src/worker/dataPipeline.ts` — ensure each emitted chunk
  carries a `totals: Record<colId, unknown>` map computed via
  `aggMath.aggregate` (the Cycle 13 / Task 3 module). For columns
  without an `aggFunc` declared on the colDef, the totals entry
  is `undefined`.
- `cgrid/src/cgrid.ts` — option resolution: when
  `options.totalsRowPosition: 'top' | 'bottom' | null` is set,
  push a `TotalsSubgrid` into `this.subgrids` at the matching slot.
- `cgrid/src/types.ts` — `CGridOptions.totalsRowPosition` type
  + `chunk.totals` field on the public ViewportChunk type.
- `cgrid/src/theming/tokens.css` — placeholder `.cg-totals-row`
  + `.cg-totals-cell` selectors so the visual cell can baseline
  the subgrid chrome separately from the cell-renderer polish in
  Task 5.
- `cgrid/tests/totalsSubgrid.test.ts` (new) — 14 cases: mount
  bottom / mount top / null = no mount / getCell returns chunk
  totals / getRowHeight default + override / chunk update triggers
  refresh / viewport math respects the new subgrid /
  variable-row-height interaction (Cycle 5).
- `apps/cgrid-positions/e2e-visual/17-totals-row-bottom.spec.ts`
  (new) — seeds 50 rows, configures the demo with
  `?totals=bottom`, snapshots
  `17-totals-row-bottom.png`. The baseline shows a bottom-pinned
  totals row with the renderer's POLISH (after Task 5) — for now
  the baseline shows the chrome from this task's CSS. Cell
  re-baselines in Task 5 once the renderer ships.

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design`
   (`Skill` tool, skill name `frontend-design`) with this brief:
   *"Design the totals-row chrome for canvasgrid — a single
   pinned row at the bottom (or top) of the grid body that shows
   per-column sum / avg / min / max / count values. Reference:
   `docs/catalog/screenshots/10-aggregation-aggfunc-in-header-real.png`
   (bottom 'Total' row + 'Total APAC', 'Total Rates' rows have
   the canonical treatment). Subject: financial data grid. The
   totals row must NOT compete with the body for the user's
   attention — it confirms the summary, doesn't shout it.
   Constraints: subtle top border, heavier weight on the
   numeric cells, bg either matches the body or tints by 4-6%,
   same monospace stack as body."* Record the returned
   palette / type / layout decisions in
   `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`
   (new) and cite that file in the commit message.
2. Implement `TotalsSubgrid` in `core/subgrid.ts`.
3. Audit + extend the worker pipeline to emit `chunk.totals`.
4. Wire the subgrid into `cgrid.ts` based on `options.totalsRowPosition`.
5. Build the 14-case test suite.
6. Build the visual cell (17). The baseline at this point shows
   the subgrid CHROME from `tokens.css` (border-top + reserved
   row height); the cell text is the raw chunk total values. Cell
   re-baselines in Task 5.
7. Visual review against the reference. If the row looks tacked-on
   — wrong padding, harsh divider, no rhythm with the body —
   **GO BACK TO STEP 1**.

**Acceptance:**
- `TotalsSubgrid` mounts at `top` or `bottom` per option.
- `chunk.totals` populated for every aggFunc-declared column.
- Viewport math respects the new subgrid; no canvas paint
  regressions in matrix cells 01–16.
- Visual cell 17 baselined.
- Design notes file exists with the design-skill output.

**Commit:** `feat(cgrid): TotalsSubgrid + chunk.totals plumbing (foundation for aggregation UI)` — body MUST cite the design notes file.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md` and execute Task 2."

---

## Task 2 — `pinnedTopRowData` + `pinnedBottomRowData`

**Read first:**
- This worklog's Architecture.
- Task 1's design notes (`docs/superpowers/plans/notes/cycle-14-aggregation-design.md`)
  — pinned rows reuse the totals-row chrome by default; they can
  override via `pinnedRowCellRenderer` per-column.
- `docs/catalog/10-aggregation.md` — `pinnedTopRowData` /
  `pinnedBottomRowData` sub-sections.
- `cgrid/src/core/subgrid.ts` — extend the subgrid model from
  Task 1 to support N rows (not just 1) when fed by a row-data
  array.

**Files:**
- `cgrid/src/core/subgrid.ts` — `class PinnedRowsSubgrid implements
  Subgrid` with `getRowCount(): rows.length`. Reuses the chrome
  rules from Task 1 unless the column def specifies a per-pinned
  renderer.
- `cgrid/src/cgrid.ts` — option resolution: mount a
  `PinnedRowsSubgrid` per-array when `pinnedTopRowData` /
  `pinnedBottomRowData` is non-empty. Updates on
  `setGridOption('pinnedTopRowData', …)` re-mount the subgrid.
- `cgrid/src/types.ts` — public option types.
- `cgrid/tests/pinnedRows.test.ts` (new) — 10 cases: top mount /
  bottom mount / N rows / cell renderer fallback to default /
  per-cell renderer override / runtime update via setGridOption /
  empty array = no mount / null = no mount / interaction with
  totals subgrid (both can coexist) / variable row heights.
- `apps/cgrid-positions/e2e-visual/18-pinned-top-row.spec.ts`
  (new) — seeds 50 rows + 1 pinned-top row, snapshots
  `18-pinned-top-row.png`.

**Steps:**

1. **DESIGN PASS.** Invoke `/frontend-design` with brief:
   *"Design the pinned-row chrome for canvasgrid. Pinned rows
   sit at the top or bottom of the body; they hold arbitrary
   static data (commonly headers/labels or important rows the
   user wants always visible). Decide: do they share the
   totals-row treatment? do they have their own divider colour?
   how does multi-pinned (3 rows pinned at top) read? Reference
   the Task 1 design notes and the totals-row decisions."*
   Append to the notes file.
2. Implement `PinnedRowsSubgrid`.
3. Wire option resolution + setGridOption updates.
4. Build the 10-case test suite.
5. Build visual cell 18.
6. Visual review. If the pinned row reads as "just another data
   row" — no visual lift — **GO BACK TO STEP 1**.

**Acceptance:**
- Pinned rows mount at top / bottom per option.
- Updates via setGridOption re-mount cleanly.
- Visual cell 18 baselined.

**Commit:** `feat(cgrid): pinnedTopRowData + pinnedBottomRowData (arbitrary static pinned rows)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md` and execute Task 3."

---

## Task 3 — Custom aggFunc registry (main + worker)

**Read first:**
- This worklog's Architecture — function-serialisation rules.
- `docs/catalog/10-aggregation.md` — `aggFuncs` option + per-column
  `aggFunc` field.
- `cgrid/src/interaction/statusBar/aggMath.ts` — built-in agg
  functions (Cycle 13 / Task 3). **DO NOT RE-IMPLEMENT** these on
  the worker — promote `aggMath` to a shared module instead.
- `cgrid/src/worker/protocol.ts` — message-passing shape; the new
  `setAggFuncs` message lands here.

**Files:**
- `cgrid/src/worker/aggFuncRegistry.ts` (new) — registry that holds
  named functions on the worker side. Built-ins pre-registered;
  custom funcs arrive via `setAggFuncs` message.
- `cgrid/src/worker/passes/aggPass.ts` — resolve column's `aggFunc`
  string → registry function → apply to values.
- `cgrid/src/worker/client.ts` — `setAggFuncs(funcs)` method that
  serialises function bodies and dispatches the message.
- `cgrid/src/cgrid.ts` — on `options.aggFuncs` change (init +
  setGridOption), call `workerClient.setAggFuncs`.
- `cgrid/src/types.ts` — `AggFunc` type signature.
- `cgrid/src/interaction/statusBar/aggMath.ts` — promote to a shared
  module so both the worker and the status panel import it. Or
  duplicate with a `// @generated` header keeping the main version
  canonical. Document which choice in the commit.
- `cgrid/tests/aggFuncRegistry.test.ts` (new) — 16 cases: built-in
  functions / register custom / overwrite built-in / serialise +
  deserialise round-trip / setGridOption replaces / column without
  aggFunc returns undefined / array-form aggFunc `['sum', 'avg']` /
  closure captures don't break serialisation (specific test for
  the failure mode).

**Steps:**

1. Promote / share `aggMath.ts` per the architecture note.
   Decide path (shared module vs `@generated` duplicate) and
   document in the commit body.
2. Implement `aggFuncRegistry.ts`.
3. Wire the `setAggFuncs` protocol message.
4. Wire option resolution in `cgrid.ts`.
5. Build the 16-case test suite. The closure-capture case is the
   sharp edge: assert that a custom aggFunc that references an
   outer variable produces a clear error (not silent wrong values).

**Acceptance:**
- `aggFuncs` option flows to the worker.
- Custom aggFuncs compute correctly.
- Closure-captured aggFuncs fail fast with a clear message.
- All tests pass.

**Commit:** `feat(cgrid): custom aggFunc registry (main → worker via setAggFuncs)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md` and execute Task 4."

---

## Task 4 — `suppressAggFuncInHeader` toggle

**Read first:**
- This worklog's Architecture.
- **`docs/catalog/screenshots/10-aggregation-aggfunc-in-header-real.png`**
  — pin open. Header reads `sum(Notional)` when the toggle is OFF
  (default), `Notional` when ON.
- Task 1 design notes — header text vocabulary should match the
  totals row's font weight.
- `cgrid/src/renderer/painters/byRows.ts` — header cell text
  resolution path. Add an `aggFunc` decorator that wraps the
  header text per column.

**Files:**
- `cgrid/src/renderer/painters/byRows.ts` — header text path
  consults the new `suppressAggFuncInHeader` flag (per-column
  default → per-grid). If false, render `${aggFuncName}(${header})`.
- `cgrid/src/cgrid.ts` — option resolution + per-column override.
- `cgrid/src/types.ts` — `CGridOptions.suppressAggFuncInHeader` +
  `CColDef.suppressAggFuncInHeader`.
- `cgrid/tests/suppressAggFuncInHeader.test.ts` (new) — 6 cases:
  default off (header shows agg) / global on / per-column override
  on / per-column override off (overrides global on) / column
  without aggFunc unaffected / setGridOption flip re-paints.
- `apps/cgrid-positions/e2e-visual/19-aggfunc-in-header.spec.ts`
  (new) — TWO snapshots: `19-aggfunc-in-header-on.png` (toggle
  off, headers show `sum(...)`) and `19-aggfunc-in-header-off.png`
  (toggle on, headers show raw names).

**Steps:**

1. **DESIGN PASS.** Brief: *"Decide the typographic treatment for
   the aggFunc prefix in column headers (e.g., `sum(Notional)`).
   Should the `sum(` part be in a lighter weight than the column
   name? Different colour? Same casing as the column? Reference
   the screenshot."* Append decisions to the notes file.
2. Implement the header text decorator in `byRows.ts`.
3. Wire option resolution.
4. Build the 6-case test suite.
5. Build the visual cells (two snapshots).
6. Visual review.

**Acceptance:**
- Header shows `sum(Notional)` by default when column has aggFunc.
- Toggle hides the prefix; per-column override works both ways.
- Visual cells 19-on + 19-off baselined.

**Commit:** `feat(cgrid): suppressAggFuncInHeader toggle (per-grid + per-column)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md` and execute Task 5."

---

## Task 5 — `'totals'` cell renderer + visual polish

**Read first:**
- This worklog's Architecture.
- Task 1 + 2 + 4 design notes — `cycle-14-aggregation-design.md`
  is the canon for the renderer.
- **`docs/catalog/screenshots/10-aggregation-aggfunc-in-header-real.png`**
  — pin open. The bottom "Total" row's cells: heavier numeric
  weight, value right-aligned (matches the column's data
  alignment), subtle top border crosses the full row, bg unchanged
  from the body.
- `cgrid/src/renderer/cellRenderers/registry.ts` — existing
  built-in renderers. `'totals'` registers here.

**Files:**
- `cgrid/src/renderer/cellRenderers/totals.ts` (new) — paint
  function: top border, slightly heavier font weight, value
  formatted via column's `valueFormatter`, fallback to a styled
  "—" for empty totals.
- `cgrid/src/renderer/cellRenderers/registry.ts` — register
  `'totals'` under that key.
- `cgrid/src/theming/tokens.css` — `.cg-totals-cell`,
  `.cg-totals-row` polish per the design plan.
- `cgrid/src/core/subgrid.ts` — `TotalsSubgrid` cells default
  `cellRenderer: 'totals'` unless the column overrides.
- `cgrid/tests/totalsRenderer.test.ts` (new) — 8 cases: paint
  width / height / top-border colour / value formatting via
  column formatter / empty totals "—" / null totals "—" / custom
  per-column renderer override / interaction with cellClass.
- `apps/cgrid-positions/e2e-visual/17-totals-row-bottom.spec.ts`
  + `18-pinned-top-row.spec.ts` — **re-baseline** against the
  polished renderer. PR title gets `[visual-baseline-update]`
  since cells already existed.

**Steps:**

1. **DESIGN PASS.** Brief: *"Finalise the totals cell renderer.
   Building on the Task 1 chrome (subtle top border, heavier
   weight), decide: exact font-weight delta (450 vs 500 vs 600
   on the body's regular), number alignment (right-aligned for
   numerics, left for text — same as data cells?), null/empty
   placeholder, hover state (none — totals row isn't
   interactive), behaviour when the totals cell value is wider
   than the column."* Append.
2. Implement the paint function.
3. Register under `'totals'`.
4. Default `TotalsSubgrid` cells to this renderer.
5. Build the 8-case test suite.
6. Re-baseline cells 17 + 18 with the polished renderer. Visually
   confirm the body↔totals transition reads as deliberate (not a
   harsh switch).

**Acceptance:**
- `'totals'` renderer paints per the design plan.
- Cells 17 + 18 re-baselined and look intentional.
- All tests pass.

**Commit:** `feat(cgrid): 'totals' built-in cell renderer + visual polish [visual-baseline-update]`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md` and execute Task 6."

---

## Task 6 — `aggregationChanged` event polish

**Read first:**
- This worklog's Architecture.
- `docs/catalog/10-aggregation.md` — `aggregationChanged` event
  spec.
- `cgrid/src/cgrid.ts` — search for `aggregationChanged` — the
  event already fires (from earlier cycles); this task expands
  the payload.

**Files:**
- `cgrid/src/cgrid.ts` — event emission point now includes
  `{ totals: chunk.totals, source: 'rowDataChanged' | 'aggFuncChanged' | 'filterChanged' | 'columnAggFuncChanged' | 'api' }`.
- `cgrid/src/types.ts` — `AggregationChangedEvent` type.
- `cgrid/tests/aggregationEvent.test.ts` (new) — 5 cases: payload
  shape / source tag / fires on rowDataUpdated / fires on
  filterChanged / does NOT fire on cosmetic re-renders (sort,
  scroll, theme).

**Steps:**

1. Expand the payload at the emission point.
2. Tag the source per call site.
3. Build the 5-case test suite.

**Acceptance:**
- `aggregationChanged` carries `totals + source`.
- Cosmetic re-renders don't fire.
- All tests pass.

**Commit:** `feat(cgrid): aggregationChanged event payload polish (+ source tagging)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md` and execute Task 7."

---

## Task 7 — Cycle 14 exit ritual

**Read first:**
- This worklog (every prior task).
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md`
  Task 6 — exit-ritual template.
- `docs/catalog/FEATURE_MATRIX.md` — Area 10 rows to flip.

**Files:**
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-14-aggregation-ui.md`
  — add the "## Shipped" block listing the 7 PRs + commit SHAs +
  which matrix cell each new visual covers.
- `apps/cgrid-positions/src/main.ts` + `positionsGrid.ts` — enable
  the totals row by default in the demo (bottom-pinned, showing
  sum / avg on P&L columns). Re-baseline visual cells 01–16 + 17
  + 18 + 19 against the new demo default.
- `docs/catalog/FEATURE_MATRIX.md` — flip Area 10 rows to ✅ (24
  of 26; the remaining 2 are group-footer-specific, deferred to
  Cycle 15).
- `README.md` — update screenshot to show the new totals row.

**Steps:**

1. Verify every Task 1–6 PR is merged on `main`.
2. Wire the demo to mount totals row by default.
3. Re-baseline affected visual cells.
4. Run full local check.
5. Flip FM Area 10 rows.
6. Write the "## Shipped" block.

**Acceptance:**
- All 7 Cycle 14 PRs merged.
- Three test suites green locally.
- FM Area 10 = 24/26 ✅ (group-footer rows deferred to Cycle 15).
- Demo loads with a visible, professional-looking totals row.

**Commit:** `docs(cycle-14): exit ritual — Shipped log + FM Area 10 flips + demo wires totals row default`

**Next session prompt:** "Cycle 14 complete — STOP. Do NOT proceed to Cycle 15."

---

## Anti-regression checklist (applies to EVERY task in this cycle)

Tick each item before pressing `git commit`. If any item is unticked,
**fix the cause before committing** — the cost of a patch PR after
review is 10× the cost of catching it now.

- [ ] **Design pass run via `/frontend-design`** (UI tasks only).
      Plan recorded in `docs/superpowers/plans/notes/cycle-14-aggregation-design.md`.
      Commit message cites the file.
- [ ] **Reference screenshot opened side-by-side** with the rendered
      output. If no screenshot exists for the sub-surface, the
      ag-grid website page is open instead (per
      `consult-ui-screenshots-before-shipping` memory).
- [ ] **Visual matrix cell added** (UI tasks only). Baseline PNG
      committed. Spec docstring names the regression it catches.
      PR title carries `[visual-baseline-new]` (or
      `[visual-baseline-update]` if re-baselining).
- [ ] **Unit tests pass** locally: `npx vitest run` clean.
- [ ] **TypeScript clean**: `npx tsc --noEmit -p cgrid` zero errors.
- [ ] **Visual matrix passes** locally: `cd apps/cgrid-positions
      && npm run test:visual` clean.
- [ ] **No extra worker round-trips per scroll.** The totals row
      reads from `chunk.totals` already computed by the existing
      data pass; do not call `workerClient.send` from the totals
      paint path. Verify with `npx vitest run statusBarPerf` (still
      green — agg payload doesn't add work).
- [ ] **`aggMath` is the single source of truth** for sum / avg /
      min / max / count. If you wrote those functions a second time
      somewhere, delete and import the shared module.
- [ ] **Body-band clip respected** for any new DOM overlay (none
      expected this cycle — totals row is canvas-painted).
- [ ] **No `any` in new code.** Use the public types
      (`AggFunc`, `TotalsSubgrid`, …).
- [ ] **`docs/superpowers/plans/notes/cycle-14-aggregation-design.md`
      updated** with any design decisions made during the task so
      Task N+1 inherits the vocabulary.

---

## Shipped

**`TotalsSubgrid` + `chunk.totals` plumbing.** A new non-scrolling
`Subgrid` impl (`cgrid/src/core/subgrid.ts`) reads `chunk.totals[colId]`
from the already-emitted worker viewport reply — zero extra worker
round-trips per scroll. Mounts at the top or bottom of the body via
`CGridOptions.totalsRowPosition: 'top' | 'bottom' | null`. The worker
`dataPipeline.ts` carries a `totals: Record<colId, unknown>` map on every
chunk; columns without an `aggFunc` emit no entry and the renderer
paints the cell blank. The viewport math (`core/viewport.ts`) was
refactored to stack subgrids relative to data so a future footer / group
subgrid drops in without re-deriving body geometry. The
`--cg-totals-*` CSS tokens (light + dark, design-passed for "lift" via
3% tint + 1px hairline + +1 weight stop) thread through `cssReader.ts`
into the paint path. `byRows.ts` row-bg pass paints the slate tint for
`isTotals` rows; `propertyChain.applyCellProps` bumps the font weight
on the totals cells; `gridLinesPainter.ts` draws the 1px structural
border. Visual cell 17 (`17-totals-row-bottom.png`) baselines the
bottom-pinned totals row so a chrome regression diffs at merge. Design
notes in
`docs/superpowers/plans/notes/cycle-14-aggregation-design.md` § Task 1.

**`pinnedTopRowData` + `pinnedBottomRowData`.** A second `Subgrid`
impl (`PinnedRowsSubgrid`) handles arbitrary static rows the app owns
on the main thread. Multiple rows per array; runtime updates via
`setGridOption('pinnedTopRowData', …)` / `'pinnedBottomRowData'`
re-mount the subgrid in place. The pinned chrome uses a WARM 3% / 5%
tint (deliberately opposite the totals row's slate) with body weight
— the design pass explicitly rejects "reuse totals verbatim" because
pinned rows are reference rows (anchored data, not synthesis). The
body↔pinned↔totals stack reads coherently: pinned rows hug the data,
the totals row sits outermost, both share the same 1px structural
border colour (`--cg-totals-border-top`) so the boundary between
scrolling data and everything else is one shape. Visual cell 18
(`18-pinned-top-row.png`) baselines the pinned-top variant. Design
notes § Task 2.

**Custom `aggFunc` registry (main → worker via `setAggFuncs`).** Apps
declare custom column aggregations on `CGridOptions.aggFuncs:
Record<string, IAggFunc>`. Built-ins (`sum / avg / min / max / count /
first / last`) are pre-registered on the worker; custom functions
serialise via `Function.prototype.toString()` and reconstruct through
`new Function(...)` (same channel as Cycle 8's `ComparatorRegistry`).
The main thread runs the rebuild + a probe call locally BEFORE
shipping, so closures over outer scope fail fast with a clear error
pointing the app at the constraint — the worker never sees a
deserialised function that would fail mid-pass. Built-in math
(`sum / avg / min / max / count`) delegates through
`interaction/statusBar/aggMath.ts` — the SINGLE source of truth shared
with the status panel's `agAggregationComponent` (Cycle 13 / Task 3),
so the totals row and the agg panel can never silently diverge on (e.g.)
NaN / Infinity handling. Array-form `aggFunc: ['p99', 'avg']` is an
ordered fallback; unknown names produce an empty totals entry, not a
crash. Runtime swap via `setGridOption('aggFuncs', { … })` reships the
custom layer to the worker and fires `aggregationChanged` tagged
`aggFuncChanged`.

**`suppressAggFuncInHeader` toggle (per-grid + per-column).** Header
text for a column with an `aggFunc` decorates as `sum(Notional)` /
`avg(Price)` by default; flipping the option (grid-level or
`CColDef.suppressAggFuncInHeader`) collapses the prefix back to the
raw `headerName`. The decoration is the smallest possible change to
the header-text path in `byRows.ts` — same weight, same color,
lowercase verb, no spaces, parens — relying on the function-call
signature (parens) to carry the structural cue without crowding the
600-weight header band. Array-form `aggFunc` uses the first entry as
the visible prefix. Per-column override wins over grid-level
(`undefined` defers to the grid). Visual cells 19-on /
`19-aggfunc-in-header-on.png` and 19-off / `19-aggfunc-in-header-off.png`
baseline both states. Design notes § Task 4.

**`'totals'` cell renderer (leaf polish).** The polished leaf for
`TotalsSubgrid` cells: column-halign always (right for numerics, left
for text, center where the column declares it), 6px padding (identical
to `numberCell` / `textCell`), em-dash `—` in the muted fg
(`--cg-totals-fg-muted`) for empty / null / NaN totals, no hover, no
focus, cell-clip on overflow. Default for cells in the totals subgrid
unless the column overrides `cellRenderer`. The +1 weight stop and
slate tint and 1px top border are STILL upstream (Task 1's
`applyCellProps` + `gridLinesPainter` + row-bg pass) — the renderer
adds the value layer only. The `emptyFg` field on `CellPaintConfig` is
the established pattern for "renderer-specific theme color threaded
through the shared config"; future renderers (footer in Cycle 15)
follow the same shape. Visual cells 17 + 18 re-baselined against the
polished renderer in this task. Design notes § Task 5.

**`aggregationChanged` event payload polish (+ source tagging).**
The event fires on every recomputation (rowDataChanged, filterChanged,
aggFuncChanged, columnAggFuncChanged, pinnedRowDataChanged, api),
carrying `{ type: 'aggregationChanged', totals: Record<colId,
unknown>, source: AggregationChangedSource }`. Cosmetic re-renders
(sort, scroll, theme flip) don't fire the event — the emission point
is gated on actual chunk.totals delta vs the prior snapshot. The
`source` tag lets apps disambiguate "user changed the agg func" from
"filter changed". Five Vitest cases pin the payload shape, source
discriminator, and the cosmetic-no-fire contract.

**Demo default-on + visual matrix re-baseline.** The demo
(`apps/cgrid-positions/src/main.ts` + `positionsGrid.ts`) now mounts
the totals row at the BOTTOM by default — every visual matrix cell
01–16 picks up the row at the body bottom edge. The `?totals=bottom`
opt-in remains for cell 17's explicit-state baseline; `?totals=top`
flips to top-pinned; `?totals=off` opts OUT of the row for callers
that need the prior body-only layout. Pinned rows still ride
`?pinned=top|bottom|both` (cell 18 + smoke). The aggFunc-in-header
decoration is on by default (the canonical `sum(Notional)` reading);
`?suppressAggHeader=1` flips it off for cell 19's second snapshot.
18 baselines re-baked in this PR (cells 01–16, 18, 19-off) — the
visible diff in each is "header columns now read `sum(...)` /
`avg(...)`, bottom of body now shows the totals row" with no other
change. Cells 17 and 19-on already shipped with the polished render
in earlier task PRs so their bytes carry through unchanged.

**FM coverage.** Area 10 ships **16 of 26 rows** ✅ at cycle exit:
the `aggFunc` ColDef option + `initialAggFunc` (covered by the same
first-creation handling), the `aggFuncs` GridOptions registry,
`suppressAggFuncInHeader` (per-grid + per-column), the `addAggFuncs`
/ `clearAggFuncs` / `setColumnAggFunc` api surface via
`setGridOption('aggFuncs', …)` and `updateGridOptions({ columnDefs })`,
the `columnValueChanged`-equivalent `aggregationChanged` event with
`source` tagging, the `IAggFunc` signature, all seven built-ins (sum /
min / max / count / avg / first / last),
`alwaysAggregateAtRootLevel` (root-level is the only level until
Cycle 15 introduces groups), the `valueGetter` interaction
(`row[field]` resolution), and the `suppressAggFuncInHeader` display
behaviour. The 10 deferred rows split between:
- **Group / footer dependent (Cycle 15):** `IAggFuncParams.aggregatedChildren`
  (group nodes), `IAggFuncResult` for nested re-aggregation (nested
  groups), `Filter interaction (suppressAggFilteredOnly)` (group-aggregate
  filter interaction), `suppressAggFilteredOnly` (the same toggle as
  an option).
- **GUI value-tool-panel dependent (later cycle):** `defaultAggFunc`,
  `allowedAggFuncs`, `enableValue`, `functionsReadOnly`, `GUI
  aggregation controls` — these require a value-tool-panel UI that
  cgrid does not ship in Cycle 14.
- **Performance opt deferred:** `aggregateOnlyChangedColumns` — the
  current pipeline re-aggregates every column on chunk update; an
  incremental opt-in lands when a profile call shows it on the hot path.

**Test sweep (recorded against the Task 7 branch):**
- `npm run test:cgrid` (Vitest): 104 files, 1192 tests pass.
- `npm run typecheck` (workspaces, `tsc --noEmit`): zero errors.
- `npm run test:visual` (regression matrix): 21 specs (1 smoke + 13
  layout/overlay + 3 status-bar + 4 aggregation) pass.

---

## Cycle 14 status: COMPLETE

Closed on 2026-06-27.

- [x] Task 1 — `TotalsSubgrid` + `chunk.totals` plumbing
      (PR #58, `19de9ab`).
- [x] Task 2 — `pinnedTopRowData` + `pinnedBottomRowData`
      (PR #59, `bd15766`).
- [x] Task 3 — Custom aggFunc registry (main → worker via
      `setAggFuncs`) (PR #60, `821fd8f`).
- [x] Task 4 — `suppressAggFuncInHeader` toggle (per-grid + per-column)
      (PR #61, `4f1b830`).
- [x] Task 5 — `'totals'` cell renderer + visual polish
      (PR #62, `5405a37`).
- [x] Task 6 — `aggregationChanged` event payload polish (+ source
      tagging) (PR #63, `8a722d4`).
- [x] Task 7 — Cycle 14 exit ritual: worklog `## Shipped` block, demo
      default-on (totals row pinned bottom) + visual matrix re-baseline
      (cells 01–16, 18, 19-off), FM Area 10 (16/26 ✅) flips, demo
      README + cgrid README quickstart updates.

**FM coverage:** Area 10 = 16/26 ✅. The remaining 10 rows split
between group-footer-dependent (Cycle 15), GUI value-tool-panel
dependent (later cycle), and one perf-opt deferral
(`aggregateOnlyChangedColumns`). The shipped surface — totals row,
pinned rows, custom aggFunc registry, header decoration, event
payload — is gated by Vitest (functional + perf), Playwright
(functional E2E), and the visual matrix (chrome + values).
