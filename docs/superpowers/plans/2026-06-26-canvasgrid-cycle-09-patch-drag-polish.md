# Canvasgrid Cycle 9 patch — Drag polish + right-click preserves range — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Finish the Excel-style cell-range UX that Cycle 9 left
incomplete:

1. **Right-click on an existing cell range must NOT clobber the range.**
   Today `RangeSelection.handleMouseDown` rewrites the range to a 1×1
   on every mousedown regardless of button, so right-clicking the
   second cell of a drag-selected 5×3 range collapses the range to
   that one cell — the context menu's Copy then copies a single cell
   instead of the 5×3 the user clearly intended.
2. **Auto-scroll while drag-selecting near the viewport edge.** A
   drag that runs to the right edge of the canvas freezes there
   because the pointer can't reach off-screen cells without scrolling.
   Excel scrolls the sheet under the pointer; we don't.

Neither item is in the master plan's Cycle 9 spec (which closed at
seven tasks: model / drag / painter / shift+ctrl / fill / API /
events), and neither is picked up by any later cycle in
`2026-06-24-canvasgrid-feature-parity.md` — both are polish on
already-shipped surfaces. Slotting them here keeps the Cycle 9
feature complete before Cycle 11 starts.

**Architecture:** Both tasks live in `interaction/features/rangeSelection.ts`.

- **Right-click preservation** is a pure mousedown guard: when
  `event.button === 2` AND the hit cell lies inside any existing
  range, RangeSelection skips its `setRanges` mutation and also
  short-circuits `super.handleMouseDown` so `CellSelection` doesn't
  call `selectSingle` (which would clear row selection). Focus still
  moves to the clicked cell via a narrow `setFocus` so the context
  menu's `Copy` knows which range to serialise. Right-clicks outside
  the range fall through to the existing left-click path so the menu
  always has a fresh 1×1 to act on.
- **Auto-scroll on drag** runs a rAF-paced loop that polls the last
  pointer position (captured on `handleMouseDrag`) and calls
  `ctx.grid.scrollBy(dx, dy)` proportional to the overshoot past the
  viewport edge. Edge zone: ±20 px from each side of the body
  rectangle. Speed: linear in overshoot, capped at ~30 px/frame so
  the user can still stop near a target cell. The loop self-terminates
  when the pointer re-enters the body OR `handleMouseUp` fires.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E),
