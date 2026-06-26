# Canvasgrid Cycle 9 — Range selection + fill handle — Worklog

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:executing-plans`
> to execute this worklog task-by-task. Each task below is designed to
> fit in a single, isolated Claude Code session. Run **one task per
> session**, verify, commit, push, and open a PR; then START A NEW
> SESSION using the "Next session prompt" at the end of the task.
> **Do NOT chain multiple tasks in one session.** The autonomous
> runner at `scripts/run-cycle-tasks.sh` spawns these sessions for
> you.

**Goal:** Cell-level range selection (click + drag, shift-click extend,
ctrl-click disjoint), header-click whole-column selection, fill-handle
drag, range API, and `rangeSelectionChanged` event. Foundation for
Cycle 10 (clipboard) and Cycle 20 (chart range).

**Architecture:** Ranges live alongside row selection in `SelectionModel`
as `Range[]` (each carries `rowStart / rowEnd / colIds[]` —
contiguous-rect representation supports both column-band selects from
header clicks and arbitrary drag rects). A new `RangeSelection`
interaction feature drives drag/shift/ctrl semantics. A
`rangeOverlayPainter` runs after the existing overlay pass and
draws one translucent fill + one border rect per Range (allocation-
free per scroll frame — Range list is small, paint is fast). The
fill-handle is a 6×6 square at the bottom-right of the focused
range; drag extends; release applies a single `applyTransaction`.
The range API + event are surfaced on `CGridApi`.

**Tech Stack:** TypeScript strict, Vitest (unit), Playwright (E2E),
single-canvas 2D paint, Web Worker data pipeline. No new runtime
dependencies.

**References (READ FIRST when starting any task):**
- `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` — master plan (Cycle 9 section, line 313)
- `docs/superpowers/plans/2026-06-25-canvasgrid-cycle-08-sorting.md` — previous cycle's worklog for shape reference
- `docs/catalog/12-selection.md` — `cellSelection`, `getCellRanges`, `clearCellRanges`, `rangeSelectionChanged`, `fillHandleDirection`, `enableFillHandle`, `suppressClearOnFillReduction`
- `docs/catalog/FEATURE_MATRIX.md` — Area 12 rows to flip at cycle exit (~30 of 46)
- Current source:
  - `cgrid/src/interaction/selectionModel.ts` — row-selection + focused-cell state
  - `cgrid/src/interaction/featureChain.ts` — input dispatcher (where the new feature plugs in)
  - `cgrid/src/interaction/features/` — existing features (`headerClick.ts`, `columnDrag.ts`, …)
  - `cgrid/src/renderer/painters/` — paint passes (rangeOverlayPainter lands here)
  - `cgrid/src/renderer/renderer.ts` — paint pass ordering
  - `cgrid/src/cgrid.ts` — `CGridApi` (where range API methods land)
  - `cgrid/src/types.ts` — `CGridEvent` union (rangeSelectionChanged), `CGridApi` interface
- Demo (verification target): `apps/cgrid-positions/`

## Global Constraints

Apply to **every task** (extend the constraints from Cycles 2–8).

- **API parity, not API mimicry.** Field names mirror ag-grid verbatim
  (`cellSelection`, `getCellRanges`, `addCellRange`, `clearCellRanges`,
  `enableFillHandle`, `fillHandleDirection`, `rangeSelectionChanged`,
  `cellSelectionChanged`).
- **No regressions in the public API.** Any addition to `CGridOptions`,
  `CGridApi`, the event union, or the worker protocol is purely
  additive.
- **TypeScript strict.** `npm run typecheck --workspaces` clean every task.
- **No worker round-trip for range paint.** Range overlay reads from
  main-side `SelectionModel` only. Worker doesn't know about ranges
  (Cycle 10's clipboard task will project the range to rowIds before
  asking the worker for values).
- **`alpha: false` canvas, DPR-aware paint, native scrollbars** — unchanged.
- **Vitest + Playwright green at the end of every task.**
- **Conventional commits.** Body footer carries cycle prefix
  (e.g. `feat(cgrid): range selection drag\n\nCycle 9 / Task 2.`).
- **Branch per task + PR per task.** Each task: branch off main as
  `batch/cycle-9-task-N-<YYYY-MM-DD>`, commit, push, open PR to main.
  The autonomous runner expects this.
- **Demo never breaks.** `apps/cgrid-positions` runs green at every
  commit. E2E specs use `?stress=light`.
- **Performance gate.** Range paint cost ≤ 0.5 ms/frame for ≤10
  ranges. Fill-handle commit applies as a single
  `applyTransaction.update` (one round-trip).

## Task overview

| # | Task | Files |
|---|---|---|
| 1 | `SelectionRange` model + extend `SelectionModel` | `types.ts`, `interaction/selectionModel.ts`, tests |
| 2 | Range selection via drag (mousedown→mousemove→mouseup) | `interaction/features/rangeSelection.ts` (new), `featureChain.ts`, `cgrid.ts`, tests |
| 3 | Range overlay painter | `renderer/painters/rangeOverlayPainter.ts` (new), `renderer/renderer.ts`, `theming/tokens.css`, tests |
| 4 | Shift-click extend + Ctrl-click disjoint + header-click whole-column | `interaction/features/rangeSelection.ts`, `interaction/features/headerClick.ts`, tests |
| 5 | Fill handle (drag bottom-right corner extends selection + commits values) | `interaction/features/fillHandle.ts` (new), `renderer/painters/rangeOverlayPainter.ts`, tests, E2E |
| 6 | Range API: `getCellRanges` / `addCellRange` / `clearCellRanges` + `cellSelection` options | `cgrid.ts`, `types.ts`, tests |
| 7 | `rangeSelectionChanged` + `cellSelectionChanged` events + Cycle 9 exit ritual | `cgrid.ts`, `types.ts`, FM flips, worklog Shipped + status |

---

## Task 1 — `SelectionRange` model + extend `SelectionModel`

**Goal:** Add `ranges: SelectionRange[]` to the selection state. A
`SelectionRange` describes a contiguous rectangle:
`{ rowStart, rowEnd, colIds[] }` (rowStart/rowEnd are inclusive,
visible-order indices; colIds is the ordered list of involved
columns). Multiple ranges may coexist (disjoint), matching ag-grid's
shape. The model exposes `setRanges`, `addRange`, `extendRange`,
`clearRanges`, `getRanges`. Range mutations fire an `onChange`
notification the existing SelectionModel already uses.

**Read first:**
- `cgrid/src/interaction/selectionModel.ts` — current state shape +
  notification pattern
- `cgrid/src/cgrid.ts` — `setSelectedRowIds` / `setFocusedCell` for
  reference

**Files:**
- Modify: `cgrid/src/types.ts` — `SelectionRange` interface.
- Modify: `cgrid/src/interaction/selectionModel.ts` — `state.ranges`,
  `setRanges`, `addRange`, `extendRange`, `clearRanges`, `getRanges`.
- Create: `cgrid/tests/selectionRange.test.ts`.

**Interface produced:**

```ts
// types.ts
export interface SelectionRange {
  /** First row in the range (inclusive, current visible-order index). */
  rowStart: number;
  /** Last row in the range (inclusive, current visible-order index). */
  rowEnd: number;
  /** ColIds involved, in render order (left → right). For full-row
   *  ranges this is every visible colId; for column-band ranges it
   *  spans rowStart=0 → rowEnd=rowCount-1. */
  colIds: string[];
}
```

**Steps:**

- [ ] **Step 1:** Failing `selectionRange.test.ts`. Assertions:
      - `setRanges([])` clears.
      - `addRange(r)` appends; `getRanges()` returns the list.
      - `extendRange(rowIndex, colId)` widens the LAST range to cover
        the new anchor (rowStart..max(rowEnd, rowIndex), union of colIds).
      - `clearRanges()` empties.
      - Selection's `onChange` fires exactly once per mutation.
- [ ] **Step 2:** Implement on `SelectionModel`.
- [ ] **Step 3:** Typecheck + unit tests green.
- [ ] **Step 4:** Commit + push + PR.

**Acceptance criteria:**
- [ ] `state.ranges` exists alongside `selectedRowIndices`.
- [ ] Five methods (`setRanges` / `addRange` / `extendRange` /
      `clearRanges` / `getRanges`) work + fire onChange.
- [ ] All unit tests green.

**Commit message:**

```
feat(cgrid): SelectionRange model + SelectionModel range methods

