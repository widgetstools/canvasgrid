# Cell renderer catalog — 40 renderers for financial blotters (research + design doc)

**Status:** research synthesis + design doc. Catalog locked 2026-07-01. Implementation ships as `@wellsfargo-starui/velocity-grid-renderers` — a 10th package added to Cycle 21.
**Author:** Anand (via Claude)
**Date:** 2026-07-01
**Depends on:** Cycle 21 modular monorepo split; consumes format Tier 2 (composite cells), expression engine (contextual colour), calc (column-wide statistics), kernel (paint + tick semantics + icon registry).
**Related plans:**
- [Cycle 21 modular monorepo + intrinsic features](2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) — the package split this catalog extends
- [Cycle 20 Excel Pivot Grid](2026-07-01-canvasgrid-cycle-20-excel-pivot-parity.md) — consumes renderers via `@wellsfargo-starui/velocity-grid-renderers`

**Research sources:** two parallel research streams (2026-07-01) — competitor grid renderer catalogs (11 libraries: AG-Grid, Handsontable, Bryntum, Kendo, DevExtreme, Slickgrid-Universal, PrimeReact, TanStack, Perspective, Syncfusion, Glide) and financial blotter domain patterns (Bloomberg Terminal, Refinitiv Workspace, Trumid, MarketAxess X-Pro, Fidessa, TradingView, AG Grid finance demo, Bookmap, Proof Trading case study).

---

## 0. Core principle — composite + contextual + tick-aware

Base grid libraries treat "one scalar per cell" as canonical. AG-Grid Enterprise (sparklines, animate-show-change) and Perspective (heat cells, signed bars, pulse background) are the exceptions — but even they don't cover the composite space. Professional blotters live in three axes those libraries leave to userland templates:

- **Composite** — multiple values per cell (bid/ask paired, ticker+CUSIP stacked, price+arrow+delta+pct)
- **Contextual** — colour/size driven by column-wide statistics (heat cells), benchmarks (spread bars), or age (freshness dots)
- **Tick-aware** — flash background, inline arrow, pulse — every professional blotter has this and it must be intrinsic

Cgrid ships all three axes intrinsically via `@wellsfargo-starui/velocity-grid-renderers`. The Cycle 21 architecture (worker-only style channel, composite column type, format DSL, expression engine) already carries the right shapes; this catalog formalises the 40 renderers that fill the gap.

---

## 1. Aesthetic bar — non-negotiable across every renderer

Every renderer conforms to these. Individual entries may add specifics but never violate:

- **Density** — 22–28px row heights, 4–8px vertical padding, 8–12px horizontal. Anything ≥40px reads as consumer app.
- **Typography** — tabular figures via `font-feature-settings: 'tnum'`. 11–13px body, 10–11px caps headers. Recommended: Inter, IBM Plex Sans + Plex Mono, or JetBrains Mono. Bloomberg Terminal font is licensed; do not use.
- **Alignment** — numbers right; text left; icons/badges centred. Non-negotiable — centred numbers read as broken.
- **Colour** — 80% muted grays. Semantic colour reserved for signal:
  - Green (`#0aa063` at various α) above prior close / positive P&L / tick up
  - Red (`#e63946`) below prior close / negative P&L / tick down
  - Amber (`#f0b429`) for warning (widening spread, aging order, stale quote)
  - Cyan/blue (`#3b82f6`) for informational (working orders, `WORKING` state)
  - Currency symbols muted (~70% opacity)
  - Never both parentheses AND red for negatives — pick one
- **Motion** — tick flash = 500ms saturated + 1000ms fade, no easing that "feels animated." Aging counters tick discretely (1s), not smoothly. Sparklines redraw, do not animate. No animation slower than 200ms (sluggish) or faster than 100ms (strobes when many cells update).
- **Chrome** — 5–10% opacity horizontal separators only; no vertical grid lines except at frozen boundaries. No shadows, gradients, rounded row corners. Hover: 4–6% white overlay. Selection: 8–12% brand-accent overlay + 2px left-edge bar.

---

## 2. Category overview

Forty renderers across eight categories. Tier indicators (T1/T2/T3) reflect research-stage priority — all 40 ship in `@wellsfargo-starui/velocity-grid-renderers` per user decision.