single-canvas 2D paint, Web Worker data pipeline. No new runtime
dependencies. The auto-scroll loop uses `requestAnimationFrame` —
already available in every browser the grid supports.

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md` — original Cycle 9 worklog (range selection foundations)
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 9 section, line 313)
- `docs/catalog/screenshots/19-context-menu-default.png` — ag-grid reference for the cell context menu (BOTH tasks must consult this; right-click bug interacts with the menu surface)
- Current source:
  - `cgrid/src/interaction/features/rangeSelection.ts` — touch point for both tasks
  - `cgrid/src/interaction/selectionModel.ts` — `state.ranges` source-of-truth
  - `cgrid/src/interaction/featureChain.ts` — chain dispatcher (window mousemove → handleMouseDrag wiring already in place)
  - `cgrid/src/velocityGrid.ts` — `VelocityGridApi.scrollBy` (already exists; used by the wheel handler)
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task** (extend the constraints from Cycles 2–10).

- **No regressions in the public API.** Both tasks are pure behaviour
  fixes; no `VelocityGridOptions` / `VelocityGridApi` additions unless a knob is
  truly required (note in the task if you add one).
- **TypeScript strict.** `npm run typecheck --workspaces` clean every task.
- **`alpha: false` canvas, DPR-aware paint, native scrollbars** — unchanged.
- **Vitest + Playwright green at the end of every task.**
- **E2E gate is REQUIRED for both tasks.** Both touch user-visible
  interaction; unit tests alone don't catch real-pointer regressions.
  Open `docs/catalog/screenshots/19-context-menu-default.png` before
  Task 1 and confirm the context menu still mounts correctly after
  right-clicking an existing range (the bug fix MUST land WITHOUT
  breaking the menu).
- **Conventional commits.** Body footer carries cycle prefix
  (e.g. `fix(cgrid): right-click preserves cell range\n\nCycle 9 patch / Task 1.`).
- **Branch per task + PR per task.** Each task: branch off main as
  `batch/cycle-9-patch-task-N-<YYYY-MM-DD>`, commit, push, open PR
  to main. The autonomous runner expects this and merges each PR
  before spawning the next session.
- **Demo never breaks.** `apps/cgrid-positions` runs green at every
  commit. E2E specs use `?stress=light` opt-in for the heavy stream.

## Task overview

| # | Task | Files |
|---|---|---|
| 1 | Right-click on an existing cell range preserves the range (focus still moves to the clicked cell so Copy serialises the intended block) | `interaction/features/rangeSelection.ts`, `interaction/features/cellSelection.ts`, `interaction/selectionModel.ts` (helper), tests, E2E |
| 2 | Auto-scroll during drag near the viewport edge (Excel-style edge-zone with proportional speed, rAF-paced, self-terminating) | `interaction/features/rangeSelection.ts`, `interaction/featureChain.ts` (if helper needed), tests, E2E |

---

## Task 1 — Right-click on an existing range preserves it

**Goal:** Right-clicking a cell INSIDE the current range selection
must keep the range intact + just move focus to the clicked cell, so
the context menu's `Copy` serialises the visible block. Right-clicks
OUTSIDE the range fall through to the existing behaviour (collapse to
a 1×1 at the click + open the menu).

**Repro (before the fix):**
1. Open the demo. Drag-select a 3×3 cell range.
2. Right-click on any cell INSIDE the range (not the top-left anchor).
3. Range collapses to that one cell. Menu opens. Click `Copy`.
4. Clipboard now has a single cell — NOT the 3×3 the user expected.

**Read first:**
- `cgrid/src/interaction/features/rangeSelection.ts` — `handleMouseDown` is the bug site.
- `cgrid/src/interaction/features/cellSelection.ts` — `handleMouseDown` consumes the cell mousedown and calls `selectSingle` (which clears row selection); needs the same right-click guard or it'll undo Task 1's work for row selection.
- `cgrid/src/interaction/selectionModel.ts` — `state.ranges` and the `getRanges()` accessor.

**Files:**
- Modify: `cgrid/src/interaction/features/rangeSelection.ts` — right-click guard.
- Modify: `cgrid/src/interaction/features/cellSelection.ts` — right-click guard for row selection (focus moves; row selection unchanged when the click is inside an existing range OR a focused-row selection set).
- Modify (small helper): `cgrid/src/interaction/selectionModel.ts` — `isInsideAnyRange(rowIndex, colId): boolean`. Pure read over `state.ranges`. Useful from both features.
- Modify: `cgrid/tests/selectionRange.test.ts` — `isInsideAnyRange` unit cases.
- Create: `apps/cgrid-positions/e2e/cycle9-rightClickPreservesRange.spec.ts` — repro the exact drag-then-right-click flow + assert ranges unchanged + Copy serialises the full block.

**Interface produced:**

```ts
// selectionModel.ts
/** True when `(rowIndex, colId)` falls inside any rect in `state.ranges`.
 *  Used by mousedown handlers to decide whether a right-click should
 *  preserve the existing range (click landed INSIDE) or replace it
 *  (click landed OUTSIDE). */
