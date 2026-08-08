# Canvasgrid Cycle 12 — Regression prevention (band-clip helper + visual regression suite) — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Make the layout regressions that cost us ~9 patches over
Cycles 10–11 (scrollbar gutter, editor floating over header, focus
ring leaking into pinned bands, floating-filter input bleeding into
CUSIP, etc.) *fail the merge gate* instead of reaching the user.
Ship two interlocking systems:

1. **`getVisibleCellBounds(rowIndex, colId)`** — a single primitive
   that returns `null` when a cell isn't fully inside its own band
   (center / pinned-left / pinned-right) AND inside `[bodyTop,
   bodyBottom]`. The four overlays we just patched independently
   (focus ring, range overlay, DOM editor, floating-filter input)
   all call this instead of each reimplementing the band math.
2. **Playwright visual-regression matrix** — ~12 canonical snapshots
   (fresh, scrolled-vertical, scrolled-horizontal, editor-on-center,
   editor-on-pinned, range-across-viewports, side-bar-open,
   side-bar-position-flipped, empty grid, dense grid, dark theme,
   light theme) diffed against committed baselines on every PR. A
   4-pixel drift on a focus ring or a stray DOM element in a pinned
   band fails CI before merge.

**Why now:** the last five fixes (`d06d703`, `82bd786`, `d302071`,
`01fb141`, `ef0a879`) each touched a different file with near-identical
band-or-body-region logic. The duplication is the root of the
regression class. Centralising it AND gating with pixel snapshots
removes both the "we forgot to clip" and "tests passed but it looks
broken" failure modes.

**FM coverage:** No FM rows flip in this cycle. This is infrastructure
work — every existing row stays where it is; future cycles flip rows
faster because the gate catches their regressions.

**Architecture:**

- **`getVisibleCellBounds`** lives on `VelocityGrid` as a sibling of the
  existing `getCellBoundsAt`. The new method returns `null` for any of:
  cell not in `visibleRows/Columns`, cell's vertical band exits
  `[bodyTop, bodyBottom]`, cell's horizontal extent exits its column's
  band (center → `[bodyLeft, bodyRight]`, pinned-left → `[0,
  bodyLeft]`, pinned-right → `[bodyRight, +∞)`). When non-null it
  returns the same `{x, y, w, h}` shape `getCellBoundsAt` does.
  `getCellBoundsAt` keeps its current looser semantics (returns
  bounds whenever the cell is in the viewport at all) — callers that
  need the looser shape (e.g. tests, programmatic scroll math) still
  get it.
- Four overlay sites refactor to the new helper:
  - `cgrid/src/renderer/painters/overlayPainter.ts` — focus ring
  - `cgrid/src/renderer/painters/rangeOverlayPainter.ts` — range fill
    + border + fill handle
  - `cgrid/src/velocityGrid.ts` `syncOpenEditorPosition` — DOM editor close
    rule
  - `cgrid/src/interaction/floatingFilterOverlay.ts` `repositionAll`
    — input hide rule
- **Playwright snapshot infrastructure** lives under
  `apps/cgrid-positions/e2e-visual/`. A single config file
  (`playwright-visual.config.ts`) pins:
  - browser: Chromium only (Firefox/WebKit can be added later)
  - viewport: 1440×900
  - device scale: 1 (no DPR variance in CI)
  - colour scheme: forced to `dark` for the dark-theme matrix, `light`
    for the light-theme matrix
  - font: bundled JetBrains Mono variable (no system-font drift)
  - tolerance: `maxDiffPixelRatio: 0.005` (0.5 %), `threshold: 0.2`
    (per-pixel ITU-R BT.601 distance)
- Baselines live in `apps/cgrid-positions/e2e-visual/__snapshots__/`
  and ship in git. Updating baselines requires `--update-snapshots`
  + an explicit reviewer ack in the PR description.
- The matrix runs in CI via a new `npm run test:visual` script that
  shells out to Playwright; locally it runs the same way.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E
+ visual). No new runtime dependencies in `cgrid/` — Playwright is a
dev-dependency only and already installed. The matrix uses the
existing demo app (`apps/cgrid-positions`) seeded with a fixed-shape
dataset injected via `window.__cgrid.setRowData(...)` so STOMP
absence doesn't matter.

**References (READ FIRST when starting any task):**

- This worklog (master plan for the cycle).
- Recent regression commits (the bugs this cycle prevents):
  - `ef0a879` phantom vertical scrollbar with 0 rows
  - `0d0ce17` editor follows its focused cell when the grid scrolls
  - `01fb141` clip focus ring + range overlay to scrollable body region
  - `d302071` commit + close the cell editor when its cell scrolls
    past the body band
  - `d06d703` focus ring + range overlay + editor stay inside the
    focused column's band
  - `82bd786` hide floating-filter inputs whose column scrolled into
    a foreign band