| Category | Count | Depends on |
|---|---|---|
| Numeric (tick-aware) | 9 | kernel, format, expression |
| Text / identity | 5 | kernel, format |
| Indicators (semantic glyphs) | 6 | kernel, Lucide icons |
| Badges / pills | 7 | kernel, format |
| Bars / gauges | 8 | kernel, format, calc (HeatCell, SpreadBarCell need column-wide stats) |
| In-cell charts | 7 | kernel, expression (for windowed data) |
| Composite | 5 | format Tier 2, expression |
| Action | 2 | kernel |

---

## 3. The catalog

Format for each entry: **Name** (tier) — purpose. Visual description. Config sketch where non-obvious. Dependencies noted where they exceed the category default.

### 3.1 Numeric (tick-aware) — 9 renderers

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **NumberCell** | T1 | General-purpose numeric, precision + sign policy | Tabular figures, right-aligned, format-string-driven precision; currency prefix/suffix at 70% opacity |
| **PriceCell** | T1 | Ticking price with flash background | NumberCell base; on tick up flashes `#0aa063 @ 25% α` 500ms then fades 1000ms; red on tick down; no flash unchanged |
| **PriceDirectionCell** | T1 | Ticking price with inline arrow, coloured foreground | Lucide `trending-up` / `trending-down` / `minus` Path2D glyph inline; number foreground colour matches; used in dense columns where background flash would strobe |
| **PnlCell** | T1 | Signed currency P&L | Right-aligned tabular currency; red foreground negative / green positive; currency symbol muted; sign always shown |
| **DeltaCell** | T1 | Absolute + percentage change composite | `+0.42 (+1.18%)` in one cell; both values coloured together; percentage slightly muted (~85% opacity) |
| **BpsCell** | T1 | Basis points, always signed | Right-aligned integer `+12` / `-185`; colour vs zero or configured benchmark; `bps` suffix muted; used everywhere in fixed-income spreads |
| **PctChangeCell** | T1 | Signed percentage | `+1.18%` two-decimal default; green/red foreground; sign always shown |
| **FractionalPriceCell** | T2 | Treasury 32nds/64ths convention | `99-16+` renders as "99 and 16.5/32nds"; `+` denotes half-32nd; bond desks read this natively |
| **AbbreviatedNumberCell** | T1 | K/M/B/T magnitude suffix | `1.2M`, `450K`, `$3.4B`; precision configurable per magnitude; uses format DSL Tier 0 magnitude suffix |

### 3.2 Text / identity — 5 renderers

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **TickerCell** | T1 | Symbol + secondary label | Bold primary (13px), muted secondary line below (11px, ~65% opacity); never abbreviate ticker |
| **CurrencyPairCell** | T2 | FX pair + mono-spaced rate | `EUR/USD  1.0834`; optional flag glyphs; pair in smaller font; rate in mono |
| **TimestampCell** | T1 | Time-of-day right-aligned | `HH:MM:SS.mmm`; muted date prefix if not today; mono |
| **AgeCell** | T1 | Live-updating elapsed seconds | `00:04` → `03:12`; neutral <30s, amber <5m, red ≥5m; ticks every 1s discretely |
| **RelativeTimeCell** | T2 | Human-readable relative time | `"3m ago"`, `"just now"`; refreshes every 1s up to 60s, then 1m intervals |

### 3.3 Indicators (semantic glyphs) — 6 renderers

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **StatusDot** | T1 | 8px filled circle in semantic colour | Optional label after dot; used for connection/health/session state |
| **QuoteQualityDot** | T2 | Fresh/tight/deep quality indicator | Green fresh+tight+deep / amber thin+wide / red stale+one-sided |
| **StaleFlag** | T1 | Aged-data indicator | Cell drops to 60% opacity + inline icon; tooltip shows `"last tick 8s ago"` |
| **DirectionArrow** | T1 | Standalone ▲/▼/▬ | Used inside composites; Lucide Path2D; coloured per direction |
| **StructureIconStrip** | T2 | Fixed-income feature icons | Inline row of monochrome 12–16px icons (callable, puttable, sinker, floater, step-up, make-whole); tinted amber/blue when active; hover tooltip |
| **TrafficLightCell** | T2 | Three-state RAG dot | 8px filled circle green/amber/red for risk-limit / margin / credit-line state |