Adds `ranges: SelectionRange[]` alongside the existing row-selection
state. Each Range describes a contiguous rectangle
(rowStart..rowEnd × colIds[]). Disjoint ranges supported (matches
ag-grid shape).

Cycle 9 / Task 1.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md
"Task 2" and execute it. Confirm Task 1 is on main. Branch
batch/cycle-9-task-2-<YYYY-MM-DD>. Open PR to main when done.
```

---

## Task 2 — Range selection via drag

**Goal:** Mouse-down on a data cell starts a range; mouse-move while
dragging extends it; mouse-up commits. The range replaces any
existing ranges (Shift/Ctrl modifiers in Task 4 add extend / disjoint
semantics). The drag pathway is a new interaction feature that runs
in the chain alongside the existing focus / sort / drag features.

**Read first:**
- `cgrid/src/interaction/featureChain.ts` — how features register +
  receive events
- `cgrid/src/interaction/feature.ts` — feature interface
- `cgrid/src/interaction/features/columnDrag.ts` — closest existing
  pattern (mousedown→mousemove→mouseup state machine)
- `cgrid/src/interaction/hitTester.ts` — `hitAt(x, y)` returns the
  cell under the pointer

**Files:**
- Create: `cgrid/src/interaction/features/rangeSelection.ts` (~120 LOC).
- Modify: `cgrid/src/interaction/featureChain.ts` — register the
  new feature.
- Modify: `cgrid/src/cgrid.ts` — instantiate.
- Create: `cgrid/tests/rangeSelection.test.ts`.

**Steps:**

- [ ] **Step 1:** Failing `rangeSelection.test.ts`. Use the test
      harness shape from `tests/columnDrag.test.ts`. Assertions:
      - mousedown on cell (r=2, c='cusip') → `getRanges()` returns
        `[{rowStart:2, rowEnd:2, colIds:['cusip']}]`.
      - mousemove to (r=5, c='ticker') → range expands to
        `{rowStart:2, rowEnd:5, colIds:['cusip','ticker','...']}`
        (every column between cusip and ticker in render order).
      - mouseup commits the range; further mousemove without a
        mousedown does NOT modify ranges.
- [ ] **Step 2:** Implement `RangeSelection` feature. State machine:
      idle → dragging(anchor) → idle. Anchor is the cell hit at
      mousedown.
- [ ] **Step 3:** Wire into featureChain after the existing
      headerClick / drag features.
- [ ] **Step 4:** Typecheck + unit tests green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Click-drag on data cells produces a range.
- [ ] Range expands as the pointer moves.
- [ ] Range is finalized on mouseup.
- [ ] All unit tests green.

**Commit message:**

```
feat(cgrid): range selection via mousedown→mousemove→mouseup drag

