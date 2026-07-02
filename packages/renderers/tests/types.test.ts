import { describe, expect, it } from 'vitest';
import type { CellPainter } from '@cgrid/kernel';
import {
  RENDERER_NAMES,
  SEMANTIC_COLORS,
  STRUCTURE_GLYPH_MAP,
  STATUS_PILL_MAP,
  RATING_SCALE_BANDS,
  DEFAULT_VENUE_PALETTE,
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell, bpsCell,
  pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
  tickerCell, currencyPairCell, timestampCell, ageCell, relativeTimeCell,
  statusDot, quoteQualityDot, staleFlag, directionArrow, structureIconStrip, trafficLightCell,
  statusPill, ratingBadge, ratingClusterCell, tagCell, venueChip, sideChip, tifPill,
  progressBarCell, rangeBarCell, bidirectionalBarCell, heatCell, gaugeCell,
  spreadBarCell, volumeBar, maturityLadderBar,
  winLossSparkline, yieldCurveSparkline, krdBarChart, depthLadderCell,
  lineSparkline, columnSparkline, areaSparkline, barSparkline, pieSparkline,
  stackedValueCell, priceQuoteCell, nbboCell, benchmarkSpreadCell, priceChangeComposite,
  iconActionCluster, rowMenuCell,
} from '../src/index';
import type {
  RendererName,
  SemanticColorMap,
  NowMsParam,
  ColumnStatsSnapshot,
  TickHistorySnapshot,
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
  IconActionClusterParams,
  RowMenuCellParams,
} from '../src/index';

const CATALOG_NAMES = [
  'number', 'price', 'price-direction', 'pnl', 'delta', 'bps', 'pct-change',
  'fractional-price', 'abbreviated-number',
  'ticker', 'currency-pair', 'timestamp', 'age', 'relative-time',
  'status-dot', 'quote-quality-dot', 'stale-flag', 'direction-arrow',
  'structure-icon-strip', 'traffic-light',
  'status-pill', 'rating-badge', 'rating-cluster', 'tag', 'venue-chip',
  'side-chip', 'tif-pill',
  'progress-bar', 'range-bar', 'bidirectional-bar', 'heat', 'gauge',
  'spread-bar', 'volume-bar', 'maturity-ladder',
  'win-loss-sparkline', 'yield-curve-sparkline', 'krd-bar-chart', 'depth-ladder',
  'stacked-value', 'price-quote', 'nbbo', 'benchmark-spread', 'price-change-composite',
  'icon-action-cluster', 'row-menu',
] as const;

const KERNEL_REEXPORT_NAMES = [
  'line-sparkline', 'column-sparkline', 'area-sparkline', 'bar-sparkline', 'pie-sparkline',
] as const;

describe('RENDERER_NAMES — canonical name table', () => {
  it('has exactly 51 entries (46 implementations + 5 kernel re-exports)', () => {
    expect(RENDERER_NAMES).toHaveLength(51);
  });

  it('every name is unique', () => {
    expect(new Set(RENDERER_NAMES).size).toBe(RENDERER_NAMES.length);
  });

  it('contains all 46 catalog implementation names', () => {
    for (const name of CATALOG_NAMES) {
      expect(RENDERER_NAMES).toContain(name);
    }
    expect(CATALOG_NAMES).toHaveLength(46);
  });

  it('contains all 5 kernel sparkline re-export names', () => {
    for (const name of KERNEL_REEXPORT_NAMES) {
      expect(RENDERER_NAMES).toContain(name);
    }
    expect(KERNEL_REEXPORT_NAMES).toHaveLength(5);
  });

  it('the union type accepts every literal in the const table', () => {
    const sample: RendererName = RENDERER_NAMES[0];
    expect(RENDERER_NAMES).toContain(sample);
  });
});

