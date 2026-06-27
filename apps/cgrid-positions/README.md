# cgrid-positions

Vanilla-TS demo of `cgrid` consuming the STOMP positions feed (same as the
AG Grid `apps/showcase`).

## Prereqs

- STOMP server at `localhost:8081` (see root README of the monorepo).

## Run

```bash
npm install
npm run dev:positions
```

Opens at http://localhost:5175.

## Totals row + pinned rows (Cycle 14)

The demo mounts the **pinned grand-totals row** at the bottom of the
grid body by default. Every column with an `aggFunc` declared on its
def — `notionalAmount` / `marketValue` / `currentPrice` / `pnl` /
`dailyPnl` / `unrealizedPnl` / `yield` / `spread` / `dv01` / `pv01` —
reads its computed total from the worker's `chunk.totals[colId]`.
Header cells render as `sum(Notional)` / `avg(Price)` etc. via the
default `suppressAggFuncInHeader: false`; the totals cells render
through the `'totals'` built-in renderer (right-aligned numerics,
+1 weight stop over body, em-dash for empty totals). No additional
worker round-trip per scroll — the row reads from the chunk the
data pass already emits.

URL flags opt into the per-cell variants the visual matrix baselines
(cells 17 / 18 / 19):

- `?totals=bottom` — bottom-pinned totals row (cell 17; matches the
  demo default).
- `?totals=top` — top-pinned totals row (header → totals → data band).
- `?totals=off` — opt OUT of the totals row entirely (recovers the
  pre-Cycle-14 body-only chrome for callers that need it).
- `?pinned=top` — mount a sample "Benchmark" reference row at the
  top of the body via `pinnedTopRowData` (cell 18 — warm tint, body
  weight; coexists with the totals row).
- `?pinned=bottom` / `?pinned=both` — same reference row at the
  bottom edge, or both edges, for smoke-testing the pinned + totals
  coexistence stack.
- `?suppressAggHeader=1` — flip `suppressAggFuncInHeader` to `true`
  so headers read as raw `Notional` / `Price` (cell 19 off variant).

The custom aggFunc registry ships through `CGridOptions.aggFuncs` +
the `setAggFuncs` worker message: register a named function once and
reference it from any column's `aggFunc` field (or use the array form
`aggFunc: ['p99', 'avg']` for an ordered fallback). The
`aggregationChanged` event fires on every recomputation tagged with a
`source` field (`'rowDataChanged' | 'filterChanged' | 'aggFuncChanged'
| 'columnAggFuncChanged' | 'pinnedRowDataChanged' | 'api'`) so apps
can subscribe without re-deriving totals locally. Cosmetic re-renders
(scroll / sort / theme) don't fire the event.

See `cycle-14-aggregation-design.md` for the design vocabulary every
piece inherits — the **lift** idiom (1px hairline above, 3% tint,
+1 weight stop) for the totals row, the **warm-tint, body-weight**
pinned-row chrome, and the **lowercase-verb + parens** header
decoration that lets the totals row's weight and the header's parens
bracket each agg column with two non-redundant cues.

## Status bar (Cycle 13)

The demo mounts the **status bar** at the bottom by default: the
`agAggregationComponent` sits in the **left zone** and hides itself
until you make a selection (then renders five inline stats —
`Count · Sum · Min · Max · Avg`); the **right zone** holds the
`agTotalAndFilteredRowCountComponent` (Total Rows + Rows) plus
`agSelectedRowCountComponent` (Selected: N). Make a range with the
mouse to wake the agg panel; clear it and the left zone goes quiet
again — the bar always reads as a right-loaded glance.

URL flags opt the demo into the per-cell variants the visual matrix
baselines (cells 14 / 15 / 16):

- `?statusBar=mounted` — empty bar, host chrome only (cell 14).
- `?statusBar=counts` — all four built-in count panels in the right
  zone: Total + Filtered + Selected + TotalAndFiltered (cell 15).
- `?statusBar=full` — same as the default (agg left + 2 counts
  right) for symmetry with the other flag values; cell 16 stages a
  10-row range so the agg panel renders.
- `?statusBar=customDemo` — the demo `DemoCustomStatusPanel` in the
  left zone + TotalAndFiltered in the right. Exercises the
  `CGridOptions.components` registration channel + the public
  `api.getStatusPanel(key)` lookup.

