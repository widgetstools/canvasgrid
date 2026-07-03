// @cgrid/renderers — canonical renderer name table + public param types.
// Authoritative references:
//   docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md §2.5 (name table),
//     §2.6 locked decisions (§2.6.6 structure glyph map, §2.6.7 palette defaults)
//   docs/superpowers/plans/2026-07-01-canvasgrid-cell-renderer-catalog.md §3.1-3.8
//     (per-renderer visual contracts — every interface below cites its catalog row)
//
// Vocabulary: `colId` never `columnId` (21d/21e convention, §2.6.9). No Date.now()/
// new Date() in this package's src — time-sensitive renderers (AgeCell, RelativeTimeCell,
// StaleFlag) take an injected `nowMs` (NowMsParam) threaded by the bridge's gated 1s
// repaint tick (§2.5); they never read the wall clock themselves.

import type { ColumnStatSnapshot } from './columnStats';

// ─── Name table ─────────────────────────────────────────────────────────────

/**
 * Every canonical `cellRenderer` name `@cgrid/renderers` registers. 46 new
 * implementations (catalog §3.1-3.8) + 5 re-exports of kernel's existing
 * sparkline family (line/column/area/bar/pie — catalog §3.6; already shipped,
 * re-exported here for discoverability, zero duplication — §2.6.5). The actual
 * re-export wiring lands in a later task; this task only reserves the names.
 */
export const RENDERER_NAMES = [
  // 1. Numeric (tick-aware) — 9 — catalog §3.1
  'number', 'price', 'price-direction', 'pnl', 'delta', 'bps', 'pct-change',
  'fractional-price', 'abbreviated-number',
  // 2. Text / identity — 5 — catalog §3.2
  'ticker', 'currency-pair', 'timestamp', 'age', 'relative-time',
  // 3. Indicators (semantic glyphs) — 6 — catalog §3.3
  'status-dot', 'quote-quality-dot', 'stale-flag', 'direction-arrow',
  'structure-icon-strip', 'traffic-light',
  // 4. Badges / pills — 7 — catalog §3.4
  'status-pill', 'rating-badge', 'rating-cluster', 'tag', 'venue-chip',
  'side-chip', 'tif-pill',
  // 5. Bars / gauges — 8 — catalog §3.5
  'progress-bar', 'range-bar', 'bidirectional-bar', 'heat', 'gauge',
  'spread-bar', 'volume-bar', 'maturity-ladder',
  // 6. In-cell charts (new) — 4 — catalog §3.6
  'win-loss-sparkline', 'yield-curve-sparkline', 'krd-bar-chart', 'depth-ladder',
  // 7. Composite (multi-value) — 5 — catalog §3.7
  'stacked-value', 'price-quote', 'nbbo', 'benchmark-spread', 'price-change-composite',
  // 8. Action — 2 — catalog §3.8
  'icon-action-cluster', 'row-menu',
  // Kernel re-exports — 5 — catalog §3.6 (already shipped in @cgrid/kernel)
  'line-sparkline', 'column-sparkline', 'area-sparkline', 'bar-sparkline', 'pie-sparkline',
] as const;

/** Union of every canonical renderer name (46 implementations + 5 kernel re-exports). */
export type RendererName = (typeof RENDERER_NAMES)[number];

// ─── Shared param fragments ─────────────────────────────────────────────────

/**
 * Semantic color token overrides (catalog §1 aesthetic bar). Renderers resolve
 * theme-aware defaults from `palette.ts`'s `SEMANTIC_COLORS`; params may
 * override per column. Locked defaults (§2.6.7): positive `#0aa063`, negative
 * `#e63946`, warning `#f0b429`, info `#3b82f6`.
 */
export interface SemanticColorMap {
  positive?: string;
  negative?: string;
  warning?: string;
  info?: string;
  muted?: string;
}

/**
 * Injectable wall-clock reading, threaded per-paint by the bridge's gated 1s
 * repaint tick (§2.5, §2.6.9). Renderers computing elapsed/relative time read
 * this instead of calling `Date.now()`/`new Date()` directly.
 */
