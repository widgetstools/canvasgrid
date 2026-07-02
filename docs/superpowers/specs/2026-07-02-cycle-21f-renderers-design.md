# Cycle 21f — `@cgrid/renderers` (40 Rich Blotter Cell Renderers) — Design

**Date:** 2026-07-02
**Parent brief:** [Cycle 21 decision doc](../plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §4 renderers rows
**Authoritative catalog:** `docs/superpowers/plans/2026-07-01-canvasgrid-cell-renderer-catalog.md` (the 40-renderer spec — every renderer's visual contract lives THERE; this spec governs architecture only)
**Recon:** `scratchpad/recon-21f-renderers.md` (session artifact; catalog tables extracted + kernel surface inventory)
**Depends on:** kernel (registry, icons, flash, rule indicators — all landed), `@cgrid/format` (Tier-2 composite), `@cgrid/expression` + `@cgrid/calc` (peers; see §2.3 — NOT runtime deps this cycle)
**Baselines (main @ `b055115`):** kernel `2568`, calc `215`, rules `144`, format `171`, expression `185`; showcase E2E `131`; typecheck 21/21; build 13/13.

---

## §1 Scope & non-goals

### 1.1 In scope — all 40 catalog renderers, one cycle (no deferral)

By category (unique implementations; catalog composite rows reuse other painters):
1. **Numeric (9):** NumberCell, PriceCell, PriceDirectionCell, PnlCell, DeltaCell, BpsCell, PctChangeCell, FractionalPriceCell, AbbreviatedNumberCell.
2. **Text/identity (5):** TickerCell (stacked two-line), CurrencyPairCell, TimestampCell, AgeCell, RelativeTimeCell.
3. **Indicators (6):** StatusDot, QuoteQualityDot, StaleFlag, DirectionArrow, StructureIconStrip, TrafficLightCell.
4. **Badges/pills (7):** StatusPill, RatingBadge, RatingClusterCell, TagCell, VenueChip, SideChip, TimeInForcePill.
5. **Bars/gauges (8):** ProgressBarCell, RangeBarCell, BidirectionalBarCell, HeatCell, GaugeCell, SpreadBarCell, VolumeBar, MaturityLadderBar.
6. **In-cell charts (4 new; 5 exist):** WinLossSparkline, YieldCurveSparkline, KRDBarChart, DepthLadderCell (line/column/area/bar/pie sparklines already ship in kernel — 21f re-exports them by name for discoverability, zero duplication).
7. **Composite (5):** StackedValueCell, PriceQuoteCell, NBBOCell, BenchmarkSpreadCell, PriceChangeComposite — format-Tier-2 configurations + dedicated painters where the catalog demands layout the composite painter can't express (stacked two-line).
8. **Action (2):** IconActionCluster, RowMenuCell.

Plus the two data helpers (§2.4), the bridge (§2.5), showcase demo pages + E2E, README.

### 1.2 Non-goals

- **Kernel changes: NONE.** Every renderer is a `CellPainter` registered through the existing public registry; `CellPaintConfig` already carries params/rowData/rowId/themeKind/flashAlpha/flashColor/ruleIndicator/icons. The gates verify `git diff main...HEAD -- packages/kernel` is EMPTY. If an implementer discovers a genuine kernel need, STOP and escalate (no-retroactive-layering says the kernel gets the real feature — but that's a coordinator decision, not a task-level patch).
- **Worker-side windowed aggregates / rolling stats** — remain the 21d-reserved follow-up. SpreadBarCell's rolling σ uses the TickHistory collector (§2.4b) main-side.
- **Customizer renderer-picker UI** — 21i.
- **Editing interactions beyond click routing** (cancel/replace order semantics behind IconActionCluster are host callbacks — cgrid ships the painter + hit routing only).

---

## §2 Architecture

### 2.1 Package layout

```
packages/renderers/src/
  types.ts              — shared param interfaces (every renderer's params type, exact per catalog)
  paintUtils.ts         — shared helpers: pill(), dot(), miniBar(), fragText(), semantic color resolution, LAB interpolation
  palette.ts            — semantic color tokens resolved from theme fg/bg + catalog defaults (status maps, rating scale, venue map, RAG)
  numeric.ts            — category 1 painters
  text.ts               — category 2 painters (incl. stacked two-line layout)
  indicators.ts         — category 3
  badges.ts             — category 4
  bars.ts               — category 5 (LAB heat interpolation lives in paintUtils)
  charts.ts             — category 6 (new 4; re-export kernel's 5 by canonical names)
  composite.ts          — category 7 (format-DSL builders + StackedValue painter)
  actions.ts            — category 8 (+ hit-region registry for click routing)
  columnStats.ts        — §2.4a main-side incremental column stats
  tickHistory.ts        — §2.4b main-side rolling per-cell history
  bridge.ts             — wireIntoKernel(grid, opts?) (§2.5)
  index.ts
```

Deps: `@cgrid/format` (composite builders emit CompositeColDef shapes; type + compile validation). `@cgrid/kernel` peerDep (bridge registration only; painters import NOTHING from kernel at runtime — they receive gc + config; the CellPainter/CellPaintConfig types come via kernel type-only imports, erased at compile time, matching the format/rules precedent). `@cgrid/expression`/`@cgrid/calc`: NOT dependencies this cycle (windows/stats are main-side helpers); the catalog's "consumes calc's aggregate cache" upgrade is a follow-up once worker windowed aggregates land.

### 2.2 Painter discipline (binds every renderer task)

- Pure `CellPainter.paint(gc, p)` — stateless; per-column config via `p.params` (typed interfaces in types.ts); NO allocation on the hot path beyond what the existing painters do (no per-paint arrays/objects/closures; reuse module-scope scratch).
- Colors resolve theme-aware: read `p.fg`/`p.bg`/`p.themeKind`, fall back to catalog defaults from palette.ts; every hardcoded color must be a palette.ts token (single source).
- Tick flash: read `p.flashAlpha`/`p.flashFromColor` (PriceCell's green/red directional flash uses the 21e per-call flash color channel when the host wires rules, else derives direction from params-declared prev field — exact contract per catalog row 2).
- Icons: kernel icon registry via the same Path2D mechanics as 21c/21e (Lucide bundle names; StructureIconStrip's fixed-income glyph map is a params-overridable table in palette.ts).
- Text metrics: `gc.measureText`; fonts composed like `composite.ts`'s fragFont precedent.
- Tests: fake-gc harness (compositeRenderer.test.ts precedent) asserting draw-call sequences (fillText/fillRect/stroke args), not pixels.

### 2.3 Data contracts

- **Multi-field renderers** (DeltaCell, PriceQuoteCell, DepthLadderCell, RatingClusterCell…) read named fields from `p.rowData` per params field-mapping (`{ bidField: 'bid', ... }`) — rowData is already threaded for composite columns; these renderers require `type:'composite'`-style threading? NO — rowData threads only when `_compositeProgram` set. LOCKED SOLUTION: multi-field renderers are registered through the bridge's `colDef()` builders which emit a ColDef carrying a MINIMAL Tier-2 composite program (single synthetic fragment) so the kernel threads rowData/rowId/themeKind, while the painter ignores the program and paints natively. This uses only landed kernel mechanics. Single-value renderers read `p.value`/`p.valueFormatted` as usual.
- **Sparkline family:** cell value IS the array (host-fed; existing kernel mechanic), or the TickHistory collector supplies it via a valueGetter the bridge builder installs.

### 2.4 Main-side data helpers (plain classes, Date-free, engine-style tested)

a) **ColumnStats** — incremental min/max/maxAbs/sum/count per watched column over the full row set; seeded by `grid.forEachRow`, updated from `rowsChanged` (the 21e listener-gated event); exposed to painters through params closure (`heatCell.params.stats = stats.for('pnl')` — the bridge builders wire this). Scope = all rows (documented; 'visible' scope is a follow-up needing a visible-set feed). Removal handling per 21e/21d capture patterns.
b) **TickHistory** — bounded ring buffers per (rowId, colId) for opted-in columns (`window` size per column, default 60); fed by rowsChanged/cellValueChanged; supplies arrays to sparkline/spread renderers; O(1) push, evicts on row removal; memory documented (window × rows × 8B).

### 2.5 Bridge — `wireRenderersIntoKernel(grid, opts?)`

Registers all 40 painters by canonical names (`'price'`, `'heat'`, `'status-pill'`, … full name table in types.ts); instantiates ColumnStats/TickHistory lazily (only when a builder needs them); wires the 1s repaint interval ONLY when AgeCell/RelativeTimeCell registered on a column (gated, cleared on destroy via the event unsubscribe pattern); installs the action-click router (maps `cellClicked` events + painter-registered hit regions to params callbacks; kebab menu opens through the kernel's existing context-menu surface if public, else host callback — verify at plan time). Returns `{ stats, history, colDef }` where `colDef` is the typed builder namespace (`colDef.price('px')`, `colDef.priceQuote({bid,ask,mid})` → ready ColDef objects). Idempotent (`__renderersBridgeWired`).

### 2.6 Locked design decisions

1. Zero kernel diff (§1.2) — escalate, never patch.
2. HeatCell: LAB-space interpolation default, `curve: 'linear'` opt-out.
3. Stats/windows main-side (ColumnStats/TickHistory); worker windowed aggregates stay reserved.
4. Multi-field threading via minimal composite program (§2.3) — no new kernel channel.
5. Kernel's 5 existing sparklines re-exported, not duplicated; new charts follow their file conventions.
6. StructureIconStrip glyph map (params-overridable defaults): callable→`bell-ring`, puttable→`corner-down-left`, sinker→`anchor`, floater→`waves`, step-up→`trending-up`, make-whole→`shield-check`.
7. Palette defaults per catalog (§1 aesthetic bar): flash 500ms sat + 1000ms fade; pills 2-4px radius 10-11px caps; hit targets ≥24px.
8. Action callbacks are host functions in params; renderers never mutate data.
9. Grammar/vocabulary/serialization constraints inherited from 21d/21e (colId vocabulary; Date-free engines — Age/RelativeTime take injectable now in the helper layer, painters read a per-paint `nowMs` param threaded by the bridge's repaint tick).

## §3 Testing + gates

- Painter unit tests per category (fake-gc draw-sequence assertions; every renderer ≥3 cases: nominal, edge (null/missing fields), theme-dark variant).
- Helper engine tests: ColumnStats incremental parity vs recompute; TickHistory ring/eviction (seeded streams).
- Bridge tests: registration table complete (40 names), builders emit valid ColDefs (format compile passes for composite builders), gated repaint timer, idempotency, destroy cleanup.
- Showcase: TWO feature pages (blotter-numeric+indicators+badges+actions; charts+bars+composites over ticking data) + E2E (≥10 new; baseline 131 preserved).
- Gates: typecheck/lint/build; renderers suite; kernel 2568 UNTOUCHED (`git diff main...HEAD -- packages/kernel` empty) + calc/rules/format/expression untouched; E2E 131+new; no raw NULs; renderers package size logged.

## §4 Risks

| Risk | Mitigation |
|---|---|
| 40 renderers → visual drift from catalog | Catalog rows quoted VERBATIM in each task brief; reviewer checks draw-sequence against the row's visual contract |
| Hot-path allocation across 40 painters | Painter discipline §2.2 + reviewer allocation probes per category task |
| Action hit-testing fragility | Hit regions derive from the same bounds math as paint; router tests with synthetic click events |
| Minimal-composite threading surprises | One dedicated task proves the threading end-to-end before category tasks rely on it |
| 1s repaint timer leaks | Gated on usage, cleared on destroy, tested |