Status updates batch per rAF and never trigger a body-canvas repaint
— the bar is a DOM panel and the canvas is canvas, and they don't
talk. See `cycle-13-statusbar-design.md` for the design vocabulary
(sandwich tone via `--cg-header-bg`, ≈28 px height, type matching
the side-bar tab labels) every panel inherits.

## Visual regression (Cycle 12)

A pinned-Chromium, fixed-viewport Playwright suite under `e2e-visual/` diffs
the demo against committed PNG baselines so layout / overlay regressions fail
the merge gate before they reach the user. Run it from this package:

```bash
npm run test:visual
```

The harness starts (or reuses) the Vite dev server on port 5175 and uses a
1440×900 viewport at DPR 1 with the dark theme forced. Tolerance is
`maxDiffPixelRatio: 0.005` (0.5 % of pixels) at `threshold: 0.2` (per-pixel
BT.601 distance) so a few-pixel drift on a focus ring or a stray DOM element
in a pinned band fails the run. On the developer box the full matrix
finishes well under the 60 s CI budget:

```
> cgrid-positions@0.0.0 test:visual
> playwright test --config=playwright-visual.config.ts

Running 13 tests using 7 workers

  ✓ e2e-visual/_smoke.spec.ts:7:1 › demo mounts and exposes __cgrid hook
  ✓ e2e-visual/01-fresh-grid.spec.ts:8:1 › fresh grid — 50 rows, dark theme, no overlays
  ✓ e2e-visual/02-scrolled-vertical.spec.ts:12:1 › vertically scrolled grid — focus + body scroll past anchor row
  ✓ e2e-visual/03-scrolled-horizontal.spec.ts:10:1 › horizontally scrolled grid — center column under pinned-left band
  ✓ e2e-visual/04-editor-center-column.spec.ts:14:1 › editor open on center column (notionalAmount)
  ✓ e2e-visual/05-editor-pinned-column.spec.ts:9:1 › editor open on pinned-left column (cusip)
  ✓ e2e-visual/06-range-across-viewports.spec.ts:11:1 › range overlay across visible + non-visible rows
  ✓ e2e-visual/07-sidebar-columns-open.spec.ts:9:1 › side bar — Columns panel open on the right
  ✓ e2e-visual/08-sidebar-filters-open.spec.ts:8:1 › side bar — Filters panel open on the right
  ✓ e2e-visual/09-sidebar-position-left.spec.ts:11:1 › side bar — Columns panel open on the left
  ✓ e2e-visual/10-empty-grid.spec.ts:9:1 › empty grid — 0 rows, no phantom scrollbars
  ✓ e2e-visual/11-dense-grid-light-theme.spec.ts:13:1 › dense grid — 200 rows, Quartz light theme
  ✓ e2e-visual/12-context-menu-open.spec.ts:11:1 › context menu open on a body cell

  13 passed (1.9s)
```

To regenerate baselines after an intentional visual change, run:

```bash
npm run test:visual -- --update-snapshots
```

PRs that ship new or updated baselines MUST title themselves with the
`[visual-baseline-update]` marker so reviewers know to compare the regenerated
PNGs against the prior frame. Baselines live in
`apps/cgrid-positions/e2e-visual/__snapshots__/` and ship in git as binary
(`.gitattributes` enforces this).

## Clipboard + context menu (Cycle 10)

- **Right-click** any body cell — the cgrid context menu opens with the
  eight built-in items (Copy / Copy with Headers / Paste / Cut / Export /
  Autosize Columns / Pin Column ► / Reset Columns) plus a sample
  **Clear filters** entry the demo appends via `getContextMenuItems`.
- **Ctrl+C / Ctrl+X / Ctrl+V** copy / cut / paste the current cell range
  via the system clipboard. The TSV pass runs on the worker; the main
  thread does only `navigator.clipboard.writeText` / `readText`.
- **Clipboard format** dropdown in the toolbar (`TSV (tab)` / `CSV (,)` /
  `SSV (;)` / `Pipe`) drives `setGridOption('clipboardDelimiter', …)` so
  the next copy lands in that format. Default is TSV — pastes into Excel /
  Sheets as a grid; switch to CSV for log-style consumers.
- Round-trip demo: right-click → Copy → switch to a spreadsheet → Paste →
  values land in the same shape (RFC 4180 quoting handles embedded tabs /
  newlines / quotes).
