# Canvasgrid Cycle 13 — Status bar — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Horizontal **status bar** that mounts below the grid body and
hosts one or more **status panels** in left / center / right zones.
Ship the five built-in panels (`agTotalRowCountComponent`,
`agFilteredRowCountComponent`, `agSelectedRowCountComponent`,
`agTotalAndFilteredRowCountComponent`, `agAggregationComponent`) +
the **registration API** for custom panels + the **API surface** to
retrieve live panel instances.

**FM coverage:** Area 18 — all 8 rows ✅ at cycle exit.

**Depends on:** Cycle 11 (side-bar shrink-canvas pattern reused),
Cycle 12 (`getVisibleCellBounds` helper + visual regression matrix
— this cycle adds new matrix cells).

**Architecture:**

- The status bar is a **DOM panel**, NOT canvas-painted. It mounts as a
  sibling of the canvas inside `CGrid.root`, pinned to the bottom edge.
  Opening the status bar triggers exactly **one** `cgridCanvas.resize()`
  so the canvas reflows + repaints; the worker is untouched.
- A **status panel** mirrors ag-grid's `IStatusPanelComp`:
  `init(params)` / `getGui(): HTMLElement` / `refresh()` / `destroy()`.
  Built-in panels register themselves at CGrid construction; apps
  register custom panels via `CGridOptions.components` (same registry
  shape as side-bar tool panels).
- Layout: three flex containers (left / center / right) inside the
  bar root. Panel `align` sorts each panel into one zone; multiple
  panels in the same zone stack horizontally in def order.
- **Performance gate:** status updates batch per rAF; do NOT trigger
  body-canvas repaints. The bar listens to `selectionChanged`,
  `filterChanged`, `rowDataUpdated`, `rangeSelectionChanged` and
  enqueues an `panel.refresh()` call deduped to one per frame.
- Aggregation values: the `agAggregationComponent` runs sum/min/max/
  avg/count over the currently-selected range OR row selection. For
  Cycle 13 the math runs on the main thread reading the same
  `chunk` the renderer reads (no worker round-trip); the
  perf gate is "≤ 500 selected cells in ≤ 1 ms". If a selection
  exceeds that, we ship a synchronous Cycle 13 fallback + open a
  follow-up issue for the worker offload (Cycle 14 / Aggregation UI
  has the worker pipeline already, so the offload is cheap then).

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E +
visual). No new runtime dependencies. Status bar uses plain DOM +
CSS Grid for layout. Built-in panels are pure HTML / no icon-font.

**References (READ FIRST when starting any task):**

- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` —
  master plan (Cycle 13 — Status bar, after the Cycle 12 renumber).
- `docs/catalog/18-status-bar.md` — surface spec: `StatusBar`,
  `StatusPanelDef`, `IAggregationStatusPanelParams`, API methods.
- **`docs/catalog/screenshots/18-status-bar-all-components.png`** —
  canonical layout: horizontal strip under the body, "Total Rows:
  3,000  Rows: 3,000" text on the right, no borders / separators
  between zones. Light theme reference.
- **`docs/catalog/screenshots/18-status-bar-aggregation-component.png`**
  — aggregation component appearance with multiple stats inline.
- **ag-grid website fallback** (per the
  `consult-ui-screenshots-before-shipping` memory): when a sub-surface
  isn't covered by a screenshot (hover state for a clickable count,
  the agAggregationComponent's dark-theme variant, the empty-selection
  state of the agg panel), consult
  `https://www.ag-grid.com/javascript-data-grid/status-bar/` and
  `https://www.ag-grid.com/javascript-data-grid/integrated-charts-status-bar/`.
- `docs/catalog/FEATURE_MATRIX.md` — Area 18 rows to flip at cycle
  exit.
- Current source:
  - `cgrid/src/cgrid.ts` — CGrid class; the mount point for the
    status-bar host + the new panel registry hook.
  - `cgrid/src/core/canvas.ts` — `CGridCanvas` owns the canvas
    `<canvas>` element + resize handling. The bottom-edge inset
    flows through the same `setHostBounds` channel as side-bar
    insets.
  - `cgrid/src/interaction/sideBar/host.ts` — DOM-panel mounting
    pattern + reservedSpace flow; status-bar mirror's this exactly,
    just on the bottom edge instead of the right.
  - `cgrid/src/interaction/toolPanels/registry.ts` — panel-registry
    pattern; status panels reuse the same registry shape.
  - `cgrid/src/theming/tokens.css` — every `.cg-*` selector lives
    here; status-bar / status-panel CSS lands here too.