export interface NowMsParam {
  nowMs: number;
}

/**
 * @deprecated Use `ColumnStatSnapshot` from `./columnStats` — the canonical
 * type `ColumnStats.for(colId)` actually returns. This package shipped both
 * a non-nullable `ColumnStatsSnapshot` (defined here) and the canonical
 * nullable `ColumnStatSnapshot` (`columnStats.ts`); they diverged (`count: 0`
 * / no-numeric-values snapshots have `null` min/max/maxAbs/sum, which this
 * alias's old non-nullable shape couldn't represent). Kept as a type alias —
 * not a widened re-declaration — so existing imports of the old name still
 * resolve, but every `stats?:` param field in this file now references
 * `ColumnStatSnapshot` directly.
 */
export type ColumnStatsSnapshot = ColumnStatSnapshot;

/**
 * Plain snapshot of `TickHistory.for(rowId, colId)` (§2.4b) — bounded rolling
 * per-cell value history consumed by SpreadBarCell's rolling-σ band and the
 * sparkline family. Serializable (structuredClone-safe).
 */
export interface TickHistorySnapshot {
  values: readonly number[];
  window: number;
}

/** StructureIconStrip's fixed-income feature flags (catalog §3.3). */
export type StructureGlyphKey =
  | 'callable' | 'puttable' | 'sinker' | 'floater' | 'step-up' | 'make-whole';

/** MaturityLadderBar's fixed tenor buckets (catalog §3.5 MaturityLadderBar). */
export type MaturityBucket = '0-1y' | '1-3y' | '3-5y' | '5-10y' | '10y+';

// ─── 1. Numeric (tick-aware) — catalog §3.1 ────────────────────────────────

/** Catalog §3.1 NumberCell — general-purpose numeric, precision + sign policy. */
export interface NumberCellParams {
  /** Format-DSL precision string (e.g. `'#,##0.00'`); undefined uses `valueFormatted` as-is. */
  format?: string;
  signPolicy?: 'always' | 'negative-only' | 'none';
  /** Rendered at ~70% opacity per the catalog. */
  currencyPrefix?: string;
  currencySuffix?: string;
  colors?: SemanticColorMap;
}

/** Catalog §3.1 PriceCell — ticking price; flashes green/red on tick, no flash unchanged. */
export interface PriceCellParams extends NumberCellParams {
  /** rowData field holding the previous tick, used when the host doesn't wire
   *  the 21e rule-engine flash channel (`p.flashAlpha`/`p.flashFromColor`). */
  prevField?: string;
}

/** Catalog §3.1 PriceDirectionCell — inline trend arrow + colored foreground, no bg flash. */
export interface PriceDirectionCellParams extends NumberCellParams {
  prevField?: string;
  /** Lucide icon names (defaults: `trending-up` / `trending-down` / `minus`). */
  iconUp?: string;
  iconDown?: string;
  iconFlat?: string;
}

/** Catalog §3.1 PnlCell — signed currency P&L, sign always shown. */
export interface PnlCellParams {
  format?: string;
  currencySymbol?: string;
  colors?: SemanticColorMap;
}

/** Catalog §3.1 DeltaCell — `+0.42 (+1.18%)` composite, both values colored together. */
export interface DeltaCellParams {
  absoluteField: string;
  percentField: string;
  format?: string;
  percentFormat?: string;
  /** Percent fragment renders at ~85% opacity per the catalog. */
  percentOpacity?: number;
  colors?: SemanticColorMap;
}

/** Catalog §3.1 BpsCell — signed basis points vs zero or a configured benchmark. */
export interface BpsCellParams {
  benchmarkField?: string;
  /** Default `' bps'`, rendered muted. */
  suffix?: string;
  colors?: SemanticColorMap;
}

/** Catalog §3.1 PctChangeCell — signed percentage, two-decimal default, sign always shown. */
export interface PctChangeCellParams {
  precision?: number;
  colors?: SemanticColorMap;
}