Adds a RangeSelection interaction feature that converts a drag
gesture into a SelectionRange. Anchor at mousedown, expand on
mousemove, commit on mouseup. Replaces existing ranges; Shift/Ctrl
modifiers land in Task 4.

Cycle 9 / Task 2.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md
"Task 3" and execute it. Confirm Task 2 is on main. Branch
batch/cycle-9-task-3-<YYYY-MM-DD>. Open PR to main when done.
```

---

## Task 3 — Range overlay painter

**Goal:** Paint the active ranges as one translucent fill + one
border rect per contiguous range. Runs as a paint pass after the
existing overlay so it stacks on top of cell content + bundles. Reads
from `SelectionModel.ranges` directly (no worker round-trip).
Allocation-free on the scroll path.

**Read first:**
- `cgrid/src/renderer/renderer.ts` — paint-pass order
- `cgrid/src/renderer/painters/` — existing painters (e.g.
  `gridLinesPainter.ts`, `byRows.ts`)
- `cgrid/src/core/viewport.ts` — `getCellBoundsAt` analogue
  (the painter projects logical row+col indices to pixel rects via
  the same `ViewportState`)

**Files:**
- Create: `cgrid/src/renderer/painters/rangeOverlayPainter.ts` (~100 LOC).
- Modify: `cgrid/src/renderer/renderer.ts` — add the painter after
  the existing overlay pass.
- Modify: `cgrid/src/theming/tokens.css` — `--cg-range-fill-color`
  (translucent), `--cg-range-border-color` (opaque).
- Modify: `cgrid/src/theming/cssReader.ts` — forward both into
  `ResolvedTheme`.
- Create: `cgrid/tests/rangeOverlayPainter.test.ts`.

**Steps:**

- [ ] **Step 1:** Failing `rangeOverlayPainter.test.ts` — given a
      mock viewport + 2 ranges, assert the painter called
      `gc.fillRect` once + `gc.strokeRect` once per range with the
      expected pixel rects.
- [ ] **Step 2:** Implement. For each range, compute the bounding
      pixel rect from `viewport.visibleRows[rowStart..rowEnd]` +
      `viewport.visibleColumns` filtered by colIds. Skip ranges
      entirely outside the visible window.
- [ ] **Step 3:** Theme tokens — fill ~22% alpha of focus color;
      border = focus color. Light + dark.
- [ ] **Step 4:** Typecheck + tests green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Ranges paint as one fill + one border per contiguous rect.
- [ ] Off-screen ranges contribute zero paint cost.
- [ ] Light + dark themes render correct colors.

**Commit message:**

```
feat(cgrid): range overlay painter (one fill + one border per range)