describe('palette data — structuredClone-safety', () => {
  it('SEMANTIC_COLORS round-trips and carries the four locked hexes', () => {
    expect(structuredClone(SEMANTIC_COLORS)).toEqual(SEMANTIC_COLORS);
    expect(SEMANTIC_COLORS.positive).toBe('#0aa063');
    expect(SEMANTIC_COLORS.negative).toBe('#e63946');
    expect(SEMANTIC_COLORS.warning).toBe('#f0b429');
    expect(SEMANTIC_COLORS.info).toBe('#3b82f6');
  });

  it('STRUCTURE_GLYPH_MAP round-trips and matches the §2.6.6 locked glyph map', () => {
    expect(structuredClone(STRUCTURE_GLYPH_MAP)).toEqual(STRUCTURE_GLYPH_MAP);
    expect(STRUCTURE_GLYPH_MAP).toEqual({
      callable: 'bell-ring',
      puttable: 'corner-down-left',
      sinker: 'anchor',
      floater: 'waves',
      'step-up': 'trending-up',
      'make-whole': 'shield-check',
    });
  });

  it('STATUS_PILL_MAP round-trips and covers every catalog §3.4 order state', () => {
    expect(structuredClone(STATUS_PILL_MAP)).toEqual(STATUS_PILL_MAP);
    for (const key of ['WORKING', 'PART_FILL', 'FILLED', 'CANCELLED', 'REJECTED', 'PENDING']) {
      expect(STATUS_PILL_MAP).toHaveProperty(key);
    }
  });

  it('RATING_SCALE_BANDS round-trips, is non-empty, and spans ig/hy/nr tiers', () => {
    expect(structuredClone(RATING_SCALE_BANDS)).toEqual(RATING_SCALE_BANDS);
    expect(RATING_SCALE_BANDS.length).toBeGreaterThan(0);
    const tiers = new Set(RATING_SCALE_BANDS.map((b) => b.tier));
    expect(tiers).toEqual(new Set(['ig', 'hy', 'nr']));
    expect(RATING_SCALE_BANDS[0]!.grade).toBe('AAA');
    expect(RATING_SCALE_BANDS[RATING_SCALE_BANDS.length - 1]!.grade).toBe('WD');
  });

  it('DEFAULT_VENUE_PALETTE round-trips and covers the catalog §3.4 sample venues', () => {
    expect(structuredClone(DEFAULT_VENUE_PALETTE)).toEqual(DEFAULT_VENUE_PALETTE);
    for (const mic of ['XNAS', 'ARCX', 'BATS', 'EDGX']) {
      expect(DEFAULT_VENUE_PALETTE).toHaveProperty(mic);
    }
  });
});

describe('every skeleton painter conforms to CellPainter and throws not-implemented', () => {
  /** Landed in category tasks — no longer skeleton throws. */
  const IMPLEMENTED = new Set<string>([
    'number', 'price', 'price-direction', 'pnl', 'delta', 'bps', 'pct-change',
    'fractional-price', 'abbreviated-number',
    'ticker', 'currency-pair', 'timestamp', 'age', 'relative-time',
    'status-dot', 'quote-quality-dot', 'stale-flag', 'direction-arrow',
    'structure-icon-strip', 'traffic-light',
    'status-pill', 'rating-badge', 'rating-cluster', 'tag', 'venue-chip', 'side-chip', 'tif-pill',
  ]);

  const painters: Record<string, CellPainter> = {
    number: numberCell, price: priceCell, 'price-direction': priceDirectionCell, pnl: pnlCell,
    delta: deltaCell, bps: bpsCell, 'pct-change': pctChangeCell,
    'fractional-price': fractionalPriceCell, 'abbreviated-number': abbreviatedNumberCell,
    ticker: tickerCell, 'currency-pair': currencyPairCell, timestamp: timestampCell,
    age: ageCell, 'relative-time': relativeTimeCell,
    'status-dot': statusDot, 'quote-quality-dot': quoteQualityDot, 'stale-flag': staleFlag,
    'direction-arrow': directionArrow, 'structure-icon-strip': structureIconStrip,
    'traffic-light': trafficLightCell,
    'status-pill': statusPill, 'rating-badge': ratingBadge, 'rating-cluster': ratingClusterCell,
    tag: tagCell, 'venue-chip': venueChip, 'side-chip': sideChip, 'tif-pill': tifPill,
    'progress-bar': progressBarCell, 'range-bar': rangeBarCell,
    'bidirectional-bar': bidirectionalBarCell, heat: heatCell, gauge: gaugeCell,
    'spread-bar': spreadBarCell, 'volume-bar': volumeBar, 'maturity-ladder': maturityLadderBar,
    'win-loss-sparkline': winLossSparkline, 'yield-curve-sparkline': yieldCurveSparkline,
    'krd-bar-chart': krdBarChart, 'depth-ladder': depthLadderCell,
    'line-sparkline': lineSparkline, 'column-sparkline': columnSparkline,
    'area-sparkline': areaSparkline, 'bar-sparkline': barSparkline, 'pie-sparkline': pieSparkline,
    'stacked-value': stackedValueCell, 'price-quote': priceQuoteCell, nbbo: nbboCell,
    'benchmark-spread': benchmarkSpreadCell, 'price-change-composite': priceChangeComposite,
    'icon-action-cluster': iconActionCluster, 'row-menu': rowMenuCell,
  };

  it('exports exactly one painter per RENDERER_NAMES entry', () => {
    expect(Object.keys(painters).sort()).toEqual([...RENDERER_NAMES].sort());
  });

  for (const name of RENDERER_NAMES) {
    if (IMPLEMENTED.has(name)) continue;
    it(`'${name}' throws 'not implemented: ${name}'`, () => {
      // Skeleton paint() throws before touching gc/p — the fake args are
      // never dereferenced, so `as never` is safe here.
      expect(() => painters[name]!.paint(null as never, null as never)).toThrow(
        `not implemented: ${name}`,
      );
    });
  }
});