/** Catalog §3.1 FractionalPriceCell — Treasury 32nds/64ths convention (`99-16+`). */
export interface FractionalPriceCellParams {
  denominator?: 32 | 64;
  /** Trailing `+` denotes a half-tick; default `true`. */
  showHalfTick?: boolean;
}

/** Catalog §3.1 AbbreviatedNumberCell — K/M/B/T magnitude suffix. */
export interface AbbreviatedNumberCellParams {
  precision?: number;
  currencyPrefix?: string;
}

// ─── 2. Text / identity — catalog §3.2 ─────────────────────────────────────

/** Catalog §3.2 TickerCell — bold primary + muted secondary line, never abbreviated. */
export interface TickerCellParams {
  /** rowData field for the muted secondary line (e.g. CUSIP). */
  secondaryField?: string;
  /** Default `0.65` (~65% opacity per the catalog). */
  secondaryOpacity?: number;
}

/** Catalog §3.2 CurrencyPairCell — `EUR/USD  1.0834`, rate in mono, optional flags. */
export interface CurrencyPairCellParams {
  pairField: string;
  rateField: string;
  showFlags?: boolean;
}

/** Catalog §3.2 TimestampCell — `HH:MM:SS.mmm` right-aligned mono; muted date prefix if not today. */
export interface TimestampCellParams extends Partial<NowMsParam> {
  showMillis?: boolean;
}

/** Catalog §3.2 AgeCell — live elapsed-seconds counter; neutral <30s, amber <5m, red ≥5m. */
export interface AgeCellParams extends NowMsParam {
  /** rowData field holding the epoch-ms the age is measured from. */
  sinceField: string;
  /** Default `30_000`. */
  warnAfterMs?: number;
  /** Default `300_000`. */
  dangerAfterMs?: number;
}

/** Catalog §3.2 RelativeTimeCell — `"3m ago"` / `"just now"`; 1s refresh <60s, then 1m. */
export interface RelativeTimeCellParams extends NowMsParam {
  sinceField: string;
  refreshMs?: number;
}

// ─── 3. Indicators (semantic glyphs) — catalog §3.3 ────────────────────────

/** Catalog §3.3 StatusDot — 8px filled circle, optional trailing label. */
export interface StatusDotParams {
  color?: string;
  colorField?: string;
  label?: string;
  labelField?: string;
}

/** Catalog §3.3 QuoteQualityDot — fresh+tight+deep green / thin+wide amber / stale+one-sided red. */
export interface QuoteQualityDotParams {
  freshField?: string;
  tightField?: string;
  deepField?: string;
  staleField?: string;
  oneSidedField?: string;
}

/** Catalog §3.3 StaleFlag — cell drops to 60% opacity + inline icon; tooltip shows tick age. */
export interface StaleFlagParams extends NowMsParam {
  lastTickField: string;
  staleAfterMs?: number;
  icon?: string;
}

/** Catalog §3.3 DirectionArrow — standalone ▲/▼/▬, colored per direction. */
export interface DirectionArrowParams {
  direction?: 'up' | 'down' | 'flat';
  directionField?: string;
  colors?: SemanticColorMap;
}

/** Catalog §3.3 StructureIconStrip — fixed-income feature icon row (glyph map §2.6.6). */
export interface StructureIconStripParams {
  flags?: Partial<Record<StructureGlyphKey, boolean>>;
  /** rowData field holding the per-row flags record; `flags` wins when both set. */
  flagsField?: string;
  /** Overrides `palette.ts`'s `STRUCTURE_GLYPH_MAP` default icon names. */
  glyphOverrides?: Partial<Record<StructureGlyphKey, string>>;
}

/** Catalog §3.3 TrafficLightCell — three-state RAG dot (risk-limit / margin / credit-line). */
export interface TrafficLightCellParams {
  state?: 'red' | 'amber' | 'green';
  stateField?: string;
}

// ─── 4. Badges / pills — catalog §3.4 ──────────────────────────────────────

/** Catalog §3.4 StatusPill — order/state label; colors resolve via `STATUS_PILL_MAP`. */
export interface StatusPillParams {
  status?: string;
  statusField?: string;
  statusColors?: Record<string, { bg: string; fg: string; border?: string; dashed?: boolean }>;
}