Paints the contents of SelectionModel.ranges as translucent fill +
opaque border per contiguous rect. Runs after the existing overlay
pass. Reads from main-side SelectionModel only — no worker round-
trip. Off-screen ranges contribute zero paint cost.

Theme tokens --cg-range-fill-color + --cg-range-border-color in
both light + dark.

Cycle 9 / Task 3.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md
"Task 4" and execute it. Confirm Task 3 is on main. Branch
batch/cycle-9-task-4-<YYYY-MM-DD>. Open PR to main when done.
```

---

## Task 4 — Shift-click extend + Ctrl-click disjoint + header-click whole-column

**Goal:** Three modifier-driven semantics layered on the drag feature
from Task 2:

1. **Shift-click** on a data cell EXTENDS the last range from its
   anchor to the clicked cell (no drag required).
2. **Ctrl/Cmd-click** on a data cell adds a NEW disjoint range
   anchored at the clicked cell (existing ranges stay).
3. **Click on a column header** selects the WHOLE column (rowStart=0,
   rowEnd=lastRow, colIds=[colId]). Shift-click extends the current
   column-range to include every column between the anchor and the
   clicked header.

**Read first:**
- `cgrid/src/interaction/features/headerClick.ts` — current click
  handler (forwards to `cycleSort`)
- Task 2's `rangeSelection.ts` for state machine

**Files:**
- Modify: `cgrid/src/interaction/features/rangeSelection.ts` —
  handle shift/ctrl on the initial mousedown.
- Modify: `cgrid/src/interaction/features/headerClick.ts` — when
  the click isn't on a sort affordance, route to `cgrid.selectColumn(colId, {extend})`.
- Modify: `cgrid/src/cgrid.ts` — `selectColumn(colId, opts)` helper.
- Update: `cgrid/tests/rangeSelection.test.ts` — add modifier cases.

**Steps:**

- [ ] **Step 1:** Tests for shift-click extend, ctrl-click disjoint,
      header-click column band, header-shift-click multi-column band.
- [ ] **Step 2:** Implement modifier handling in `rangeSelection.ts`
      (`onMouseDown` switches on `event.shiftKey` / `event.ctrlKey ||
      event.metaKey`).
- [ ] **Step 3:** Header-click → `selectColumn`.
- [ ] **Step 4:** Typecheck + tests green.
- [ ] **Step 5:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Shift-click extends the last range.
- [ ] Ctrl/Cmd-click adds a disjoint range.
- [ ] Header click selects the whole column.
- [ ] Header shift-click selects every column between anchor and click.

**Commit message:**

```
feat(cgrid): shift-click extend + ctrl-click disjoint + header-click column

