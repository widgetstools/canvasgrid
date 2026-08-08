# Cycle 21 / Tasks 1-3 — Sparklines prompt

> Self-contained brief for a new session or agent. Open this file in
> your IDE → ⌘A → ⌘C to copy.

---

I want to implement the first three tasks of Cycle 21 (charts +
sparklines) for cgrid. The design lives at
`docs/superpowers/plans/notes/cycle-21-charts-sparklines-design.md` —
read that first. We are **only** doing Tasks 1, 2, 3 — Tasks 4-8
(AG Charts integration, range chart API, pivot chart, chart context
menu, chart events) are out of scope.

**Branch:** cut a fresh `feature/charting` branch off `main`. Commit
each task as it lands; merge to main at the end with `--no-ff`.

## Context

- cgrid is canvas-rendered. The cell renderer registry lives at
  `cgrid/src/renderer/cellRenderers/` and registers named renderers
  — Cycle 21 / Task 1 registers `'sparkline'`. Cell renderers paint
  directly into the shared `CachedContext2D` ("hot path";
  allocation-free per frame).
- Use TDD: failing test first, GREEN implementation, commit.
- The existing showcase pattern is at
  `apps/cgrid-showcase/src/features/`. Add a new feature page
  `sparkline.ts` that demonstrates each variant on synthetic 60-day
  price-history rows.

## Tasks

### 1. Line sparkline + base renderer

- New file
  `cgrid/src/renderer/cellRenderers/sparkline/lineSparkline.ts`.
- Register a `'sparkline'` cell renderer.
  `cellRendererParams.sparkline: { type: 'line', options?: { lineColor, lineWidth } }`.
- Value is `number[]`. Paint a min-max-normalized line spanning the
  cell minus 2px inner padding. Single pass: compute min/max in
  same loop as path-building (no extra allocations).
- Tokens: `--vg-sparkline-line` (default stroke),
  `--vg-sparkline-fill` (area fill).
- Tests: registration, painter renders correctly for ascending /
  descending / constant / empty / single-point data; per-frame
  allocation is zero (mock `gc.cache.beginPath` count and verify
  ≤ 1 per cell).
- Bench gate: 1k visible sparklines paint within the 16ms frame
  budget.

### 2. Column / area / bar / pie variants

- Sibling files under `cgrid/src/renderer/cellRenderers/sparkline/`:
  `columnSparkline.ts`, `areaSparkline.ts`, `barSparkline.ts`,
  `pieSparkline.ts`.
- Same registry-driven contract — `type: 'column' | 'area' | 'bar' | 'pie'`
  switches the painter.
- `column` = vertical bars; `area` = line + translucent fill;
  `bar` = horizontal bars (rotated column); `pie` = single segment
  ring chart.
- Each painter is `(gc, p) => void`, allocation-free, reads
  `options` for color / stroke / fill.
- Tests: one describe-block per variant; verify the painter
  dispatches via the `type` field and the right beginPath / moveTo
  / lineTo / rect / arc sequence fires for each.

### 3. Sparkline tooltips

- New file `cgrid/src/interaction/features/sparklineTooltip.ts`.
- DOM overlay (single-instance pool at the grid host — NO per-cell
  DOM). Hover-anchored tooltip showing the closest data point:
  compute the nearest index from `event.offsetX` relative to cell
  bounds, render `<index, value>`, position at
  `clientX, clientY - 24px`.
- Hide on `mouseleave` of the cell band.
- Tooltip mouse tracking must NOT trigger a canvas repaint
  (DOM-overlay positioning only).
- Tests: tooltip mounts when a sparkline cell is hovered;
  nearest-point index calculation is correct for several pointer
  positions; tooltip unmounts on `mouseleave`; verify no repaint
  scheduled during a mousemove.

## Showcase + demo (after Task 3)

- Add `apps/cgrid-showcase/src/features/sparkline.ts` registered in
  `features/index.ts`.
- Synthetic dataset: 8-10 tickers, each with a
  `priceHistory: number[]` of 60 random-walk values.
- Columns: Ticker, Last, Change, **Sparkline** (with
  `cellRenderer: 'sparkline'` and a row of toolbar buttons cycling
  type between `line / column / area / bar / pie`).
- Browser-verify hover tooltip works.

## Quality gates

- All cgrid tests pass (`npx vitest run` from `cgrid/`).
- Showcase `npm run typecheck` clean.
- Showcase E2E (`npx playwright test`) passes — add a new spec
  `e2e/sparkline.spec.ts` covering the toolbar variant cycle.
- Cgrid `npm run build` clean (no chunk-size blowups beyond the
  existing ~600KB).

**Commit cadence:** one commit per task plus one for the showcase
demo. Match the existing message style — e.g.
`feat(sparkline): Cycle 21 / Task 1 — line variant + base renderer`.

## Out of scope (do NOT touch)

- AG Charts integration (Task 4)
- Range chart API (Task 5)
- Pivot chart (Task 6)
- Chart context-menu items (Task 7)
- Chart events (Task 8)

When all three tasks + the demo are green: push the branch, merge
`--no-ff` into main, push main, delete `feature/charting` local +
origin (same pattern as Cycle 20).