**Global Constraints:**

- TypeScript strict — no `any` in new code.
- `npm test` (Vitest, currently 1070 tests, grows to 1090+ this cycle)
  stays green.
- `npm run test:e2e` (existing Playwright functional + the new
  Cycle 12 + Cycle 13 specs) stays green.
- `npm run test:visual` (Cycle 12 matrix + 2 new Cycle 13 cells
  added in Task 6) stays green.
- The status bar updates must NOT trigger body-canvas repaints
  (perf gate; verified with a Vitest test that spies on
  `cgridCanvas.requestRepaint` and counts calls under a
  selection-change burst).
- **EVERY UI TASK MUST INVOKE `/frontend-design` (or a more specific
  Skill) BEFORE writing CSS or DOM.** Cite the design plan in the
  task commit message and the PR body. Rationale: per the
  `ui-quality-bar` memory — the last three UI surfaces I shipped
  without the design discipline (Cycle 10 context menu, Cycle 11
  invisible active-tab indicator, Cycle 11 sidebar v1 industrial
  uppercase) all required patch PRs after the user flagged them.
  This is not optional polish; it's the gate.
- **EVERY UI TASK MUST ADD AT LEAST ONE VISUAL MATRIX CELL** under
  `apps/cgrid-positions/e2e-visual/` covering the new surface.
  Baselines committed in the same PR (PR title gets the
  `[visual-baseline-new]` marker so reviewers know to expect new
  PNGs). The cell maps explicitly to "what regression would this
  catch" in the spec's docstring.
- No new runtime dependencies in `cgrid/`.
- Each task ends with `git commit` + `gh pr create` + wait for CI;
  next session starts on `main` after the merge.

## Task overview

| # | Title | UI? | Files touched | New tests |
|---|-------|-----|---------------|-----------|
| 1 | Status-bar host (DOM scaffold + canvas resize + registry) | yes | `cgrid/src/interaction/statusBar/host.ts` (new), `cgrid/src/cgrid.ts`, `cgrid/src/theming/tokens.css`, `cgrid/src/types.ts` | `statusBarHost.test.ts` (15 cases) + visual cell `14-status-bar-mounted.png` |
| 2 | Built-in count panels (Total / Filtered / Selected / TotalAndFiltered) | yes | `cgrid/src/interaction/statusBar/panels/counts.ts` (new), `tokens.css` | `countPanels.test.ts` (12 cases) + visual cell `15-status-bar-count-panels.png` |
| 3 | `agAggregationComponent` | yes | `cgrid/src/interaction/statusBar/panels/aggregation.ts` (new), `tokens.css`, `cgrid/src/interaction/statusBar/aggMath.ts` (new pure-fn module) | `aggregationPanel.test.ts` (18 cases incl. perf assertion `≤ 1 ms over 500 cells`) + visual cell `16-status-bar-aggregation.png` |
| 4 | Custom panel API + `getStatusPanel(key)` | no | `cgrid/src/cgrid.ts`, `cgrid/src/interaction/statusBar/host.ts` | `customStatusPanel.test.ts` (8 cases) |
| 5 | Frame-batched refresh + perf gate | no | `cgrid/src/interaction/statusBar/host.ts`, `cgrid/src/cgrid.ts` | `statusBarPerf.test.ts` (4 cases asserting paint counter stays at 0 under selection bursts) |
| 6 | Cycle 13 exit ritual | yes (touches existing visual matrix cells) | worklog Shipped block, FM Area 18 flips, demo wires status bar via `?statusBar=1` | full suite green; FM 8 rows ✅ |

---

## Task 1 — Status-bar host (DOM scaffold + canvas resize + registry)

**Read first:**
- This worklog's Architecture + Global Constraints sections.
- **`docs/catalog/screenshots/18-status-bar-all-components.png`** —
  pin this open in a second monitor / window throughout the task.