Layers modifier semantics on the range-selection drag from Task 2.
Header click selects the whole column; shift-extends.

Cycle 9 / Task 4.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md
"Task 5" and execute it. Confirm Task 4 is on main. Branch
batch/cycle-9-task-5-<YYYY-MM-DD>. Open PR to main when done.
```

---

## Task 5 — Fill handle (drag-to-extend + commit values)

**Goal:** A 6×6 px square at the bottom-right of the currently-focused
range (the most recently created/extended). Drag the handle vertically
to extend the selection downward; release commits new cell values
into the extended rows. Linear-extrapolation for numbers, repeat for
text. Hidden when no range or when
`CGridOptions.enableFillHandle === false`.

**Read first:**
- `cgrid/src/interaction/features/columnDrag.ts` — drag pattern with
  visual preview during the drag
- Task 3's `rangeOverlayPainter.ts` for the bottom-right hit rect

**Files:**
- Create: `cgrid/src/interaction/features/fillHandle.ts` (~150 LOC).
- Modify: `cgrid/src/renderer/painters/rangeOverlayPainter.ts` —
  paint the 6×6 handle on the focused range when fill handle is on.
- Modify: `cgrid/src/cgrid.ts` — instantiate + commit
  `applyTransaction({ update: [...newRows] })` on release.
- Modify: `cgrid/src/types.ts` — `CGridOptions.enableFillHandle`,
  `fillHandleDirection: 'x' | 'y' | 'xy'`, `fillOperation` callback.
- Create: `cgrid/tests/fillHandle.test.ts`.
- Create: `apps/cgrid-positions/e2e/cycle9-fillHandle.spec.ts`.

**Steps:**

- [ ] **Step 1:** Failing tests:
      - Hit-test: pointer in the 6×6 handle rect at the
        bottom-right of a range → fillHandle feature claims the
        mousedown.
      - Drag-down by 3 rows → preview range extends 3 rows.
      - Release: `applyTransaction({update: 3 rows})` fires with
        values continuing the source range's pattern.
      - `enableFillHandle: false` → handle isn't painted +
        bottom-right click goes to normal range drag.
- [ ] **Step 2:** Implement `fillHandle.ts` feature.
- [ ] **Step 3:** Extend `rangeOverlayPainter.ts` to draw the
      handle.
- [ ] **Step 4:** Commit-on-release: project new rows via
      `extrapolate(srcValues, count)` (linear for numbers, repeat
      for text, custom via `fillOperation`).
- [ ] **Step 5:** Demo: enable in `apps/cgrid-positions`.
- [ ] **Step 6:** E2E: drag handle 3 rows + assert extended cells'
      values via `getCellValue`.
- [ ] **Step 7:** Typecheck + tests + E2E green.
- [ ] **Step 8:** Commit + push + PR.

**Acceptance criteria:**
- [ ] Handle appears at bottom-right of the focused range.
- [ ] Drag extends + previews.
- [ ] Release commits values (linear for numbers, repeat for text).
- [ ] `enableFillHandle: false` suppresses the handle.

**Commit message:**

```
feat(cgrid): fill handle (drag-to-extend + value commit)