### 3.4 Badges / pills — 7 renderers

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **StatusPill** | T1 | Order/state label with semantic colour | 2–4px radius pill, 10–11px caps text; `WORKING` cyan, `PART FILL` amber, `FILLED` green, `CANCELLED` grey, `REJECTED` red on white, `PENDING` grey dashed border |
| **RatingBadge** | T2 | Single agency rating | Small badge; colour-graded AAA green → D red; IG/HY split at BBB-/Baa3 (junk gets orange/red tint); NR/WD muted grey; text labels only (no proprietary logos) |
| **RatingClusterCell** | T2 | S&P / Moody's / Fitch cluster | Three RatingBadges side-by-side (`AAA / Aa1 / AA`); tight spacing; agency name muted below each in nano text (optional) |
| **TagCell** | T1 | Generic muted-grey tag | `144A`, `TRACE`, `DELAYED`, `AXE`, arbitrary text |
| **VenueChip** | T2 | Execution venue MIC | Coloured chip: `XNAS`, `ARCX`, `BATS`, `EDGX`; venue-specific palette |
| **SideChip** | T2 | Long/short single-char | `L` green background / `S` red background; 14–16px square |
| **TimeInForcePill** | T2 | Order TIF label | `DAY`, `GTC`, `IOC`, `FOK` colour-coded; hover tooltip expands abbreviation |

### 3.5 Bars / gauges — 8 renderers

| Renderer | Tier | Purpose | Visual | Deps |
|---|---|---|---|---|
| **ProgressBarCell** | T1 | 0–100% fill (order fill ratio) | Horizontal fill bar, text overlaid; neutral grey track, green fill at 100% | kernel |
| **RangeBarCell** | T2 | Position within a range | Horizontal bar with two endpoint labels; marker dot shows current position (52w range, day range) | kernel |
| **BidirectionalBarCell** | T1 | Centre-zero left-red / right-green | Position size or P&L across visible rows; extends left (short/negative) red, right (long/positive) green; bar width proportional to `abs(value) / max(abs)` in scope | kernel, calc (scope max) |
| **HeatCell** | T1 | Column-wide gradient background | Full-cell background tint; darkest for extreme values in the column's range; interpolated for middle values; classic heat map | calc (column-wide value range) |
| **GaugeCell** | T2 | Segmented gauge with tick marker | Horizontal segmented gauge (e.g. `-20bps / 0 / +20bps` zones); coloured tick shows current value; used for implementation shortfall, default probability | kernel |
| **SpreadBarCell** | T2 | Bid/ask spread-width indicator | Thin bar behind mid price; wider bar as bid/ask spread widens; amber at 1σ, red at 2σ vs rolling average | calc (rolling stats) |
| **VolumeBar** | T2 | Full-cell horizontal bar for volume | Bar sized to `volume / max(volume)` in scope; text overlays with reverse-out colour | calc (scope max) |
| **MaturityLadderBar** | T3 | Fixed-income tenor bucket bar | Full-cell segmented bar by tenor bucket (0-1y, 1-3y, 3-5y, 5-10y, 10y+); segment widths = notional at each bucket | calc |

### 3.6 In-cell charts / sparklines — 7 renderers

All sparklines: no axes, no labels, single stroke, last-point optional dot. Redraw on data change (no animation).

| Renderer | Tier | Purpose | Visual | Deps |
|---|---|---|---|---|
| **LineSparkline** | T1 | Trend line, ~30–120 points | Thin polyline left-to-right; optional first/last/min/max highlight dots; stroke colour by trend direction | expression (windowed data) |
| **AreaSparkline** | T1 | Filled trend for cumulative curves | Line + semi-transparent fill below; used for running P&L, cumulative volume | expression |
| **BarSparkline** | T1 | Column bars per period | Discrete bars, gap between each; positive/negative split at zero line; used for daily volume, per-minute trades | expression |
| **WinLossSparkline** | T3 | Binary up/down bars | 1px-wide bars, all same height; up green above zero-line, down red below; used for daily P&L strings | expression |
| **YieldCurveSparkline** | T2 | Multi-tenor yield curve | 6-point line with tenor labels below (`2y 5y 10y 30y`); marker dot on the bond's own tenor; axis is tenor not time | expression, format |
| **KRDBarChart** | T3 | Key-rate duration grouped bars | Micro histogram per tenor bucket (2y/5y/10y/30y bars); bp-per-tenor sensitivity | expression |
| **DepthLadderCell** | T2 | Mini order book (3–5 levels) | Vertical mini-ladder; bid volumes left (red bars, right-aligned) / ask right (green bars, left-aligned); sizes on outer edges; prices centre | kernel |