/** Catalog §3.4 RatingBadge — single-agency credit rating, AAA green → D red, NR/WD muted. */
export interface RatingBadgeParams {
  rating: string;
  agency?: 'sp' | 'moodys' | 'fitch';
}

/** Catalog §3.4 RatingClusterCell — three RatingBadges side-by-side (S&P / Moody's / Fitch). */
export interface RatingClusterCellParams {
  spField?: string;
  moodysField?: string;
  fitchField?: string;
  showAgencyLabels?: boolean;
}

/** Catalog §3.4 TagCell — generic muted-grey tag (`144A`, `TRACE`, `DELAYED`, `AXE`). */
export interface TagCellParams {
  text?: string;
  textField?: string;
}

/** Catalog §3.4 VenueChip — execution venue MIC, venue-specific palette. */
export interface VenueChipParams {
  mic?: string;
  micField?: string;
  /** Overrides `palette.ts`'s `DEFAULT_VENUE_PALETTE`. */
  venueColors?: Record<string, string>;
}

/** Catalog §3.4 SideChip — long/short single-char, 14–16px square. */
export interface SideChipParams {
  side?: 'long' | 'short';
  sideField?: string;
}

/** Catalog §3.4 TimeInForcePill — `DAY`/`GTC`/`IOC`/`FOK`, hover tooltip expands abbreviation. */
export interface TimeInForcePillParams {
  tif?: string;
  tifField?: string;
}

// ─── 5. Bars / gauges — catalog §3.5 ───────────────────────────────────────

/** Catalog §3.5 ProgressBarCell — 0–100% fill (order fill ratio), text overlaid. */
export interface ProgressBarCellParams {
  /** 0..1 fraction. */
  fraction?: number;
  fractionField?: string;
  showLabel?: boolean;
}

/** Catalog §3.5 RangeBarCell — position within a range (52w / day range), marker dot. */
export interface RangeBarCellParams {
  minField: string;
  maxField: string;
  valueField: string;
  labelFormat?: string;
}

/** Catalog §3.5 BidirectionalBarCell — centre-zero, left red / right green; needs scope max. */
export interface BidirectionalBarCellParams {
  valueField?: string;
  /** Column-wide scope stats wired by the bridge's ColumnStats integration. */
  stats?: ColumnStatSnapshot;
  colors?: SemanticColorMap;
}

/** Catalog §3.5 HeatCell — column-wide gradient background; LAB interpolation default (§2.6.2). */
export interface HeatCellParams {
  stats?: ColumnStatSnapshot;
  curve?: 'lab' | 'linear';
  colors?: SemanticColorMap;
}

/** Catalog §3.5 GaugeCell — segmented gauge with a coloured tick marker. */
export interface GaugeCellParams {
  min: number;
  max: number;
  value?: number;
  valueField?: string;
  /** Zone boundaries, e.g. `[-20, 0, 20]` bps. */
  zones?: number[];
}

/** Catalog §3.5 SpreadBarCell — bid/ask spread width; amber 1σ / red 2σ vs rolling average. */
export interface SpreadBarCellParams {
  bidField: string;
  askField: string;
  /** Rolling history wired by the bridge's TickHistory integration. */
  history?: TickHistorySnapshot;
}

/** Catalog §3.5 VolumeBar — full-cell bar sized to `volume / max(volume)` in scope. */
export interface VolumeBarParams {
  valueField?: string;
  stats?: ColumnStatSnapshot;
  /** Reverse-out (inverted) text color where the bar overlaps it. */
  reverseOutText?: boolean;
}

/** Catalog §3.5 MaturityLadderBar — segmented bar by tenor bucket, widths = notional per bucket. */
export interface MaturityLadderBarParams {
  bucketFields: Partial<Record<MaturityBucket, string>>;
}

// ─── 6. In-cell charts (new) — catalog §3.6 ────────────────────────────────

