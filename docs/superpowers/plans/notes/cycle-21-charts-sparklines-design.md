# Cycle 21 — Charts + sparklines — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 21
**FM coverage:** Area 24 — ~25 of 30 rows
**Depends on:** Cycle 9 (range selection)

---

## Strategic decision (lifted from master plan)

| Layer | Tech | Size | Why |
|---|---|---|---|
| **Sparkline cell renderer** | Own-built micro-chart layer | < 10 KB gz | Tight integration with cell painter, allocation-free per frame, runs inside the canvas paint loop |
| **Range charting** | AG Charts integration (opt-in peer dep) | App brings it | Full charting requires real Charts library; reinventing it would dwarf cgrid |

**Pin:** Inline sparklines are HOT — must render at 60 fps with
thousands visible. AG Charts is great but its setup cost per chart
makes it wrong for inline cells. Custom micro-painters are
allocation-free and share the existing `CachedContext2D`.

---

## Task 1 — Sparkline base renderer + line variant

**Goal:** A registered cell renderer named `'sparkline'` that reads
`cellRendererParams.sparkline: { type: 'line', options: {...} }` and
an array value. Paints a min-max-normalized line spanning the cell
minus padding.

**File:** `renderer/cellRenderers/sparkline/lineSparkline.ts` (new).

**Painter algorithm (one pass, allocation-free):**

```typescript
function paintLineSparkline(gc: CachedContext2D, p: CellPaintConfig) {
  const data = p.value as number[];
  if (!data?.length) return;
  
  // Pin to cell bounds minus 2px inner padding
  const x0 = p.bounds.x + 2, y0 = p.bounds.y + 2;
  const w  = p.bounds.w - 4,  h = p.bounds.h - 4;
  
  // Single pass: compute min/max in same loop as path-building
  let min = data[0], max = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const range = max - min || 1;
  
  gc.cache.beginPath();
  gc.cache.strokeStyle = p.params?.lineColor ?? p.fg;
  gc.cache.lineWidth = 1;
  for (let i = 0; i < data.length; i++) {
    const x = x0 + (i / (data.length - 1)) * w;
    const y = y0 + (1 - (data[i] - min) / range) * h;
    if (i === 0) gc.moveTo(x, y);
    else gc.lineTo(x, y);
  }
  gc.cache.stroke();
}
```

---

## Task 2 — Column / area / bar / pie variants

**Goal:** Same registry-driven renderer, one painter per variant:

- `column` — vertical bars, one per data point.
- `area` — line + filled area below at translucent fill.
- `bar` — horizontal bars (rotated column).
- `pie` — single segment ring chart.

Each is an exported function in `renderer/cellRenderers/sparkline/`.
All share the painter contract (`(gc, p) => void`), all are
allocation-free, all read `p.params.sparkline.options` for color,
stroke width, fill, etc.

**Visual chrome — tokens:**

| Token | Light | Dark | Where |
|---|---|---|---|
| `--cg-sparkline-line` | `#2563eb` | `#60a5fa` | Default line stroke |
| `--cg-sparkline-fill` | `rgba(37,99,235,0.15)` | `rgba(96,165,250,0.2)` | Area fill, column fill |
| `--cg-sparkline-marker` | `#1d4ed8` | `#3b82f6` | High/low data point markers |
| `--cg-sparkline-axis` | `transparent` | `transparent` | Sparklines have NO axis chrome by default — they're glance targets |

---

## Task 3 — Sparkline tooltips

**Goal:** Hover-anchored tooltip showing the closest data point.

**Implementation:** New `SparklineTooltipOverlay` (DOM overlay,
single-instance pool) shared across all sparkline cells. On
mousemove inside a sparkline cell:

1. Compute the nearest data-point index from `event.offsetX` relative
   to cell bounds.
2. Position the tooltip at `event.clientX, event.clientY - 24px`.
3. Render `<index, value>` in the tooltip.

**File:** `interaction/features/sparklineTooltip.ts` (new).