### 3.7 Composite (multi-value) — 5 renderers

The category where cgrid has the biggest differentiation opportunity. All are impossible without composite column support. Cycle 21 §5 Tier 2 formatting DSL handles them natively via the fragments array.

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **StackedValueCell** | T1 | Primary + muted secondary | Top: primary right-aligned. Bottom: secondary ~85% muted. Two-line stack per row. |
| **PriceQuoteCell** | T1 | Bid / ask / mid with spread indicator | Bid left, ask right, mid centred below in muted; SpreadBarCell behind mid; amber tag when spread beyond threshold |
| **NBBOCell** | T2 | Consolidated top-of-book quote | `bid × bid_size @venue │ ask × ask_size @venue` mono-spaced; venue as VenueChip inline |
| **BenchmarkSpreadCell** | T2 | Bps + benchmark tag | `+185 vs T 4.25 05/34`; bps in BpsCell colour; benchmark tag muted TagCell |
| **PriceChangeComposite** | T1 | Price + arrow + abs delta + pct delta | `234.56  ▲ +2.34 (+1.02%)`; arrow + all deltas share colour |

### 3.8 Action — 2 renderers

| Renderer | Tier | Purpose | Visual |
|---|---|---|---|
| **IconActionCluster** | T1 | Hover-revealed right-aligned icons | Cluster of Lucide icons (cancel, replace, drill, route, split); appears on row hover; button hit targets ≥24×24 |
| **RowMenuCell** | T1 | Kebab → context menu | 20×20 kebab icon (three-dot vertical); opens context menu on click |

---

## 4. Composite case studies — using the format DSL

Three concrete examples showing how the format DSL (Cycle 21 §5) drives composite renderers. These illustrate that the composite renderers above are *configurations*, not new column types — the same shape supports arbitrary bespoke composites.

### PriceChangeComposite in equities watchlist

```ts
{
  colId: 'lastPriceChange',
  type: 'composite',
  fragments: [
    { expr: '[last]',                format: '#,##0.00',                    style: { weight: 'bold', color: 'rule:priceColor' } },
    { text: '  ' },
    { expr: '[change]',              format: '[Green]{icon:trending-up}+0.00;[Red]{icon:trending-down}-0.00' },
    { text: ' (' },
    { expr: '[change]/[prevClose]',  format: '[Green]+0.00%;[Red]-0.00%' },
    { text: ')' }
  ],
  cellBackground: 'rule:priceBg'   // tick-flash driven by rule engine
}
```

Result: `234.56  ▲ +2.34 (+1.02%)` — coloured together, background flashes on tick.

### BenchmarkSpreadCell in fixed-income blotter

```ts
{
  colId: 'spreadToBenchmark',
  type: 'composite',
  fragments: [
    { expr: '[gspread]', format: '[Green]+0;[Red]-0" bps"',   style: { weight: 'bold' } },
    { text: '  vs  ' },
    { expr: '[benchmarkTicker]',                                style: { color: 'muted' } }
  ]
}
```

Result: `+185 bps  vs  T 4.25 05/34`.

### TickerCell with CUSIP

```ts
{
  colId: 'security',
  type: 'composite',
  align: 'left',
  fragments: [
    { expr: '[symbol]',              style: { weight: 'bold', size: 13 } },
    { text: '\n' },   // note: single-line only per Q3a resolved — this example uses stacked-value column layout instead
    { expr: '[cusip]',               style: { color: 'muted', size: 11 } }
  ]
}
```

Actually — per Q3.a resolution in Cycle 21 (single line only), stacked-value uses the **StackedValueCell** shape which is a two-slot column def variant, not a `\n` in fragments. Correct form:

```ts
{
  colId: 'security',
  type: 'stacked-value',
  primaryExpr: '[symbol]',
  primaryStyle: { weight: 'bold', size: 13 },
  secondaryExpr: '[cusip]',
  secondaryStyle: { color: 'muted', size: 11 }
}
```

Row height accommodates the two-line stack; other columns in the same row stay single-line and centre-align vertically.

---

## 5. Package placement — `@wellsfargo-starui/velocity-grid-renderers` (10th package)