- `cgrid/src/velocityGrid.ts` `getCellBoundsAt` (line ~4582) — the looser
  primitive whose returned bounds the new helper will filter.
- `cgrid/src/core/viewport.ts` `ViewportState` — `bodyTop`,
  `bodyBottom`, `bodyLeft`, `bodyRight`, `visibleRows`,
  `visibleColumns` are the inputs to the band check.
- `apps/cgrid-positions/e2e/` — existing Playwright config + helpers
  the visual suite extends.
- Memory: `feedback_consult_ui_screenshots.md` — visual verification
  is a hard gate; this cycle automates that gate so the agent runner
  can self-check.
- Memory: `feedback_e2e_for_ui.md` — unit tests don't catch canvas
  regressions; this cycle adds the pixel-level gate that closes the
  remaining gap.

**Global Constraints:**

- TypeScript strict — no `any` in new code.
- `npm test` (Vitest, 1056+ tests) stays green.
- `npm run test:e2e` (existing Playwright spec) stays green.
- New `npm run test:visual` runs in ≤ 60 s on CI hardware.
- Visual baselines are PNGs, not committed-then-regenerated each PR;
  updates require `--update-snapshots` + a `[visual-baseline-update]`
  marker in the PR title so reviewers know to look.
- No new runtime dependencies in `cgrid/`.
- Each task ends with `git commit` + `gh pr create` + wait for CI;
  next session starts on `main` after the merge.

## Task overview

| # | Title | Files touched | Verification |
|---|-------|---------------|--------------|
| 1 | `getVisibleCellBounds` helper + unit tests | `cgrid/src/velocityGrid.ts`, `cgrid/tests/visibleCellBounds.test.ts` | 12 unit cases (all 4 bands × cell-in-band / cell-straddling-band / cell-fully-out) |
| 2 | Refactor focus ring + range overlay to use the helper | `cgrid/src/renderer/painters/overlayPainter.ts`, `rangeOverlayPainter.ts`, related tests | All existing painter tests pass; focus ring + range bounds delegated to helper |
| 3 | Refactor DOM editor + floating-filter overlay to use the helper | `cgrid/src/velocityGrid.ts` `syncOpenEditorPosition`, `cgrid/src/interaction/floatingFilterOverlay.ts` `repositionAll` | Existing editor + floating-filter tests pass; band logic removed from both files |
| 4 | Playwright visual-regression infrastructure | `apps/cgrid-positions/playwright-visual.config.ts`, `apps/cgrid-positions/e2e-visual/_setup.ts`, `package.json` script, `.gitattributes` (PNG = binary) | `npm run test:visual` runs an empty suite green |
| 5 | Visual regression matrix (12 canonical snapshots) | `apps/cgrid-positions/e2e-visual/*.spec.ts`, `apps/cgrid-positions/e2e-visual/__snapshots__/*.png` | All 12 snapshots baselined + diff-clean on a fresh CI run |
| 6 | Cycle 12 exit ritual | Worklog close-out, README mention of new `npm run test:visual`, no FM flips (this is infra) | All cycle 12 PRs merged; full suite passes |

---

## Task 1 — `getVisibleCellBounds` helper + unit tests

**Read first:**
- This worklog's "Architecture" + "Global Constraints" sections.
- `cgrid/src/velocityGrid.ts` lines 4579–4600 — existing `getCellBoundsAt`
  shape and JSDoc; the new helper mirrors the return type.
- `cgrid/src/core/viewport.ts` lines 28–58 — `ViewportState` fields
  the band check reads (`bodyTop`, `bodyBottom`, `bodyLeft`,
  `bodyRight`, `visibleRows`, `visibleColumns`).
- The five regression commits listed in this worklog's References
  block — each one's commit message names the exact band-leak
  condition the new helper must catch.

**Files:**
- `cgrid/src/velocityGrid.ts` — add `getVisibleCellBounds(rowIndex, colId)`
  immediately under `getCellBoundsAt`. Do NOT modify `getCellBoundsAt`.
- `cgrid/tests/visibleCellBounds.test.ts` — new file, 12 cases below.
- `cgrid/src/types.ts` — re-export `getVisibleCellBounds` type if
  callers need it via the public API surface (skip if not).

**Interface produced:**