- `docs/catalog/18-status-bar.md` — surface spec for `StatusBar`,
  `StatusPanelDef`, the registry shape.
- `cgrid/src/interaction/sideBar/host.ts` — the analogous DOM-panel
  + reservedSpace mount pattern from Cycle 11 / Task 2. The
  status bar IS this pattern, rotated 90° and pinned to the bottom
  edge.
- `cgrid/src/cgrid.ts` `reserveSideBarSpace` (around line 2670) —
  the existing edge-inset reservation flow. Add a new
  `reserveStatusBarSpace(height)` that subtracts from the canvas's
  bottom.
- Memory: `feedback_ui_quality_bar.md` — **invoke `/frontend-design`
  BEFORE writing CSS or DOM.** Non-negotiable for this task.

**Files:**
- `cgrid/src/interaction/statusBar/host.ts` (new) — `StatusBarHost`
  class mirroring `SideBarHost`. Holds the bar root, three zone
  containers (left/center/right), a registry of `StatusPanel`
  instances keyed by `panelDef.key`, lifecycle methods.
- `cgrid/src/interaction/statusBar/types.ts` (new) — `StatusPanel`
  interface (`init/getGui/refresh/destroy`), `StatusPanelDef`,
  `StatusBarDef`, `StatusPanelRegistry` types.
- `cgrid/src/cgrid.ts` — new `private statusBar: StatusBarHost | null`,
  mounted when `options.statusBar` resolves to a `StatusBarDef`. Add
  `reserveStatusBarSpace(height)` that calls
  `cgridCanvas.setHostBounds({ left, top, bottom })` — the canvas
  inset surface needs a new `bottom` field.
- `cgrid/src/core/canvas.ts` — extend `setHostBounds` to accept
  `bottom` and subtract from the drawable height.
- `cgrid/src/theming/tokens.css` — `.cg-status-bar`,
  `.cg-status-bar-zone`, `.cg-status-bar-zone--left/center/right`
  rules. Designed per the design-skill plan from step 1, not
  freehand.
- `cgrid/src/types.ts` — public `StatusBarDef`, `StatusPanelDef`,
  `IStatusPanel`, `IStatusPanelComp` exports.
- `cgrid/tests/statusBarHost.test.ts` (new) — 15 cases (mount in
  empty bar / mount with N panels / zone routing /
  refresh-on-event / destroy / set-visibility / position toggle to
  top edge / panel re-mount on def change).
- `apps/cgrid-positions/e2e-visual/14-status-bar-mounted.spec.ts`
  (new) — visual cell. Seeds 50 rows, configures the demo via
  `?statusBar=mounted` query flag, snapshots
  `14-status-bar-mounted.png`. Note: the bar is empty (no panels
  yet — those land in Tasks 2 + 3) so the snapshot proves the host
  chrome reads as a proper bottom strip, NOT a slapped-together
  div. **A snapshot that shows a transparent or unstyled bar fails
  the design discipline regardless of pixel-diff result.**

**Steps:**

1. **DESIGN PASS (MANDATORY).** Invoke `/frontend-design`
   (`Skill` tool, skill name `frontend-design`) with this brief:
   *"Design the status bar shell for canvasgrid — a horizontal
   strip under the body, dark + light themes, three zones (left /
   center / right). Reference: `docs/catalog/screenshots/18-status-bar-all-components.png`.
   Subject is a Bloomberg-grade data grid; users glance at row
   counts and aggregation values dozens of times an hour.
   Constraints: must read at a glance, not compete with the body
   for attention, height ~28 px, type sized to match the side-bar
   tab labels we already shipped. The 3 px focus-ring blue is
   reserved for keyboard focus rings only; do NOT use it as a
   decorative accent."* Record the returned palette / type /
   layout decisions in `docs/superpowers/plans/notes/cycle-13-statusbar-design.md`
   (new) and cite that file in the commit message.
2. Implement `StatusBarHost` mirroring `SideBarHost`'s shape: ctor
   takes `(root, ctx, def)`; appends DOM; calls
   `ctx.setReservedSpace('bottom', height)` on mount + visibility
   change + destroy.