6×6 handle at bottom-right of the focused range. Drag extends the
range; release commits new rows via applyTransaction. Linear
extrapolation for number columns; repeat for text. Hidden when
options.enableFillHandle === false. Custom fillOperation callback
overrides the default extrapolation.

Cycle 9 / Task 5.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md
"Task 6" and execute it. Confirm Task 5 is on main. Branch
batch/cycle-9-task-6-<YYYY-MM-DD>. Open PR to main when done.
```

---

## Task 6 — Range API + `cellSelection` options

**Goal:** Surface the range model on `CGridApi` so apps can read /
write programmatically. Add `cellSelection` grid options bundle to
toggle individual sub-behaviors (matches ag-grid).

**Read first:**
- `cgrid/src/cgrid.ts` — `setSelectedRowIds` / `getSelectedRowIds`
  for shape

**Files:**
- Modify: `cgrid/src/cgrid.ts` — add `getCellRanges`,
  `addCellRange`, `clearCellRanges`.
- Modify: `cgrid/src/types.ts` — `CGridApi` interface, `CGridOptions.cellSelection`.
- Create: `cgrid/tests/cellRangesApi.test.ts`.

**Interface produced:**

```ts
// types.ts
export interface CGridOptions<TRow = any> {
  // … existing …
  /** Cell-range selection knobs. When omitted, ranges work with the
   *  Cycle 9 defaults (drag enabled, shift extend, ctrl disjoint,
   *  header-click column band). Cycle 9 / Task 6. */
  cellSelection?: {
    suppressHeader?: boolean;   // disable column-header click → column-range
    suppressRow?: boolean;      // disable row-header (Cycle 14) click → row-range
    suppressDrag?: boolean;     // disable mouse drag → range
  };
}

export interface CGridApi<TRow = any> {
  // … existing …
  /** Currently-selected ranges. Returns a fresh array; mutating it
   *  doesn't update selection. Cycle 9 / Task 6. */
  getCellRanges(): SelectionRange[];
  /** Append a range to the current selection. Cycle 9 / Task 6. */
  addCellRange(range: SelectionRange): void;
  /** Drop every range; row selection + focused cell unaffected.
   *  Cycle 9 / Task 6. */
  clearCellRanges(): void;
}
```

**Steps:**

- [ ] **Step 1:** Failing tests:
      - `api.addCellRange({rowStart:0, rowEnd:2, colIds:['a']})` →
        `getCellRanges().length === 1`.
      - `clearCellRanges()` empties.
      - `cellSelection: { suppressDrag: true }` → drag doesn't
        produce a range.
- [ ] **Step 2:** Wire the three API methods.
- [ ] **Step 3:** Wire `cellSelection` flags into
      `rangeSelection.ts` (read at event time, not at construction
      time, so runtime mutation works).
- [ ] **Step 4:** Typecheck + tests green.
- [ ] **Step 5:** Commit + push + PR.

**Commit message:**

```
feat(cgrid): cell-range API (getCellRanges / addCellRange / clearCellRanges) + cellSelection options

Programmatic range access + cellSelection bundle to toggle drag /
header-click / row-header pathways.