```ts
/** Pixel bounds of the cell at (rowIndex, colId) ONLY when the cell
 *  is fully inside its column's band AND inside [bodyTop, bodyBottom].
 *  Returns null when:
 *    - the row or column isn't in the current viewport
 *    - the cell's vertical band exits [bodyTop, bodyBottom]
 *    - the cell's horizontal extent exits its column's band:
 *        center        → [bodyLeft, bodyRight]
 *        pinned-left   → [0, bodyLeft]
 *        pinned-right  → [bodyRight, +∞)
 *  Use this from any overlay that paints / mounts a DOM node at the
 *  cell's coordinates; the looser getCellBoundsAt is for callers
 *  that need bounds whenever the cell is in the viewport at all
 *  (programmatic scroll math, hit-test).
 */
getVisibleCellBounds(rowIndex: number, colId: string):
  { x: number; y: number; w: number; h: number } | null;
```

**Steps:**

1. Open `cgrid/src/velocityGrid.ts`. Find the existing `getCellBoundsAt`
   method (≈ line 4582). Add the new method directly below it,
   keeping the JSDoc shown above.
2. Implementation:
   ```ts
   getVisibleCellBounds(rowIndex: number, colId: string):
     { x: number; y: number; w: number; h: number } | null {
     const bounds = this.getCellBoundsAt(rowIndex, colId);
     if (!bounds) return null;
     const vs = this.viewport;
     if (bounds.y < vs.bodyTop || bounds.y + bounds.h > vs.bodyBottom) return null;
     const col = vs.visibleColumns.find((c) => c.colId === colId);
     const xL = col?.pinned === 'left' ? 0
       : col?.pinned === 'right' ? vs.bodyRight
       : vs.bodyLeft;
     const xR = col?.pinned === 'left' ? vs.bodyLeft
       : col?.pinned === 'right' ? Number.POSITIVE_INFINITY
       : vs.bodyRight;
     if (bounds.x < xL || bounds.x + bounds.w > xR) return null;
     return bounds;
   }
   ```