3. Extend `CGridCanvas.setHostBounds` to accept and respect
   `bottom`. Drawable height = clientHeight - top - bottom.
4. Add `reserveStatusBarSpace(height)` to `cgrid.ts` next to
   `reserveSideBarSpace`. Wire the bar's `setReservedSpace`
   callback to it.
5. Build the 15-case unit test suite. Mirror
   `tests/sideBarHost.test.ts`'s shape.
6. Build the visual cell. Use the existing `_setup.ts` helpers;
   add a `seedStatusBar(page, def)` helper if useful for Tasks 2
   + 3 to share.
7. Run `cd cgrid && npx tsc --noEmit && npx vitest run`. All green.
8. Run `cd apps/cgrid-positions && npm run test:visual -- --update-snapshots`
   for cell 14 only. Visually review the PNG vs the reference. If
   the rendered shell looks "slapped together" — wrong padding,
   no internal grid, fights the panel tokens — **GO BACK TO
   STEP 1**. Do not commit a shell that the user would have to
   patch.

**Acceptance:**
- `StatusBarHost` exists, 15 unit tests pass.
- Canvas drawable area shrinks by the bar height on mount.
- Visual cell 14 baselined; the rendered shell looks intentional
  (deliberate spacing, type matches the side-bar vocabulary, dark
  + light themes both work).
- `docs/superpowers/plans/notes/cycle-13-statusbar-design.md` exists
  with the design-skill output.