isInsideAnyRange(rowIndex: number, colId: string): boolean;
```

**Steps:**

- [ ] **Step 1:** Add `SelectionModel.isInsideAnyRange` (one short loop
      over `state.ranges` — `colIds.includes` plus row span check).
      Unit-test it: empty ranges → false; single range hit → true;
      single range miss (row outside / col outside) → false; multiple
      disjoint ranges where one matches → true.
- [ ] **Step 2:** Failing E2E in
      `apps/cgrid-positions/e2e/cycle9-rightClickPreservesRange.spec.ts`:
      seed a 3×3 range via the API (skip the drag flake from PR #21's
      hard-won lesson — drive selection via `__cgrid.addCellRange`
      + `selection.setFocus`), dispatch a `contextmenu` event on a
      cell INSIDE the range, assert `__cgrid.selection.state.ranges`
      still has the 3×3 rect AND `__cgrid.selection.state.focusedColId`
      moved to the clicked cell. Then dispatch a `contextmenu` on a
      cell OUTSIDE the range and assert the range collapsed to that
      cell's 1×1.
- [ ] **Step 3:** In `RangeSelection.handleMouseDown`, gate the
      `setRanges([1×1])` mutation behind
      `e.button === 0 || !ctx.grid.selection.isInsideAnyRange(hit.rowIndex, hit.colId)`.
      When `button === 2` AND the click is inside an existing range,
      skip `setRanges`, skip drag state, skip
      `emitRangeSelectionChanged`, BUT do call `sel.setFocus(hit.rowIndex,
      hit.colId)` directly so the menu's actions read the clicked cell.
      Do NOT call `super.handleMouseDown` (CellSelection would call
      `selectSingle` and clear row selection).
- [ ] **Step 4:** Same guard in `CellSelection.handleMouseDown` so a
      right-click that lands OUTSIDE the range (where Task 1 falls
      through to `super`) doesn't accidentally clear a deliberately
      multi-row selection. If `e.button === 2` AND
      `sel.state.selectedRowIndices.has(hit.rowIndex)`, set focus +
      skip the `selectSingle` / `toggleMulti` branch.
- [ ] **Step 5:** Re-run the E2E from Step 2 — both cases green.
- [ ] **Step 6:** Visual verify in the browser via Chrome DevTools:
      seed a 3×3 range, right-click inside, take a screenshot, confirm
      the 3×3 highlight is still visible behind the menu + the menu's
      `Copy` produces the 3×3 TSV in the clipboard.
- [ ] **Step 7:** Typecheck + full `npm run test:cgrid` + full
      `npx playwright test` green.
- [ ] **Step 8:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Right-click on a cell INSIDE the current range → range unchanged;
      focus moves to clicked cell; context menu opens.
- [ ] `Copy` from the menu serialises the FULL range (not the one cell).
- [ ] Right-click OUTSIDE the current range → range collapses to 1×1
      at the clicked cell (no behaviour regression).
- [ ] Row selection (independent of cell range) survives a right-click
      on a selected row.
- [ ] All Cycle 9 / Cycle 10 specs still green (no regression in the
      existing range / fill-handle / clipboard tests).

**Commit message:**

```
fix(cgrid): right-click preserves cell range so Copy serialises the intended block

Cycle 9 patch / Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Read `docs/superpowers/plans/2026-06-26-canvasgrid-cycle-09-patch-drag-polish.md` and execute Task 2."

---

## Task 2 — Auto-scroll during drag near the viewport edge

**Goal:** When a range drag's pointer enters the ±20 px edge zone of
the body rectangle (any side), kick a rAF-paced loop that calls
`ctx.grid.scrollBy(dx, dy)` with speed proportional to the overshoot
past the edge. The loop self-terminates when (a) the pointer
re-enters the body OR (b) `handleMouseUp` fires (drag ends). Matches
Excel — drag past the right edge and the sheet scrolls under your
pointer; the range extends into the newly-revealed columns.

**Repro (before the fix):**
1. Open the demo. Mousedown on a body cell.
2. Drag to the right edge of the canvas + try to drag past it.
3. The range freezes at the rightmost visible column. Off-screen
   columns are unreachable without releasing + scrolling manually.

**Read first:**
- `cgrid/src/interaction/features/rangeSelection.ts` — extend
  `handleMouseDrag` with edge detection + rAF loop kickoff.
- `cgrid/src/interaction/featureChain.ts` — `onWindowMouseMove`
  builds `ctx` per event; `toLocal` translates clientX/Y to
  canvas-local coords. The drag handler receives `ctx.point`
  (canvas-local) which is the right surface to check against the
  viewport rect.
- `cgrid/src/velocityGrid.ts` — `scrollBy(dx, dy)` is the existing API
  (used by the wheel handler at line ~184 of `featureChain.ts`).
- `cgrid/src/core/viewport.ts` (or wherever the body rectangle is
  computed) — to read `bodyLeft / bodyRight / bodyTop / bodyBottom`.
  The hit-tester at `hitTester.ts` reads these already; the same
  values are on `ViewportState`.

**Files:**
- Modify: `cgrid/src/interaction/features/rangeSelection.ts` — add
  the rAF loop + edge-zone math.
- Modify: `cgrid/src/interaction/feature.ts` — extend `VelocityGridLike` with
  any new surface needed (e.g. `getBodyRect(): {left, right, top, bottom}`
  if not already exposed via the viewport).