Cycle 9 / Task 6.
```

**Next session prompt:**

```
Read docs/superpowers/plans/2026-06-25-canvasgrid-cycle-09-range-selection.md
"Task 7" and execute it. Confirm Task 6 is on main. Branch
batch/cycle-9-task-7-<YYYY-MM-DD>. Task 7 is the final task; runs
the Cycle 9 exit ritual before opening the PR.
```

---

## Task 7 — `rangeSelectionChanged` + `cellSelectionChanged` events + Cycle 9 exit ritual

**Goal:** Two new events. Both fire when ranges mutate. The
distinction mirrors ag-grid:

- `rangeSelectionChanged` — fires on range start, mid-drag, end,
  clear. Payload `{ ranges, started, finished }`. `finished: true`
  on the final mouseup or programmatic mutation; `false` during the
  drag-in-progress ticks.
- `cellSelectionChanged` — fires when the SET of ranges changes
  (excluding mid-drag ticks). Useful for "save selection state on
  change" without firing 30 times per drag.

Plus the cycle-exit ritual: flip Area 12 FM rows (~30 of 46),
populate this worklog's Shipped + Status sections.

**Read first:**
- `cgrid/src/core/eventEmitter.ts` — how events fan out
- `cgrid/src/types.ts` — `CGridEvent` union

**Files:**
- Modify: `cgrid/src/types.ts` — `CGridEvent` variants for both events.
- Modify: `cgrid/src/cgrid.ts` — fire from `rangeSelection.ts` (mid-drag) +
  from `SelectionModel.onChange` (finished).
- Modify: `cgrid/src/interaction/features/rangeSelection.ts` + `fillHandle.ts`
  — emit the start/mid/end pings.
- Update: `docs/catalog/FEATURE_MATRIX.md` — Area 12 flips.
- Update: this worklog — append `## Shipped` + `## Cycle 9 status: COMPLETE`.
- Update: master plan's Cycle 9 section status line.

**Interface produced:**

```ts
// CGridEvent additions
export type CGridEvent =
  // … existing …
  | {
      type: 'rangeSelectionChanged';
      ranges: SelectionRange[];
      /** True for the initial mousedown that starts a drag. */
      started: boolean;
      /** True for the mouseup that finalizes a drag, OR for any
       *  programmatic mutation (which is a single instantaneous
       *  change). False for the mid-drag ticks. */
      finished: boolean;
    }
  | {
      type: 'cellSelectionChanged';
      ranges: SelectionRange[];
    };
```

**Steps:**

- [ ] **Step 1:** Failing tests assert both events fire with the
      right payload at the right moments.
- [ ] **Step 2:** Wire emission from the rangeSelection feature
      (start + mid + end) + from the API methods (instantaneous).
- [ ] **Step 3:** Suppress mid-drag pings from cellSelectionChanged
      (debounce-tail emit only on `finished: true`).
- [ ] **Step 4:** Typecheck + unit tests + Cycle 7/8/9 E2E green.
- [ ] **Step 5:** FM flips — Area 12: `cellSelection`,
      `cellSelection.suppressHeader/suppressRow/suppressDrag`,
      `getCellRanges`, `addCellRange`, `clearCellRanges`,
      `enableFillHandle`, `fillHandleDirection`, `fillOperation`,
      `rangeSelectionChanged`, `cellSelectionChanged`, drag/range/
      shift-click/ctrl-click behaviors, header-click column band.
- [ ] **Step 6:** Append `Shipped` + `Cycle 9 status: COMPLETE`
      sections to this worklog.
- [ ] **Step 7:** Commit + push + PR.

**Commit message:**

```
feat(cgrid): rangeSelectionChanged + cellSelectionChanged events + Cycle 9 exit ritual

Two new events: rangeSelectionChanged (fires start/mid/end of drag +
on programmatic mutation) + cellSelectionChanged (debounced — only
on finished change). Mirror ag-grid's split between "ranges are
changing" and "the user is done changing them".

Cycle 9 exit ritual: flips ~30 Area 12 rows to ✅ in FM, populates
the Cycle 9 worklog's Shipped + Status sections.

Cycle 9 / Task 7 + exit.
```

**Next session prompt** (final session of this cycle):

```
Read docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md
"Cycle 10 — Clipboard + context menu" and author the Cycle 10
worklog at docs/superpowers/plans/<YYYY-MM-DD>-canvasgrid-cycle-10-clipboard.md
following the same shape this worklog uses. Don't execute Cycle 10
tasks yet; just write the worklog.
```

---

## Shipped

_(Filled in at cycle exit — Task 7's exit ritual.)_

---

## Cycle 9 status

_(Filled in at cycle exit — Task 7's exit ritual. Replace this line
with `## Cycle 9 status: COMPLETE` + the 7-task closing checklist.)_