**Commit:** `feat(cgrid): status bar host (DOM scaffold + canvas resize + registry)` — body MUST cite the design notes file.

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md` and execute Task 2."

---

## Task 2 — Built-in count panels

**Read first:**
- This worklog's Architecture + Global Constraints.
- Task 1's design notes (`docs/superpowers/plans/notes/cycle-13-statusbar-design.md`)
  — count panels inherit the typography + spacing language from
  the shell.
- **`docs/catalog/screenshots/18-status-bar-all-components.png`** —
  pin open. Count panels appear as `Total Rows: 3,000  Rows:
  3,000` on the right side.
- `docs/catalog/18-status-bar.md` — `agTotalRowCountComponent`,
  `agFilteredRowCountComponent`, `agSelectedRowCountComponent`,
  `agTotalAndFilteredRowCountComponent` definitions.

**Files:**
- `cgrid/src/interaction/statusBar/panels/counts.ts` (new) — four
  panel classes implementing `IStatusPanelComp`. Each one renders
  `<span>Label: <strong>value</strong></span>` per the design
  plan.
- `cgrid/src/interaction/statusBar/host.ts` — register the four
  built-ins by string key.
- `cgrid/src/theming/tokens.css` — `.cg-status-panel-count`,
  `.cg-status-panel-count-label`, `.cg-status-panel-count-value`
  rules. Designed per Task 1's design plan, not freehand.
- `cgrid/tests/countPanels.test.ts` (new) — 12 cases (each panel
  init + refresh after rowDataUpdated / selectionChanged /
  filterChanged + value formatting + i18n hook).
- `apps/cgrid-positions/e2e-visual/15-status-bar-count-panels.spec.ts`
  (new) — visual cell. Seeds 200 rows, configures all four count
  panels in the right zone, snapshots
  `15-status-bar-count-panels.png`.

**Steps:**

1. **DESIGN PASS.** Invoke `/frontend-design` with brief:
   *"Design the count-panel cells inside the canvasgrid status
   bar. Each panel renders one label-value pair (`Total Rows:
   3,000`). Inherits the type / spacing language from Task 1's
   shell design. Decide: label weight, value weight, separator
   character or whitespace between adjacent panels, hover state
   (none unless interactive). Reference:
   `docs/catalog/screenshots/18-status-bar-all-components.png`."*
   Append the decisions to `docs/superpowers/plans/notes/cycle-13-statusbar-design.md`.
2. Implement the four panel classes. Each one subscribes to its
   trigger event in `init()` (rowDataUpdated / selectionChanged /
   filterChanged) and calls its own `refresh()` (NOT the host's —
   the host's batched refresh wraps it in Task 5).
3. Register them in the host's built-in registry.
4. Build the 12-case test suite.
5. Build the visual cell. Verify the rendered chrome against the
   reference + the design plan BEFORE committing. If the panels
   look like raw text slapped together without intentional
   spacing — **GO BACK TO STEP 1**.

**Acceptance:**
- Four count panels exist and refresh on their respective events.
- Visual cell 15 baselined.
- All previous tests pass + 12 new.

**Commit:** `feat(cgrid): built-in count panels (Total / Filtered / Selected / TotalAndFiltered)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md` and execute Task 3."

---

## Task 3 — `agAggregationComponent`

**Read first:**
- This worklog's Architecture (perf gate: ≤ 500 cells in ≤ 1 ms).
- Task 1 + 2 design notes — agg panel inherits the type vocabulary.
- **`docs/catalog/screenshots/18-status-bar-aggregation-component.png`**
  — pin open. Multiple stats inline (`Count: 23  Sum: 1,234  Avg: 54  …`).
- `cgrid/src/interaction/selectionModel.ts` — read `ranges` +
  selected row IDs from here. The panel listens to
  `rangeSelectionChanged` + `selectionChanged`.
- `cgrid/src/worker/dataPipeline.ts` — Cycle 14 will add a worker
  agg path; for Cycle 13 the panel reads the main-side chunk via
  the same `cellData` channel the renderer uses.

**Files:**
- `cgrid/src/interaction/statusBar/aggMath.ts` (new) — pure-fn
  module: `aggregate(values: number[], funcs: AggFunc[]):
  Record<AggFunc, number>`. No DOM, no events; perf-test target.
- `cgrid/src/interaction/statusBar/panels/aggregation.ts` (new) —
  `AgAggregationPanel` class implementing `IStatusPanelComp`.
  Reads selected cell values, calls `aggregate()`, renders.
- `cgrid/src/types.ts` — `IAggregationStatusPanelParams` export.
- `cgrid/src/theming/tokens.css` — `.cg-status-panel-agg` rules.
- `cgrid/tests/aggregationPanel.test.ts` (new) — 18 cases:
  - aggMath: empty / one-value / count / sum / min / max / avg /
    NaN handling / mixed types
  - panel: init / refresh-on-range-change / refresh-on-row-change
    / param-restricted aggFuncs (`{ aggFuncs: ['sum'] }`) / custom
    valueFormatter / cleared selection shows "—" or hides
  - **perf**: `expect(time_to_aggregate_500_cells).toBeLessThan(1)`
    measured via `performance.now()` deltas in a tight loop.
- `apps/cgrid-positions/e2e-visual/16-status-bar-aggregation.spec.ts`
  (new) — visual cell. Seeds 50 rows, adds a 10-row range across 2
  numeric columns, snapshots `16-status-bar-aggregation.png` with
  the panel showing the computed stats.

**Steps:**

1. **DESIGN PASS.** Invoke `/frontend-design` with brief:
   *"Design the aggregation status panel cell — shows up to 5
   stats inline (Count / Sum / Min / Max / Avg). Decide separator
   between stats, label-to-value ratio, how to handle truncation
   on a narrow viewport. Reference:
   `docs/catalog/screenshots/18-status-bar-aggregation-component.png`.
   Must be readable when 5 stats are crammed into ~400 px."*
   Append decisions to the notes file.
2. Implement `aggMath.ts` first — pure functions, easiest to test.
   Achieve the perf target before moving on.
3. Implement `AgAggregationPanel`. The panel reads the active
   range from `params.api.getCellRanges()` and resolves cell
   values via the existing `chunk` accessor (NOT a worker call).
4. Build the 18-case test suite. Include the perf test.
5. Visual cell 16 — show the panel with a sensible 10-row range
   so all 5 stats are visible.

**Acceptance:**
- `aggMath.aggregate(values, funcs)` returns correct stats for all
  18 test cases.
- Perf test passes (≤ 1 ms for 500 values).
- Panel refreshes on range / row-selection changes.
- Visual cell 16 baselined; the agg panel reads as a deliberate
  composition, not "labels and numbers separated by spaces".

**Commit:** `feat(cgrid): agAggregationComponent (count/sum/min/max/avg with ≤1ms perf gate)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md` and execute Task 4."

---

## Task 4 — Custom panel API + `getStatusPanel(key)`

**Read first:**
- This worklog's Architecture.
- Cycle 11 / Task 5 (`refreshToolPanel` + `getToolPanelInstance`) —
  the analogous custom-panel + lookup pattern for the side bar.
  This task mirrors it for the status bar.
- `cgrid/src/interaction/toolPanels/registry.ts` — registry shape.

**Files:**
- `cgrid/src/cgrid.ts` — add `getStatusPanel<T>(key: string): T | undefined`
  to the public API surface.
- `cgrid/src/interaction/statusBar/host.ts` — extend the registry
  to accept custom components via `CGridOptions.components` (same
  channel side-bar tool panels use).
- `cgrid/src/types.ts` — `IStatusPanel` + `IStatusPanelComp` exports.
- `cgrid/tests/customStatusPanel.test.ts` (new) — 8 cases (register
  custom panel / init called with params / getStatusPanel returns
  live instance / refresh propagates / destroy / unknown key
  returns undefined / multiple custom panels in one zone /
  custom + built-in mixed).
- `apps/cgrid-positions/src/positionsGrid.ts` — wire a demo custom
  panel under `?statusBar=customDemo` so the matrix cells can
  exercise this path.

**Steps:**

1. Implement `getStatusPanel<T>(key)` on `CGridApi`. Returns the
   live instance or `undefined`.
2. Extend `StatusBarHost.registry` to consult `options.components`
   for unknown string keys.
3. Build the 8-case test suite.
4. Wire the demo custom panel.
5. No new visual cell — the demo custom panel is exercised by the
   existing matrix cell 14 when configured with `?statusBar=customDemo`.
   (We could add cell 17 if the panel has a distinctive look — at
   author's discretion based on whether the demo panel does
   anything visual.)

**Acceptance:**
- `api.getStatusPanel('myPanel')` returns the live instance.
- Custom panels register + mount via `components`.
- All 8 tests pass.

**Commit:** `feat(cgrid): custom status panel API + getStatusPanel(key)`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md` and execute Task 5."