`@wellsfargo-starui/velocity-grid-renderers` is added to Cycle 21's package inventory as the 10th package. Base renderers (text, number, boolean, checkbox, image, hyperlink, custom-registration) stay in `@wellsfargo-starui/velocity-grid`; all rich renderers in this catalog live in `@wellsfargo-starui/velocity-grid-renderers`.

Rationale:
- Plain-grid consumers skip the finance-specific bundle.
- Tree-shaking works: consumers import only the renderers they use.
- Aligns with Cycle 21 L2 (multiple packages for modularity + efficiency).

Dependency layer (updates Cycle 21 §3.2 dep graph):

```
renderers → kernel, expression, format, calc, rules
```

Cycle 21 § should be updated to reflect this addition. See §7 for the sequencing update.

---

## 6. What we intentionally do NOT ship

- **Emoji indicators** — replaced by Path2D Lucide/Phosphor glyphs per Cycle 21 L8.
- **DOM overlay renderers** — canvas-only per Cycle 21 L7 / L8.
- **Retail chunky rows** — density bar in §1 is non-negotiable.
- **Bootstrap-style rounded pills with 12px radius** — professional pills use 2–4px radius.
- **Rating agency proprietary logos** — licence risk; badges use text labels only.
- **Bloomberg Terminal proprietary font** — licence risk; recommend IBM Plex, Inter, or JetBrains Mono.
- **Rich media in cells** (videos, animated GIFs) — outside professional aesthetic and paint budget.
- **Wrapping / multi-line composite cells** — single line only per Cycle 21 Q3.a resolution.

---

## 7. Sequencing within Cycle 21

Cycle 21 currently sequences packages: expression → format → rules → calc → edit → export → customizer, followed by Cycle 20 as capstone. `@wellsfargo-starui/velocity-grid-renderers` slots between `@wellsfargo-starui/velocity-grid-calc` and `@wellsfargo-starui/velocity-grid-edit`:

**Updated Phase 2 order:**

1. `@wellsfargo-starui/velocity-grid-expression`
2. `@wellsfargo-starui/velocity-grid-format`
3. `@wellsfargo-starui/velocity-grid-rules`
4. `@wellsfargo-starui/velocity-grid-calc`
5. **`@wellsfargo-starui/velocity-grid-renderers`** — depends on kernel + expression + format + calc + rules; delivers the 40 renderers
6. `@wellsfargo-starui/velocity-grid-edit`
7. `@wellsfargo-starui/velocity-grid-export`
8. `@wellsfargo-starui/velocity-grid-customizer`

Then Phase 3 Cycle 20 (`@wellsfargo-starui/velocity-grid-excel-pivot`) as capstone.

Renderers can start when calc is landed (its dependency); can partially run in parallel with `@wellsfargo-starui/velocity-grid-edit` since they don't share code. Numeric + text + indicator + badge categories don't depend on calc — those can start earlier if useful.

Estimated: 2 cycles worth of work (~4 weeks). Category order for feature landing:
- Cycle 21e-i: numeric + text + indicator + badge + action (foundation)
- Cycle 21e-ii: bars + gauges + heat cell (needs calc)
- Cycle 21e-iii: sparklines + curve variants (needs expression windowed data)
- Cycle 21e-iv: composite renderers (needs format Tier 2)

---

## 8. Open questions

None blocking. All catalog scope, package placement, and coverage confirmed by user 2026-07-01.

Deferred to implementation cycles:
- Exact colour tokens (hex values) for the professional palette — decide during design-token pass ahead of Cycle 21e-i.
- Icon set final selection within Lucide + Phosphor (which specific glyphs represent callable / puttable / sinker etc. in StructureIconStrip).
- HeatCell colour interpolation curve (linear vs perceptual-uniform) — LAB-space interpolation recommended.
- Text rendering strategy for tabular figures (font loading, CDN vs bundled, WOFF2 subset).

---

## Summary

Forty renderers across eight categories, filling the gap left by base grid libraries in composite + contextual + tick-aware cell rendering. Ships as new `@wellsfargo-starui/velocity-grid-renderers` package (10th in Cycle 21 split), between `@wellsfargo-starui/velocity-grid-calc` and `@wellsfargo-starui/velocity-grid-edit` in sequence. Aesthetic bar set by Bloomberg/Refinitiv/Trumid professional convention: dense rows, tabular figures, restrained motion, muted grays with semantic colour reserved for signal. Composite renderers use the format DSL Tier 2 already spec'd in Cycle 21 §5 — the catalog is the payoff of the architecture.