**Lifecycle:** Tooltip is a single DOM element pooled at the grid
host — no per-cell DOM. Hide on `mouseleave` of the cell band.

---

## Task 4 — AG Charts integration scaffold

**Goal:** Opt-in peer dep for full range charts. App imports
AG Charts and passes it to cgrid; cgrid wires the bridge.

```typescript
import * as agCharts from 'ag-charts-community';

const grid = new CGrid(host, {
  chartingDependencies: { agCharts },
  // … enables Cycle-21 charts API
});
```

**File:** `interaction/charts/agChartsAdapter.ts` (new). The adapter
translates cgrid's `RangeChartParams` into an AG Charts options
object.

If `chartingDependencies` is absent, all charting APIs throw with
"Charts require providing chartingDependencies."

---

## Task 5 — Range chart API

```typescript
interface RangeChartParams {
  cellRange: { rows: [number, number]; columns: string[] };
  chartType: 'line' | 'column' | 'bar' | 'pie' | 'scatter' | 'area' | 'doughnut';
  chartContainer?: HTMLElement;    // app-provided host
  // If chartContainer is null, cgrid opens a popup window with the chart.
  chartThemeName?: string;
  suppressChartRanges?: boolean;   // hide the colored highlight range
  unlinkChart?: boolean;           // chart frozen even if data changes
  aggFunc?: string;
}

interface CGridApi {
  createRangeChart(params: RangeChartParams): ChartRef | null;
  getChartModels(): ChartModel[];
  getChartRef(chartId: string): ChartRef | null;
  restoreChart(model: ChartModel, host?: HTMLElement): ChartRef | null;
}
```

**File:** `interaction/charts/rangeChart.ts` (new).

**Chart range highlight:** While a chart is open and linked, the
chart's source range gets a colored translucent overlay
(extending Cycle 9's `rangeOverlayPainter`). Chart color matches
chart-series colors so users can read the link.

---

## Task 6 — Pivot chart

**Goal:** A special range-chart shape that consumes the pivot output
directly: pivot column headers become chart x-axis categories;
aggregated values become y-axis. Single API call:

```typescript
api.createPivotChart({ chartType, chartContainer? });
```

Requires `pivotMode: true` (Cycle 18). File:
`interaction/charts/pivotChart.ts` (new).

---

## Task 7 — Chart context menu items

**Goal:** Cycle 10's context menu gains a "Chart Range" submenu
when an active range exists.

Menu structure (per ag-grid parity):

- Chart Range
  - Column
  - Stacked Column
  - 100% Stacked Column
  - Bar
  - Line
  - Area
  - Pie
  - Scatter
  - Histogram (omitted — requires Charts enterprise)

Each item calls `createRangeChart({ chartType, … })` with the
current `cellRanges` from `SelectionModel`.

---

## Task 8 — Chart events

- `chartCreated` — `{ chartId, chartType, chartModel }`.
- `chartDestroyed` — `{ chartId }`.
- `chartOptionsChanged` — `{ chartId, chartOptions }`.
- `chartRangeSelectionChanged` — fires when the user drags the
  chart's range highlight in the grid; chart re-renders from the
  new range.

---

## Performance gates

- Sparkline cell paint ≤ 1 µs per cell amortized (1k visible
  sparklines @ 60 fps = 1 ms total chart-paint budget).
- Range chart construction ≤ 200 ms for 10k data points.
- Chart data-update on linked range change ≤ one frame (the chart
  re-renders incrementally via AG Charts' own animation budget).
- Sparkline tooltip mouse tracking does NOT trigger grid repaint
  (DOM-overlay positioning only).

---

## Exit criteria recap

- FM Area 24 ≥ 85 % ✅.
- Demo: sparkline column showing 60-day price history per ticker;
  context menu → Line chart on selected range.
- AG Charts integration verified with `ag-charts-community` 11+.
- All 5 sparkline variants render correctly in light + dark themes.
- Sparkline tooltip works without canvas repaint.
