// @wellsfargo-starui/velocity-grid-ext/renderers — public re-exports.
// See docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md §2.1
// for the authoritative package layout this mirrors.

// ─── Name table + shared param types ────────────────────────────────────────
export { RENDERER_NAMES } from './types';
export type {
  RendererName,
  SemanticColorMap,
  NowMsParam,
  ColumnStatsSnapshot,
  TickHistorySnapshot,
  StructureGlyphKey,
  MaturityBucket,
  NumberCellParams,
  PriceCellParams,
  PriceDirectionCellParams,
  PnlCellParams,
  DeltaCellParams,
  BpsCellParams,
  PctChangeCellParams,
  FractionalPriceCellParams,
  AbbreviatedNumberCellParams,
  TickerCellParams,
  CurrencyPairCellParams,
  TimestampCellParams,
  AgeCellParams,
  RelativeTimeCellParams,
  StatusDotParams,
  QuoteQualityDotParams,
  StaleFlagParams,
  DirectionArrowParams,
  StructureIconStripParams,
  TrafficLightCellParams,
  StatusPillParams,
  RatingBadgeParams,
  RatingClusterCellParams,
  TagCellParams,
  VenueChipParams,
  SideChipParams,
  TimeInForcePillParams,
  ProgressBarCellParams,
  RangeBarCellParams,
  BidirectionalBarCellParams,
  HeatCellParams,
  GaugeCellParams,
  SpreadBarCellParams,
  VolumeBarParams,
  MaturityLadderBarParams,
  WinLossSparklineParams,
  YieldCurveSparklineParams,
  KRDBarChartParams,
  DepthLadderCellParams,
  StackedValueCellParams,
  PriceQuoteCellParams,
  NBBOCellParams,
  BenchmarkSpreadCellParams,
  PriceChangeCompositeParams,
  IconActionSpec,
  IconActionClusterParams,
  RowMenuCellParams,
} from './types';

// ─── Palette data ────────────────────────────────────────────────────────────
export {
  SEMANTIC_COLORS,
  STRUCTURE_GLYPH_MAP,
  STATUS_PILL_MAP,
  RATING_SCALE_BANDS,
  DEFAULT_VENUE_PALETTE,
  resolveSemanticColors,
  withThemeAlpha,
  resolvePillColors,
} from './palette';
export type { StatusPillStyle, RatingBand } from './palette';

// ─── Shared paint helpers ────────────────────────────────────────────────────
export {
  withAlpha, mixHex, labInterpolate,
  pill, dot, miniBar, fragText,
} from './paintUtils';
export type { Gc } from './paintUtils';

// ─── Category 1: Numeric (tick-aware) ───────────────────────────────────────
export {
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell, bpsCell,
  pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
} from './numeric';

// ─── Category 2: Text / identity ─────────────────────────────────────────────
export {
  tickerCell, currencyPairCell, timestampCell, ageCell, relativeTimeCell,
} from './text';

// ─── Category 3: Indicators ───────────────────────────────────────────────────
export {
  statusDot, quoteQualityDot, staleFlag, directionArrow, structureIconStrip, trafficLightCell,
  getStaleFlagTooltip, getLastStaleFlagTooltip,
} from './indicators';

// ─── Category 4: Badges / pills ───────────────────────────────────────────────
export {
  statusPill, ratingBadge, ratingClusterCell, tagCell, venueChip, sideChip, tifPill,
} from './badges';

// ─── Category 5: Bars / gauges ────────────────────────────────────────────────
export {
  progressBarCell, rangeBarCell, bidirectionalBarCell, heatCell, gaugeCell,
  spreadBarCell, volumeBar, maturityLadderBar,
} from './bars';

// ─── Category 6: In-cell charts (new + kernel re-exports) ───────────────────
export {
  winLossSparkline, yieldCurveSparkline, krdBarChart, depthLadderCell,
  lineSparkline, columnSparkline, areaSparkline, barSparkline, pieSparkline,
} from './charts';

// ─── Category 7: Composite ───────────────────────────────────────────────────
export {
  stackedValueCell, priceQuoteCell, nbboCell, benchmarkSpreadCell, priceChangeComposite,
} from './composite';

// ─── Category 8: Action ───────────────────────────────────────────────────────
export { iconActionCluster, rowMenuCell, HitRegionRegistry, defaultHitRegionRegistry, resolveHitRegion } from './actions';
export type { HitRegion } from './actions';

// ─── Data helpers ─────────────────────────────────────────────────────────────
export { ColumnStats } from './columnStats';
export type { ColumnStatSnapshot } from './columnStats';
export { TickHistory, DEFAULT_TICK_HISTORY_WINDOW } from './tickHistory';
export type { TickHistoryColumnOptions } from './tickHistory';

// ─── Kernel bridge ────────────────────────────────────────────────────────────
export { wireRenderersIntoKernel } from './bridge';
export type {
  RenderersBridgeOptions, RenderersBridgeHandle, RenderersColDefBuilders, RenderersColDef,
} from './bridge';
export { THREADING_PROGRAM } from './colDefBuilders';