describe('every params interface is assignable (compile-time proof + smoke check)', () => {
  it('numeric category (catalog §3.1)', () => {
    const colors: SemanticColorMap = { positive: '#0aa063', negative: '#e63946' };
    const number: NumberCellParams = { format: '#,##0.00', signPolicy: 'always', colors };
    const price: PriceCellParams = { ...number, prevField: 'prevPrice' };
    const priceDirection: PriceDirectionCellParams = { ...number, iconUp: 'trending-up' };
    const pnl: PnlCellParams = { format: '#,##0.00', currencySymbol: '$', colors };
    const delta: DeltaCellParams = { absoluteField: 'chg', percentField: 'chgPct' };
    const bps: BpsCellParams = { benchmarkField: 'benchmarkBps', suffix: ' bps' };
    const pctChange: PctChangeCellParams = { precision: 2 };
    const fractionalPrice: FractionalPriceCellParams = { denominator: 32, showHalfTick: true };
    const abbreviatedNumber: AbbreviatedNumberCellParams = { precision: 1, currencyPrefix: '$' };

    expect(number.format).toBe('#,##0.00');
    expect(price.prevField).toBe('prevPrice');
    expect(priceDirection.iconUp).toBe('trending-up');
    expect(pnl.currencySymbol).toBe('$');
    expect(delta.absoluteField).toBe('chg');
    expect(bps.suffix).toBe(' bps');
    expect(pctChange.precision).toBe(2);
    expect(fractionalPrice.denominator).toBe(32);
    expect(abbreviatedNumber.precision).toBe(1);
  });

  it('text / identity category (catalog §3.2)', () => {
    const now: NowMsParam = { nowMs: 1_700_000_000_000 };
    const ticker: TickerCellParams = { secondaryField: 'cusip', secondaryOpacity: 0.65 };
    const currencyPair: CurrencyPairCellParams = { pairField: 'pair', rateField: 'rate' };
    const timestamp: TimestampCellParams = { ...now, showMillis: true };
    const age: AgeCellParams = { ...now, sinceField: 'orderTime', warnAfterMs: 30_000 };
    const relativeTime: RelativeTimeCellParams = { ...now, sinceField: 'ts', refreshMs: 1000 };

    expect(ticker.secondaryOpacity).toBe(0.65);
    expect(currencyPair.pairField).toBe('pair');
    expect(timestamp.nowMs).toBe(now.nowMs);
    expect(age.sinceField).toBe('orderTime');
    expect(relativeTime.refreshMs).toBe(1000);
  });

  it('indicators category (catalog §3.3)', () => {
    const statusDotP: StatusDotParams = { color: '#0aa063', label: 'Connected' };
    const quoteQuality: QuoteQualityDotParams = { freshField: 'fresh', tightField: 'tight' };
    const stale: StaleFlagParams = { nowMs: 1000, lastTickField: 'lastTick', staleAfterMs: 8000 };
    const arrow: DirectionArrowParams = { direction: 'up' };
    const structureStrip: StructureIconStripParams = {
      flags: { callable: true, sinker: false },
      glyphOverrides: { callable: 'bell' },
    };
    const trafficLight: TrafficLightCellParams = { state: 'green' };

    expect(statusDotP.color).toBe('#0aa063');
    expect(quoteQuality.freshField).toBe('fresh');
    expect(stale.staleAfterMs).toBe(8000);
    expect(arrow.direction).toBe('up');
    expect(structureStrip.flags.callable).toBe(true);
    expect(trafficLight.state).toBe('green');
  });

  it('badges / pills category (catalog §3.4)', () => {
    const pill: StatusPillParams = { status: 'WORKING' };
    const rating: RatingBadgeParams = { rating: 'AAA', agency: 'sp' };
    const cluster: RatingClusterCellParams = { spField: 'sp', moodysField: 'moodys' };
    const tag: TagCellParams = { text: '144A' };
    const venue: VenueChipParams = { mic: 'XNAS' };
    const side: SideChipParams = { side: 'long' };
    const tif: TimeInForcePillParams = { tif: 'DAY' };

    expect(pill.status).toBe('WORKING');
    expect(rating.rating).toBe('AAA');
    expect(cluster.spField).toBe('sp');
    expect(tag.text).toBe('144A');
    expect(venue.mic).toBe('XNAS');
    expect(side.side).toBe('long');
    expect(tif.tif).toBe('DAY');
  });

  it('bars / gauges category (catalog §3.5)', () => {
    const stats: ColumnStatsSnapshot = { min: -10, max: 10, maxAbs: 10, sum: 0, count: 5 };
    const history: TickHistorySnapshot = { values: [1, 2, 3], window: 60 };
    const progress: ProgressBarCellParams = { fraction: 0.5 };
    const range: RangeBarCellParams = { minField: 'lo', maxField: 'hi', valueField: 'val' };
    const bidirectional: BidirectionalBarCellParams = { valueField: 'pnl', stats };
    const heat: HeatCellParams = { stats, curve: 'lab' };
    const gauge: GaugeCellParams = { min: -20, max: 20, zones: [-20, 0, 20] };
    const spread: SpreadBarCellParams = { bidField: 'bid', askField: 'ask', history };
    const volume: VolumeBarParams = { valueField: 'vol', stats };
    const ladder: MaturityLadderBarParams = { bucketFields: { '0-1y': 'n01', '10y+': 'n10p' } };

    expect(progress.fraction).toBe(0.5);
    expect(range.minField).toBe('lo');
    expect(bidirectional.stats?.max).toBe(10);
    expect(heat.curve).toBe('lab');
    expect(gauge.zones).toEqual([-20, 0, 20]);
    expect(spread.history?.window).toBe(60);
    expect(volume.stats?.count).toBe(5);
    expect(ladder.bucketFields['0-1y']).toBe('n01');
  });

  it('in-cell charts category (catalog §3.6)', () => {
    const winLoss: WinLossSparklineParams = { valuesField: 'series' };
    const yieldCurve: YieldCurveSparklineParams = { tenors: ['2y', '5y'], valuesField: 'yields' };
    const krd: KRDBarChartParams = { tenors: ['2y', '5y'], valuesField: 'krds' };
    const depth: DepthLadderCellParams = {
      bidPricesField: 'bidPx', bidSizesField: 'bidSz', askPricesField: 'askPx', askSizesField: 'askSz',
    };

    expect(winLoss.valuesField).toBe('series');
    expect(yieldCurve.tenors).toEqual(['2y', '5y']);
    expect(krd.valuesField).toBe('krds');
    expect(depth.levels).toBeUndefined();
  });

  it('composite category (catalog §3.7)', () => {
    const stacked: StackedValueCellParams = { primaryField: 'symbol', secondaryField: 'cusip' };
    const quote: PriceQuoteCellParams = { bidField: 'bid', askField: 'ask' };
    const nbbo: NBBOCellParams = {
      bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidVenue',
      askField: 'ask', askSizeField: 'askSz', askVenueField: 'askVenue',
    };
    const benchmarkSpread: BenchmarkSpreadCellParams = {
      bpsField: 'gspread', benchmarkLabelField: 'benchmark',
    };
    const priceChange: PriceChangeCompositeParams = {
      changeField: 'change', prevCloseField: 'prevClose',
    };

    expect(stacked.primaryField).toBe('symbol');
    expect(quote.bidField).toBe('bid');
    expect(nbbo.bidVenueField).toBe('bidVenue');
    expect(benchmarkSpread.bpsField).toBe('gspread');
    expect(priceChange.changeField).toBe('change');
  });

  it('action category (catalog §3.8) — host callbacks never mutate data', () => {
    const calls: string[] = [];
    const iconCluster: IconActionClusterParams = {
      actions: [{ icon: 'x', label: 'Cancel', onAction: (rowId) => calls.push(String(rowId)) }],
    };
    const rowMenu: RowMenuCellParams = {
      onOpen: (rowId) => calls.push(String(rowId)),
    };

    iconCluster.actions[0]!.onAction('r1', 'colA');
    rowMenu.onOpen('r2', 'colB', { x: 0, y: 0, w: 24, h: 24 });

    expect(calls).toEqual(['r1', 'r2']);
  });
});