---

## Task 5 — Frame-batched refresh + perf gate

**Read first:**
- This worklog's Architecture (perf gate: status bar updates must
  NOT trigger body-canvas repaints).
- `cgrid/src/cgrid.ts` `cgridCanvas.requestRepaint` — the body
  repaint trigger to spy on.
- Cycle 4 / Cell flash (`docs/superpowers/plans/2026-06-25-canvasgrid-cycle-04-cell-flash-patch.md`)
  — uses a similar rAF-batched refresh pattern; mirror its shape.

**Files:**
- `cgrid/src/interaction/statusBar/host.ts` — wrap the
  per-panel `refresh()` invocation in an rAF-batched dispatcher.
  Multiple events in the same frame collapse to one refresh call
  per panel.
- `cgrid/src/cgrid.ts` — ensure the status bar's event
  subscriptions DO NOT call `cgridCanvas.requestRepaint`. The
  status bar is a DOM panel; its state lives outside the canvas
  paint cycle.
- `cgrid/tests/statusBarPerf.test.ts` (new) — 4 cases:
  - Spy on `cgridCanvas.requestRepaint`; trigger 100
    `selectionChanged` events in a tight loop; assert spy was
    called 0 times.
  - Trigger 100 events in one frame; assert each panel's
    `refresh()` was called exactly once.
  - Trigger events across 5 separate rAF ticks; assert each
    panel's `refresh()` was called exactly 5 times.
  - A panel that throws in `refresh()` does NOT prevent other
    panels from refreshing (per-panel try/catch).

**Steps:**

1. Implement the rAF-batched dispatcher in `StatusBarHost`.
2. Audit the status-bar event wiring to confirm zero
   `requestRepaint` calls. Document the audit in the commit body.
3. Build the 4-case perf test suite.

**Acceptance:**
- Selection / filter / row-data bursts produce zero body-canvas
  repaints.
- Each panel refreshes ≤ once per frame regardless of event burst.
- A throwing panel doesn't break neighbours.