/** Catalog §3.6 WinLossSparkline — 1px-wide binary up/down bars, all same height. */
export interface WinLossSparklineParams {
  /** rowData field holding `number[]` (positive = win, negative = loss). */
  valuesField: string;
  colors?: SemanticColorMap;
}

/** Catalog §3.6 YieldCurveSparkline — multi-tenor line, tenor labels below, own-tenor marker. */
export interface YieldCurveSparklineParams {
  tenors: string[];
  /** rowData field holding `number[]` aligned with `tenors`. */
  valuesField: string;
  markerTenor?: string;
  markerTenorField?: string;
}

/** Catalog §3.6 KRDBarChart — micro histogram per tenor bucket, bp-per-tenor sensitivity. */
export interface KRDBarChartParams {
  tenors: string[];
  /** rowData field holding `number[]` (key-rate durations) aligned with `tenors`. */
  valuesField: string;
}

/** Catalog §3.6 DepthLadderCell — mini order book, bid left / ask right, 3–5 levels. */
export interface DepthLadderCellParams {
  bidPricesField: string;
  bidSizesField: string;
  askPricesField: string;
  askSizesField: string;
  /** Default `3`, max `5` per the catalog. */
  levels?: number;
}

// ─── 7. Composite (multi-value) — catalog §3.7 ─────────────────────────────

/** Catalog §3.7 StackedValueCell — primary right-aligned, muted secondary below. */
export interface StackedValueCellParams {
  primaryField?: string;
  secondaryField?: string;
  /** Default `0.85` (~85% muted per the catalog). */
  secondaryOpacity?: number;
}

/** Catalog §3.7 PriceQuoteCell — bid left / ask right / mid centred; amber tag past threshold. */
export interface PriceQuoteCellParams {
  bidField: string;
  askField: string;
  midField?: string;
  spreadWarnThreshold?: number;
}

/** Catalog §3.7 NBBOCell — `bid × size @venue │ ask × size @venue`, venue as inline VenueChip. */
export interface NBBOCellParams {
  bidField: string;
  bidSizeField: string;
  bidVenueField: string;
  askField: string;
  askSizeField: string;
  askVenueField: string;
}

/** Catalog §3.7 BenchmarkSpreadCell — `+185 vs T 4.25 05/34`; bps colored, benchmark muted. */
export interface BenchmarkSpreadCellParams {
  bpsField: string;
  benchmarkLabelField: string;
}

/** Catalog §3.7 PriceChangeComposite — `234.56  ▲ +2.34 (+1.02%)`, arrow + deltas share color. */
export interface PriceChangeCompositeParams {
  priceField?: string;
  changeField: string;
  prevCloseField: string;
  format?: string;
}

// ─── 8. Action — catalog §3.8 ──────────────────────────────────────────────

/** A single hover-revealed action icon (catalog §3.8 IconActionCluster). Host callback —
 *  renderers never mutate data (§2.6.8). */
export interface IconActionSpec {
  icon: string;
  label: string;
  onAction: (rowId: string | number, colId: string) => void;
}

/**
 * Catalog §3.8 IconActionCluster — hover-revealed right-aligned icon cluster,
 * hit targets ≥24×24.
 *
 * Catalog deviation: the kernel does not yet thread a live per-cell hover
 * state into `CellPaintConfig` (it hard-codes `isHovered: false` — see
 * `packages/kernel/src/renderer/painters/byRows.ts`), so gating paint on
 * `p.isHovered` alone would make this renderer permanently unreachable.
 * `revealOnHover` defaults to `false` (always visible) until hover-state
 * threading lands in the kernel (logged follow-up); set it to `true` only
 * once that support exists, or if a host wires its own hover signal into
 * `p.isHovered` some other way.
 */
export interface IconActionClusterParams {
  actions: IconActionSpec[];
  /** Default `false` — always visible. See catalog-deviation note above. */
  revealOnHover?: boolean;
}

/** Catalog §3.8 RowMenuCell — 20×20 kebab icon; opens the host's context menu on click. */
export interface RowMenuCellParams {
  onOpen: (
    rowId: string | number,
    colId: string,
    anchor: { x: number; y: number; w: number; h: number },
  ) => void;
}