- Modify: `cgrid/src/velocityGrid.ts` — implement the new surface method.
- Modify: `cgrid/tests/rangeSelection.test.ts` (or split file) — unit
  tests for the edge-zone math (no DOM, just the pure helper).
- Create: `apps/cgrid-positions/e2e/cycle9-rangeDragAutoScroll.spec.ts`
  — drag to the right edge + verify the grid scrolled + the range
  extended to a column that started off-screen.

**Design notes:**
- Edge zone: **20 px** from each side. Inside the zone the speed scales
  linearly with depth: 1 px overshoot → 1 px/frame; 20 px overshoot →
  20 px/frame. Cap at 30 px/frame so a tiny grid doesn't fly past every
  row in 100 ms.
- Direction: per-axis. The pointer can be inside the right edge AND
  the bottom edge → scrolls diagonally.
- Lifecycle: kicked on the first edge-zone `handleMouseDrag` tick;
  cancelled on the first non-edge-zone tick OR on `handleMouseUp`.
  ONE active loop at a time (re-entering the edge zone after leaving
  starts a fresh loop).
- Drag tracking still works: each rAF tick re-runs the cell hit-test
  at the LAST captured pointer position so the range follows the newly-
  revealed cells.
- Don't auto-scroll for non-drag mouse moves (the existing
  `handleMouseMove` is gated by `if (this.mouseIsDown) return` in
  `featureChain` — keep it that way).

**Steps:**

- [ ] **Step 1:** Failing E2E in
      `apps/cgrid-positions/e2e/cycle9-rangeDragAutoScroll.spec.ts`:
      seed focus at a left-side cell; mousedown; window mousemove
      that overshoots the canvas right edge by 30 px; wait 200 ms
      (5-10 rAF ticks); assert `__cgrid.viewport.scrollLeft` advanced
      AND the range includes a column whose original `left` was past
      the canvas right edge.
- [ ] **Step 2:** Pure edge-zone math helper (no DOM): given
      `(pointer, bodyRect, edgePx)` → `{dx, dy}` per-frame deltas.
      Returns `{0, 0}` when inside the body. Cap at 30. Unit-test the
      four directions + corner case + cap.
- [ ] **Step 3:** Wire the rAF loop in `RangeSelection`. State:
      `{ rafId: number|null, lastPoint: {x,y}, lastRawEvent: MouseEvent }`.
      Kickoff on the first edge-zone drag tick; cancel on
      non-edge-zone drag tick OR on mouseup.
- [ ] **Step 4:** Each rAF tick: (a) compute `(dx, dy)` from the
      helper, (b) `ctx.grid.scrollBy(dx, dy)`, (c) re-fire a synthetic
      drag from the LAST pointer position so the range follows the
      newly-revealed cells. Reuse `this.lastRawEvent` so the existing
      `handleMouseDrag` body runs unchanged (it re-hit-tests via
      `ctx.hit`).
- [ ] **Step 5:** Re-run the E2E from Step 1 — green.
- [ ] **Step 6:** Visual verify: drag from a center cell to past the
      right edge of the canvas; grid scrolls; range extends to off-
      screen cells.
- [ ] **Step 7:** Typecheck + full `npm run test:cgrid` + full
      `npx playwright test` green.
- [ ] **Step 8:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Drag past the right / bottom / left / top edge auto-scrolls in
      that direction.
- [ ] Scroll speed scales linearly with how far past the edge the
      pointer is (capped at 30 px/frame).
- [ ] Range extends to include cells that were off-screen when the
      drag started.
- [ ] Diagonal drag (right + down) scrolls both axes.
- [ ] Auto-scroll stops the instant the pointer re-enters the body OR
      mouseup fires.
- [ ] No regression in any existing Cycle 9 / Cycle 10 spec.

**Commit message:**

```
feat(cgrid): auto-scroll during range drag near viewport edges (Excel-style)

Cycle 9 patch / Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Next session prompt:** "Cycle 9 patch complete — STOP. Do NOT proceed to Cycle 11."

---

## Shipped

_(populated by the agent that lands Task 2)_

---

## Cycle 9 patch status: IN PROGRESS

_(flipped to `COMPLETE` after Task 2 PR merges)_