**Commit:** `feat(cgrid): rAF-batched status-bar refresh + zero-canvas-repaint perf gate`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md` and execute Task 6."

---

## Task 6 — Cycle 13 exit ritual

**Read first:**
- This worklog (every prior task).
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md`
  Task 6 — exit-ritual template.
- `docs/catalog/FEATURE_MATRIX.md` — Area 18 rows to flip.

**Files:**
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-13-status-bar.md`
  — add the "## Shipped" block listing the 6 PRs + commit SHAs +
  which matrix cell each new visual covers.
- `apps/cgrid-positions/src/main.ts` + `positionsGrid.ts` — enable
  the status bar by default in the demo (left = aggregation,
  right = TotalAndFiltered + Selected counts) so visual matrix
  cells 14–16 exercise the full surface.
- `docs/catalog/FEATURE_MATRIX.md` — flip all 8 Area 18 rows to ✅.
- `README.md` — update the screenshot in the README's "what
  cgrid looks like" section to show the new status bar.
- Visual matrix re-baseline: cells 01–13 may need updating
  because the demo now mounts the status bar by default. Run
  `npm run test:visual` to see which baselines diff; for each one,
  visually verify the diff is "now has a status bar at the
  bottom" + nothing else, then re-baseline with
  `--update-snapshots`. PR title gets `[visual-baseline-update]`.

**Steps:**

1. Verify every Task 1–5 PR is merged on `main`.
2. Wire the demo to mount the status bar by default.
3. Re-baseline visual cells 01–13 against the new demo default.
4. Run full local check: `npm test` (Vitest), `npm run test:e2e`
   (Playwright functional), `npm run test:visual` (matrix).
5. Flip FM Area 18 rows.
6. Write the "## Shipped" block.

**Acceptance:**
- All 6 Cycle 13 PRs merged.
- Three test suites green locally.
- FM Area 18 = 8/8 ✅.
- Demo loads with a visible, professional-looking status bar.

**Commit:** `docs(cycle-13): exit ritual — Shipped log + FM Area 18 flips + demo wires status bar default`

**Next session prompt:** "Cycle 13 complete — STOP. Do NOT proceed to Cycle 14."

---

## Anti-regression checklist (applies to EVERY task in this cycle)

Tick each item before pressing `git commit`. If any item is unticked,
**fix the cause before committing** — the cost of a patch PR after
review is 10× the cost of catching it now.

- [ ] **Design pass run via `/frontend-design`** (UI tasks only).
      Plan recorded in `docs/superpowers/plans/notes/cycle-13-statusbar-design.md`.
      Commit message cites the file.
- [ ] **Reference screenshot opened side-by-side** with the rendered
      output. If no screenshot exists for the sub-surface, the
      ag-grid website page is open instead (per
      `consult-ui-screenshots-before-shipping` memory).
- [ ] **Visual matrix cell added** (UI tasks only). Baseline PNG
      committed. Spec docstring names the regression it catches.
- [ ] **Unit tests pass** locally: `npx vitest run` clean.
- [ ] **TypeScript clean**: `npx tsc --noEmit -p cgrid` zero errors.
- [ ] **Visual matrix passes** locally: `cd apps/cgrid-positions
      && npm run test:visual` clean. If updated baselines, PR title
      has `[visual-baseline-update]`.
- [ ] **No `cgridCanvas.requestRepaint` call** added inside the
      status-bar code path. If you need a body-canvas repaint, you
      are doing something wrong — the status bar is DOM, the canvas
      is canvas, they don't talk.
- [ ] **Body-band clip respected** for any new DOM overlay or
      canvas paint. Use `getVisibleCellBounds` for cell-anchored
      DOM nodes. For bar-anchored chrome, the bar's own bottom
      inset handles the math.
- [ ] **No `any` in new code.** Use the public types
      (`StatusPanelDef`, `IStatusPanelComp`, …) — they're exported
      for a reason.
- [ ] **`docs/superpowers/plans/notes/cycle-13-statusbar-design.md`
      updated** with any design decisions made during the task
      (paddings, type weights, separator characters, etc.) so
      Task N+1 inherits the vocabulary.

---

## Shipped

(Filled in by Task 6 once every PR has merged.)