3. Write `cgrid/tests/visibleCellBounds.test.ts`. Use the existing
   `tests/cgridApi.integration.test.ts` (or similar) as a template
   for constructing a real `VelocityGrid` in happy-dom with a small dataset.
   The 12 cases:
   - **center column**: in viewport / cell fully in body band → returns bounds
   - **center column**: cell scrolled past `bodyLeft` (column straddles pinned-left edge) → returns null
   - **center column**: cell scrolled past `bodyRight` → returns null
   - **center column**: row scrolled above `bodyTop` (cell straddles header) → returns null
   - **center column**: row scrolled below `bodyBottom` → returns null
   - **pinned-left column**: cell fully visible → returns bounds
   - **pinned-left column**: row scrolled past `bodyTop` (header overlap) → returns null
   - **pinned-left column**: cell fully visible at any horizontal scroll → returns bounds
     (proves pinned column isn't false-rejected by the horizontal check)
   - **pinned-right column**: cell fully visible → returns bounds
   - **pinned-right column**: row scrolled past `bodyBottom` → returns null
   - **off-viewport row** (row index way past `lastRow`) → returns null
   - **unknown colId** → returns null
4. Run `npx vitest run tests/visibleCellBounds.test.ts` — all 12
   pass.
5. Run `npx tsc --noEmit -p cgrid` — clean.
6. Run `npx vitest run` (full suite) — 1056 + 12 = 1068 pass.

**Acceptance:**
- New file `cgrid/src/velocityGrid.ts` has `getVisibleCellBounds` directly
  under `getCellBoundsAt`, with the JSDoc above verbatim.
- `cgrid/tests/visibleCellBounds.test.ts` exists with 12 cases, all
  passing.
- Full Vitest suite green (1068 tests).
- TypeScript clean.

**Commit:** `feat(cgrid): getVisibleCellBounds helper — band-aware cell-bounds primitive for overlays`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md` and execute Task 2."

---

## Task 2 — Refactor focus ring + range overlay to use `getVisibleCellBounds`

**Read first:**
- This worklog's Task 1 (the helper now exists and is the source of
  truth for "is this cell paintable at this position").
- `cgrid/src/renderer/painters/overlayPainter.ts` (full file).
- `cgrid/src/renderer/painters/rangeOverlayPainter.ts` (full file).
- Commits `01fb141` and `d06d703` — the band-clip math currently
  inlined in both files.
- `cgrid/src/renderer/painters/types.ts` — `PainterCtx`. The helper
  call needs to be reachable from a painter; the cleanest path is to
  pass the cell-bounds *resolver* through `PainterCtx` rather than the
  whole `VelocityGrid` instance.

**Files:**
- `cgrid/src/renderer/painters/types.ts` — add to `PainterCtx`:
  ```ts
  /** Returns visible (band-clipped) bounds for the cell, or null when
   *  the cell straddles or has scrolled out of its column's band.
   *  Sourced from VelocityGrid.getVisibleCellBounds (Cycle 12 / Task 1). */
  getVisibleCellBounds: (rowIndex: number, colId: string) =>
    { x: number; y: number; w: number; h: number } | null;
  ```
- `cgrid/src/renderer/renderer.ts` — supply the new field on the
  `pctx` object built in `paint()`. Wire from `this.opts.cgrid` or
  add an `RendererOpts` field if cleaner.
- `cgrid/src/renderer/painters/overlayPainter.ts` — replace the
  inlined band-clip rect (the `xL`/`xR` block) with a single call:
  ```ts
  const bounds = p.getVisibleCellBounds(focusedRowIndex, focusedColId);
  if (!bounds) return;
  // ... existing stroke logic but using `bounds.x / .y / .w / .h`
  // instead of col.left / row.top / col.width / row.height
  ```
  Remove the `vs.bodyTop` early-return and the band `gc.save/clip/restore`
  pair — `getVisibleCellBounds` handles both.
- `cgrid/src/renderer/painters/rangeOverlayPainter.ts` — the
  per-range loop calls `getVisibleCellBounds` for the top-left AND
  bottom-right cells of each range; only paint the range when BOTH
  ends are visible (or compute the visible sub-rectangle from the
  two corners). Remove the `vs.bodyLeft / bodyRight` clip; the
  band-aware sub-rectangle replaces it.
- `cgrid/tests/overlayPainter.test.ts` (if it exists) and
  `cgrid/tests/rangeOverlayPainter.test.ts` — update the stub
  `PainterCtx` to include `getVisibleCellBounds`. For tests where the
  clipping is the assertion, stub the helper to return the expected
  rectangle directly so test setup stays terse.

**Steps:**

1. Add `getVisibleCellBounds` to `PainterCtx` in `types.ts`.
2. In `renderer.ts` `paint()`, supply the field. Source it from
   the same `opts` channel the other resolvers use (`opts.getSelection`,
   `opts.cellData`, …). If the renderer doesn't yet hold a VelocityGrid
   reference, accept the resolver function in `RendererOpts`:
   ```ts
   getVisibleCellBounds: (r: number, c: string) =>
     { x: number; y: number; w: number; h: number } | null;
   ```
   and wire it from `velocityGrid.ts` where `Renderer` is constructed.
3. Rewrite `overlayPainter.ts` per the Files section above.
4. Rewrite `rangeOverlayPainter.ts` per the Files section above. The
   per-range visibility check is:
   ```ts
   // Walk colIds in display order to find the leftmost + rightmost
   // visible columns in the range; same for rows. If either end is
   // not in the range AT ALL, skip the range. If only one end is
   // visible, clip to the visible portion (the helper already
   // band-bounded both ends).
   ```
   The fill-handle paint also moves to a `getVisibleCellBounds(bottomRow,
   rightCol)` call so the handle hides when the bottom-right cell
   scrolled out of its band.
5. Update the two test files to stub the new resolver. For the
   "range across viewports" case (commit `1a9870a` shipped this),
   add a positive assertion that the painter still emits exactly one
   fillRect per visible range slice.
6. Run `npx vitest run` — 1068+ tests pass.
7. Run `npx tsc --noEmit -p cgrid` — clean.

**Acceptance:**
- `overlayPainter.ts` has zero inlined band/body math. The whole
  rendering branch is "ask the resolver, paint or skip".
- `rangeOverlayPainter.ts` likewise — no direct `bodyLeft`/`bodyRight`
  reads.
- All existing painter tests pass with the stubbed resolver.
- Manual smoke in the demo (open editor on a center column, scroll
  horizontally) — focus ring no longer leaks into pinned bands.

**Commit:** `refactor(cgrid): focus ring + range overlay delegate band-clip to getVisibleCellBounds`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md` and execute Task 3."

---

## Task 3 — Refactor DOM editor + floating-filter overlay to use `getVisibleCellBounds`

**Read first:**
- This worklog's Task 1.
- `cgrid/src/velocityGrid.ts` `syncOpenEditorPosition` (search for the name;
  it's the rule that closes the editor when the cell exits its band).
- `cgrid/src/interaction/floatingFilterOverlay.ts` `repositionAll`.
- Commits `d302071`, `d06d703`, `82bd786` — the band-clip math
  currently inlined in both files.

**Files:**
- `cgrid/src/velocityGrid.ts` — rewrite `syncOpenEditorPosition`:
  ```ts
  private syncOpenEditorPosition(): void {
    if (!this.activeEdit) return;
    if (!this.editor.isOpen()) return;
    const { rowIndex, colId } = this.activeEdit;
    const bounds = this.getVisibleCellBounds(rowIndex, colId);
    if (!bounds) {
      this.editor.commit();
      return;
    }
    this.editor.reposition(bounds);
  }
  ```
  All the body-band + horizontal-band checks delete; the helper does
  them.
- `cgrid/src/interaction/floatingFilterOverlay.ts` — `repositionAll`
  takes a new `getVisibleCellBounds` arg (passed by the host that
  constructs the overlay), and replaces the inlined `inBand` check
  with:
  ```ts
  const bounds = getVisibleCellBounds(/* row */ 0, col.colId);
  if (!bounds) { entry.wrapper.style.display = 'none'; continue; }
  // ... position using `bounds` (the helper returns the same coords
  // the floating-filter row already uses).
  ```
  Note: the floating-filter row sits at a fixed `rowTop` (it's the
  header / floating-filter subgrid, not the data subgrid). The helper
  still works because the band check is column-based AND the helper's
  vertical check uses the cell's resolved top, not a hard-coded
  data-row position.
- `cgrid/src/velocityGrid.ts` (constructor that builds
  `FloatingFilterOverlay`) — pass `this.getVisibleCellBounds.bind(this)`
  as the new dep.
- `cgrid/tests/floatingFilterOverlay.test.ts` — update setup to stub
  the new dep.

**Steps:**

1. Rewrite `syncOpenEditorPosition` per the snippet above.
2. Add `getVisibleCellBounds` to `FloatingFilterOverlayDeps` (the
   options interface the constructor accepts).
3. In the floating-filter overlay, swap the inlined `inBand` block
   for a `getVisibleCellBounds` call. Note that floating-filter cells
   live on the floating-filter subgrid, NOT the data subgrid — the
   helper's row arg is `0` for that subgrid (or use a sentinel the
   helper recognises; cleanest: extend the helper signature to take
   an optional `{ subgrid: 'data' | 'floatingFilter' }`. If that
   feels heavy, keep the existing inline check for the floating-filter
   case AND document why in a comment — pragmatism wins over
   ideology). Pick one approach and own it in the commit message.
4. Update `velocityGrid.ts` constructor to inject the new dep.
5. Update tests.
6. Run `npx vitest run` — clean.
7. Smoke in the demo: open editor on center column, scroll horizontally
   → editor closes. Scroll horizontally with floating filter active
   → marketValue filter input hidden when its column slides into
   the pinned area.

**Acceptance:**
- `syncOpenEditorPosition` is the 7-line version above; no inlined
  band math.
- `floatingFilterOverlay.ts` `repositionAll` has no `bodyLeft`/
  `bodyRight` reads (or has them ONLY in the documented floating-
  filter-subgrid case).
- All tests pass.
- Manual smoke confirms no regression.

**Commit:** `refactor(cgrid): editor + floating-filter overlay delegate band-clip to getVisibleCellBounds`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md` and execute Task 4."

---

## Task 4 — Playwright visual-regression infrastructure

**Read first:**
- This worklog's "Architecture" section (visual snapshot rules).
- `apps/cgrid-positions/e2e/*.spec.ts` — existing Playwright setup.
- `apps/cgrid-positions/package.json` — existing npm scripts.
- `apps/cgrid-positions/playwright.config.ts` (if present) — existing
  config; the visual config inherits from this where sensible.
- Playwright docs on `toHaveScreenshot()` matcher (the API the
  matrix in Task 5 uses).

**Files:**
- `apps/cgrid-positions/playwright-visual.config.ts` — new file.
  Inherits `testDir: 'e2e-visual'`, `use: { browserName: 'chromium',
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  colorScheme: 'dark' }`, `expect: { toHaveScreenshot: {
  maxDiffPixelRatio: 0.005, threshold: 0.2, animations: 'disabled' } }`,
  `forbidOnly: !!process.env.CI`, `reporter: [['html'], ['list']]`.
- `apps/cgrid-positions/e2e-visual/_setup.ts` — exports a shared
  `seedGrid(page, rowCount)` helper that calls
  `window.__cgrid.setRowData([...])` with a deterministic dataset
  (fixed values; no Date.now, no random). Used by every spec in
  Task 5.
- `apps/cgrid-positions/e2e-visual/_smoke.spec.ts` — one spec that
  navigates the demo, waits for `__cgrid` to exist, and asserts
  `.toBe(true)`. Proves the harness works without any snapshots yet.
- `apps/cgrid-positions/package.json` — add script:
  `"test:visual": "playwright test --config=playwright-visual.config.ts"`.
- `.gitattributes` (project root) — ensure PNG snapshots are stored
  as binary. Add line: `*.png binary`.
- `apps/cgrid-positions/e2e-visual/__snapshots__/.gitkeep` — empty
  file so the directory exists in git before Task 5 generates
  baselines.
- README mention (`README.md` root, near existing test instructions):
  one paragraph on `npm run test:visual` + the
  `--update-snapshots` flag + the `[visual-baseline-update]` PR
  marker convention.

**Steps:**

1. Create `playwright-visual.config.ts` per the snippet above.
2. Create the `e2e-visual/` directory + `_setup.ts` + `_smoke.spec.ts`.
3. Add the npm script.
4. Add the `.gitattributes` line if not already present.
5. Run `cd apps/cgrid-positions && npm run test:visual` — the smoke
   spec passes; no baselines exist yet, no snapshot diff runs.
6. Verify the HTML report opens and shows the smoke result.

**Acceptance:**
- `npm run test:visual` from `apps/cgrid-positions/` runs to green
  in under 10 s.
- The HTML report renders.
- README has the new section.
- No actual snapshots committed yet (Task 5 generates them).

**Commit:** `chore(visual): Playwright visual-regression harness + smoke spec`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md` and execute Task 5."

---

## Task 5 — Visual regression matrix (12 canonical snapshots)

**Read first:**
- This worklog's Task 4 (the harness this task fills).
- `apps/cgrid-positions/e2e-visual/_setup.ts` (the `seedGrid` helper).
- The five regression commits in the worklog References block — each
  snapshot in the matrix below maps to at least one of them so the
  next time that bug is reintroduced, the diff catches it.
- `docs/catalog/screenshots/sidebar1.png`, `sidebar2.png`,
  `sidebar3.png` — visual conventions for the side bar matrix cells.

**Files:**
- `apps/cgrid-positions/e2e-visual/01-fresh-grid.spec.ts`
- `apps/cgrid-positions/e2e-visual/02-scrolled-vertical.spec.ts`
- `apps/cgrid-positions/e2e-visual/03-scrolled-horizontal.spec.ts`
- `apps/cgrid-positions/e2e-visual/04-editor-center-column.spec.ts`
- `apps/cgrid-positions/e2e-visual/05-editor-pinned-column.spec.ts`
- `apps/cgrid-positions/e2e-visual/06-range-across-viewports.spec.ts`
- `apps/cgrid-positions/e2e-visual/07-sidebar-columns-open.spec.ts`
- `apps/cgrid-positions/e2e-visual/08-sidebar-filters-open.spec.ts`
- `apps/cgrid-positions/e2e-visual/09-sidebar-position-left.spec.ts`
- `apps/cgrid-positions/e2e-visual/10-empty-grid.spec.ts`
- `apps/cgrid-positions/e2e-visual/11-dense-grid-light-theme.spec.ts`
- `apps/cgrid-positions/e2e-visual/12-context-menu-open.spec.ts`
- `apps/cgrid-positions/e2e-visual/__snapshots__/*.png` — generated by
  the first `npm run test:visual -- --update-snapshots` run, then
  committed.

**Steps:**

1. Write the 12 spec files. Each one:
   - Imports `seedGrid` from `_setup`.
   - Navigates to the demo URL.
   - Calls `seedGrid` with a deterministic dataset (e.g. 50 rows for
     "dense", 0 rows for "empty", 200 rows for "scrolled-vertical").
   - Drives the matrix-specific action (scroll / open editor / open
     side bar / right-click).
   - Calls `await expect(page).toHaveScreenshot('<name>.png');`.
2. Each spec maps to at least one regression it catches:
   - `02-scrolled-vertical` — catches `01fb141` (focus ring leaking
     over header) + `d302071` (editor floating over header).
   - `03-scrolled-horizontal` — catches `d06d703` (focus ring leaking
     into pinned band) + `82bd786` (floating filter bleeding into
     CUSIP).
   - `04-editor-center-column` — catches `0d0ce17` (editor not
     following cell) + `d302071`.
   - `05-editor-pinned-column` — catches the pinned-column edit
     variant of `d06d703`.
   - `06-range-across-viewports` — catches `1a9870a` (range drag
     across viewports) + `01fb141` (range overlay over header).
   - `07/08/09-sidebar-*` — catches `f424c48`, `5d9e458`, `d1eff31`,
     `a1055c5`, `4226dc3` (the side bar redesign saga).
   - `10-empty-grid` — catches `ef0a879` (phantom scrollbar with 0
     rows).
3. Run `cd apps/cgrid-positions && npm run test:visual -- --update-snapshots`.
   The first run generates all 12 PNGs into `__snapshots__/`.
4. Visually review each PNG. Reject any that show an actual bug;
   fix the bug, then re-baseline.
5. Run `npm run test:visual` (without `--update-snapshots`). All 12
   diff-clean.
6. Commit the spec files + the 12 baseline PNGs in the same commit.

**Acceptance:**
- 12 specs exist, each one drives a distinct state.
- 12 baseline PNGs committed to `__snapshots__/`.
- `npm run test:visual` runs to green in ≤ 60 s.
- Re-running `--update-snapshots` is a no-op (clean diff).
- A manual sabotage test (e.g. revert `82bd786` for a moment) fails
  the matching spec.

**Commit:** `test(visual): 12-snapshot regression matrix covering layout + overlay states`

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md` and execute Task 6."

---

## Task 6 — Cycle 12 exit ritual

**Read first:**
- This worklog (every prior task).
- `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-11-sidebar-and-tool-panels.md`
  Task 9 — exit-ritual template.

**Files:**
- `docs/superpowers/plans/2026-06-27-canvasgrid-cycle-12-regression-prevention.md`
  — add a "## Shipped" block at the bottom listing the 6 PRs +
  commit SHAs + which regression each visual matrix cell catches.
- `README.md` — under the test section, finalise the visual-regression
  paragraph (added in Task 4) with the actual `npm run test:visual`
  output snippet.
- `docs/catalog/FEATURE_MATRIX.md` — NO row flips. Add a footnote
  under the table: "Visual regressions in Areas 17 (side bar) +
  shared overlays are gated by `npm run test:visual` since Cycle 12."

**Steps:**

1. Verify every Task 1–5 PR is merged on `main`.
2. Run the full local check: `npm test` (Vitest 1068+), `npm run
   test:e2e` (Playwright functional), `npm run test:visual` (matrix).
   All green.
3. Write the "## Shipped" block per the template — one bullet per
   task with PR number + commit SHA + 1-line summary.
4. Update the README's visual-regression paragraph with real output.
5. Add the FEATURE_MATRIX footnote.

**Acceptance:**
- All 6 PRs merged.
- Three test suites green locally.
- Worklog has a "## Shipped" block.
- README + FEATURE_MATRIX updated.

**Commit:** `docs(cycle-12): exit ritual — shipped log + README + FM footnote`

**Next session prompt:** "Cycle 12 complete — STOP. Do NOT proceed to Cycle 13."

---

## Shipped

**`getVisibleCellBounds` helper.** A new public method on `VelocityGrid`
returns the cell's pixel bounds *only* when the cell is fully inside
both its column's band (center → `[bodyLeft, bodyRight]`, pinned-left
→ `[0, bodyLeft]`, pinned-right → `[bodyRight, +∞)`) AND the vertical
body region `[bodyTop, bodyBottom]`. Returns `null` otherwise — when
the row or column isn't in the viewport, the cell straddles the
header / footer edge, or the column scrolled into a foreign band. The
looser `getCellBoundsAt` keeps its semantics for callers that need
bounds whenever the cell is in the viewport at all (programmatic
scroll math, hit-test). The helper sits directly under
`getCellBoundsAt` in `cgrid/src/velocityGrid.ts` and is covered by 12 unit
cases (`cgrid/tests/visibleCellBounds.test.ts`) — all four bands ×
cell-in-band / cell-straddling-band / cell-fully-out — plus the
off-viewport-row and unknown-colId guards.

**Focus ring + range overlay refactor.** Both painters now delegate
the band-clip to `getVisibleCellBounds`. `overlayPainter.ts` (focus
ring) drops every inlined `bodyTop` / `bodyLeft` / `bodyRight` /
`bodyBottom` read and the `gc.save / gc.clip / gc.restore` band-clip
pair; the entire branch is "ask the resolver, paint or skip".
`rangeOverlayPainter.ts` walks each range's visible columns + rows and
slices the fill / border / fill-handle into per-band sub-rectangles via
`getVisibleCellBounds(topRow, leftCol)` and `(bottomRow, rightCol)` —
ranges that span the center + pinned bands paint two clean rectangles
instead of one rectangle that bleeds across the band gutter. The
resolver enters `PainterCtx` as a typed callback so painters never
hold a `VelocityGrid` reference. All existing painter tests pass with the
stubbed resolver; the regression that shipped fixes for in commits
`01fb141` (focus ring over header) + `d06d703` (focus ring leaking
into pinned band) is now structurally impossible because both sites
ask the same primitive that those commits taught.

**Editor + floating-filter overlay refactor.** `syncOpenEditorPosition`
in `velocityGrid.ts` collapses to a 7-line helper: ask
`getVisibleCellBounds(row, colId)`, `commit()` the editor on `null`,
`reposition(bounds)` otherwise. All the body-band + horizontal-band
inline checks delete. `floatingFilterOverlay.ts` `repositionAll` does
the same for each floating-filter cell — the input's wrapper hides
when its column slides into a foreign band, and re-appears (with
fresh top / left / width from the helper) when the column scrolls
back into its native band. The `FloatingFilterOverlayDeps` interface
takes `getVisibleCellBounds` as a constructor-injected dependency so
the overlay never holds a `VelocityGrid` reference. The shared regression
source from commits `d302071` (editor floating over header),
`d06d703` (editor leaking into pinned band), and `82bd786` (floating
filter bleeding into CUSIP) collapses to one call site each.

**Playwright visual-regression harness.** A pinned-Chromium,
fixed-1440×900-viewport, DPR-1, dark-theme Playwright config
(`apps/cgrid-positions/playwright-visual.config.ts`) gates pixel
regressions on every PR. Tolerance is `maxDiffPixelRatio: 0.005`
(0.5 % of pixels) and `threshold: 0.2` (per-pixel BT.601 distance) —
a 4-pixel drift on a focus ring or a stray DOM element in a pinned
band fails CI. Baselines live flat under
`apps/cgrid-positions/e2e-visual/__snapshots__/` (via
`snapshotPathTemplate`) so the `[visual-baseline-update]` PR marker
review-set stays small. PNGs ship as binary (`.gitattributes`
enforces `*.png binary`). A `_smoke.spec.ts` proves the harness
mounts the demo and exposes `window.__cgrid` before any baselines
exist; a shared `_setup.ts` `seedGrid(page, rowCount)` helper
injects a deterministic dataset so STOMP absence doesn't break the
matrix.

**Visual regression matrix (12 canonical snapshots).** The matrix
covers every layout / overlay regression the cycle prevents:

- `01-fresh-grid` — 50 rows, dark theme, no overlays. Baseline for
  the default render path.
- `02-scrolled-vertical` — body scrolled past the anchor row.
  Catches `01fb141` (focus ring leaking over header) + `d302071`
  (editor floating over header).
- `03-scrolled-horizontal` — center columns scrolled under the
  pinned-left band. Catches `d06d703` (focus ring leaking into
  pinned band) + `82bd786` (floating-filter input bleeding into
  CUSIP).
- `04-editor-center-column` — DOM editor open on a center column
  (`notionalAmount`). Catches `0d0ce17` (editor not following its
  cell on scroll) + `d302071`.
- `05-editor-pinned-column` — DOM editor open on pinned-left
  `cusip`. Catches the pinned-column edit variant of `d06d703`.
- `06-range-across-viewports` — range overlay spanning visible +
  non-visible rows. Catches `1a9870a` (range drag across viewports)
  + `01fb141` (range overlay over header).
- `07-sidebar-columns-open` — side bar on the right with the
  Columns panel mounted.
- `08-sidebar-filters-open` — side bar on the right with the
  Filters panel mounted.
- `09-sidebar-position-left` — side bar flipped to the left edge
  with the Columns panel mounted.
- `10-empty-grid` — 0-row grid. Catches `ef0a879` (phantom vertical
  scrollbar with 0 rows).
- `11-dense-grid-light-theme` — 200 rows on the Quartz light theme.
  Proves the matrix isn't dark-theme-coupled.
- `12-context-menu-open` — body-cell context menu mounted with
  the default registry + the demo's custom `Clear filters` entry.

The 7/8/9 side-bar trio also catches the side bar redesign saga
(`f424c48`, `5d9e458`, `d1eff31`, `a1055c5`, `4226dc3`,
`ea448b5`). Each `toHaveScreenshot('<name>.png')` diffs against a
committed baseline; `--update-snapshots` + the
`[visual-baseline-update]` PR-title marker is the only way to
regenerate. Total runtime ≈ 2 s on the developer box, well under
the ≤ 60 s CI budget.

**Test sweep (recorded against the Task 6 branch):**
- `npm run test:cgrid`: 93 files, 1070 unit tests, 100% pass (4.03 s).
- `npx playwright test`: 207 functional E2E specs, 100% pass (1.3 m).
- `npm run test:visual` (from `apps/cgrid-positions/`): 13 specs
  (12 matrix + 1 smoke), 100% pass (1.9 s).

---

## Cycle 12 status: COMPLETE

Closed on 2026-06-27.

- [x] Task 1 — `getVisibleCellBounds` helper + 12 unit cases (PR #45,
      `4b52772`).
- [x] Task 2 — Focus ring + range overlay delegate band-clip to
      `getVisibleCellBounds` (PR #46, `2a7290c`).
- [x] Task 3 — DOM editor + floating-filter overlay delegate
      band-clip to `getVisibleCellBounds` (PR #47, `34dcd21`).
- [x] Task 4 — Playwright visual-regression harness + smoke spec
      (PR #48, `3861da0`).
- [x] Task 5 — 12-snapshot regression matrix covering layout +
      overlay states (PR #49, `3b996ad`).
- [x] Task 6 — Cycle 12 exit ritual: worklog `## Shipped` + status
      close, README finalisation, FEATURE_MATRIX footnote.

**FM coverage:** No row flips in this cycle — this is infrastructure
work. Every existing FM row stays where it is; future cycles flip
rows faster because the band-clip primitive prevents the regression
class and the visual matrix catches any layout drift before merge.
The FEATURE_MATRIX footnote records that Areas 17 (side bar) +
shared overlays are now gated by `npm run test:visual`.
