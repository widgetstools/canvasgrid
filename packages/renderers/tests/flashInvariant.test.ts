// @cgrid/renderers — cross-cutting flash-overlay invariant (follow-up 1).
//
// Every exported `CellPainter` must paint the cell-change flash overlay
// EXACTLY ONCE per cell, at the correct z-order: over the renderer's own
// background, under its content (text/glyphs). This file enumerates every
// painter `@cgrid/renderers` exports from `src/index.ts` and paints each once
// with `flashAlpha` set, asserting:
//   (a) a full-cell-bounds `fillRect` is emitted while `globalAlpha < 1`
//       (the flash IS painted);
//   (b) that flash `fillRect` occurs BEFORE the first `fillText` (when the
//       painter emits any text) — i.e. flash is under content;
//   (c) exactly ONE such reduced-alpha full-bounds flash rect (no double-paint).
//
// `iconActionCluster` / `rowMenuCell` (catalog §3.8, actions.ts) are excluded:
// they are hover-revealed action affordances (icon cluster / kebab menu), not
// per-cell VALUE renderers — there is no "value changed, so flash" semantic
// for a static UI affordance overlaid on a cell.

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPainter, CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';

import {
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell, bpsCell,
  pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
} from '../src/numeric';
import {
  tickerCell, currencyPairCell, timestampCell, ageCell, relativeTimeCell,
} from '../src/text';
import {
  statusDot, quoteQualityDot, staleFlag, directionArrow, structureIconStrip, trafficLightCell,
} from '../src/indicators';
import {
  statusPill, ratingBadge, ratingClusterCell, tagCell, venueChip, sideChip, tifPill,
} from '../src/badges';
import {
  progressBarCell, rangeBarCell, bidirectionalBarCell, heatCell, gaugeCell,
  spreadBarCell, volumeBar, maturityLadderBar,
} from '../src/bars';
import {
  winLossSparkline, yieldCurveSparkline, krdBarChart, depthLadderCell,
  lineSparkline, columnSparkline, areaSparkline, barSparkline, pieSparkline,
} from '../src/charts';
import {
  stackedValueCell, priceQuoteCell, nbboCell, benchmarkSpreadCell, priceChangeComposite,
} from '../src/composite';

const BOUNDS = { x: 10, y: 20, w: 140, h: 24 };

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 100,
    valueFormatted: '100.00',
    bounds: { ...BOUNDS },
    font: '13px Inter, sans-serif',
    fg: '#111111',
    bg: '#ffffff',
    borderColor: '#ccc',
    halign: 'right',
    prefillColor: '#ffffff',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
    flashAlpha: 0.3,
    flashFromColor: '#123456',
    ...overrides,
  };
}

/** Replays the fake gc's call log, tracking `globalAlpha` at each point in
 *  time, and returns the indices of `fillRect` calls that (a) cover the
 *  FULL cell bounds and (b) fired while `globalAlpha < 1` — i.e. flash
 *  overlay paints, not incidental full-bounds fills at full opacity (e.g.
 *  heatCell's own background tint, which paints at alpha 1 BEFORE the flash). */
function findFlashRectIndices(calls: FakeGc['calls'], bounds: CellPaintConfig['bounds']): number[] {
  let alpha = 1;
  const idx: number[] = [];
  calls.forEach((c, i) => {
    if (c.op === 'set:globalAlpha') alpha = Number(c.args[0]);
    if (c.op === 'fillRect') {
      const [x, y, w, h] = c.args as number[];
      if (x === bounds.x && y === bounds.y && w === bounds.w && h === bounds.h && alpha < 1) {
        idx.push(i);
      }
    }
  });
  return idx;
}

function firstFillTextIndex(calls: FakeGc['calls']): number {
  return calls.findIndex((c) => c.op === 'fillText');
}

interface Entry {
  name: string;
  painter: CellPainter;
  config: Partial<CellPaintConfig>;
}

const ENTRIES: Entry[] = [
  // ─── Category 1: Numeric ────────────────────────────────────────────────
  { name: 'numberCell', painter: numberCell, config: {} },
  { name: 'priceCell', painter: priceCell, config: {} },
  {
    name: 'priceDirectionCell', painter: priceDirectionCell,
    config: { rowData: { prev: 90 }, params: { prevField: 'prev' } },
  },
  { name: 'pnlCell', painter: pnlCell, config: { value: 881349, valueFormatted: '' } },
  {
    name: 'deltaCell', painter: deltaCell,
    config: { rowData: { chg: 0.42, pct: 1.18 }, params: { absoluteField: 'chg', percentField: 'pct' } },
  },
  { name: 'bpsCell', painter: bpsCell, config: {} },
  { name: 'pctChangeCell', painter: pctChangeCell, config: {} },
  { name: 'fractionalPriceCell', painter: fractionalPriceCell, config: { value: 99.515625, valueFormatted: '' } },
  { name: 'abbreviatedNumberCell', painter: abbreviatedNumberCell, config: { value: 1_200_000, valueFormatted: '' } },

  // ─── Category 2: Text / identity ────────────────────────────────────────
  { name: 'tickerCell', painter: tickerCell, config: {} },
  {
    name: 'currencyPairCell', painter: currencyPairCell,
    config: { rowData: { pair: 'EUR/USD', rate: 1.08 }, params: { pairField: 'pair', rateField: 'rate' } },
  },
  { name: 'timestampCell', painter: timestampCell, config: { value: 1_700_000_000_000 } },
  {
    name: 'ageCell', painter: ageCell,
    config: { rowData: { since: 0 }, params: { nowMs: 5_000, sinceField: 'since' } },
  },
  {
    name: 'relativeTimeCell', painter: relativeTimeCell,
    config: { rowData: { since: 0 }, params: { nowMs: 120_000, sinceField: 'since' } },
  },

  // ─── Category 3: Indicators ─────────────────────────────────────────────
  { name: 'statusDot', painter: statusDot, config: { params: { label: 'OK' } } },
  { name: 'quoteQualityDot', painter: quoteQualityDot, config: {} },
  {
    name: 'staleFlag', painter: staleFlag,
    config: { params: { lastTickField: 'last', nowMs: 100_000 }, rowData: { last: 0 } },
  },
  { name: 'directionArrow', painter: directionArrow, config: { params: { direction: 'up' } } },
  {
    name: 'structureIconStrip', painter: structureIconStrip,
    config: { params: { flags: { callable: true } } },
  },
  { name: 'trafficLightCell', painter: trafficLightCell, config: { params: { state: 'green' } } },

  // ─── Category 4: Badges / pills ──────────────────────────────────────────
  { name: 'statusPill', painter: statusPill, config: { params: { status: 'FILLED' } } },
  { name: 'ratingBadge', painter: ratingBadge, config: { params: { rating: 'AAA' } } },
  {
    name: 'ratingClusterCell', painter: ratingClusterCell,
    config: { rowData: { sp: 'AAA' }, params: { spField: 'sp' } },
  },
  { name: 'tagCell', painter: tagCell, config: { params: { text: 'TAG' } } },
  { name: 'venueChip', painter: venueChip, config: { params: { mic: 'NYSE' } } },
  { name: 'sideChip', painter: sideChip, config: { params: { side: 'long' } } },
  { name: 'tifPill', painter: tifPill, config: { params: { tif: 'DAY' } } },

  // ─── Category 5: Bars / gauges ───────────────────────────────────────────
  { name: 'progressBarCell', painter: progressBarCell, config: { params: { fraction: 0.5 } } },
  {
    name: 'rangeBarCell', painter: rangeBarCell,
    config: {
      rowData: { min: 0, max: 100, val: 50 },
      params: { minField: 'min', maxField: 'max', valueField: 'val' },
    },
  },
  {
    name: 'bidirectionalBarCell', painter: bidirectionalBarCell,
    config: { rowData: { v: 10 }, params: { valueField: 'v' }, valueFormatted: '10.00' },
  },
  { name: 'heatCell', painter: heatCell, config: { value: 50, valueFormatted: '50.00' } },
  { name: 'gaugeCell', painter: gaugeCell, config: { params: { min: 0, max: 100, value: 50 } } },
  {
    name: 'spreadBarCell', painter: spreadBarCell,
    config: { rowData: { bid: 100, ask: 100.5 }, params: { bidField: 'bid', askField: 'ask' } },
  },
  {
    name: 'volumeBar', painter: volumeBar,
    config: { rowData: { v: 1000 }, params: { valueField: 'v' }, valueFormatted: '1000' },
  },
  {
    name: 'maturityLadderBar', painter: maturityLadderBar,
    config: { rowData: { b1: 100 }, params: { bucketFields: { '0-1y': 'b1' } } },
  },

  // ─── Category 6: In-cell charts ──────────────────────────────────────────
  {
    name: 'winLossSparkline', painter: winLossSparkline,
    config: { rowData: { data: [1, -1, 2] }, params: { valuesField: 'data' } },
  },
  {
    name: 'yieldCurveSparkline', painter: yieldCurveSparkline,
    config: { rowData: { data: [1, 2] }, params: { tenors: ['1y', '2y'], valuesField: 'data' } },
  },
  {
    name: 'krdBarChart', painter: krdBarChart,
    config: { rowData: { data: [1, -1] }, params: { tenors: ['1y', '2y'], valuesField: 'data' } },
  },
  {
    name: 'depthLadderCell', painter: depthLadderCell,
    config: {
      rowData: { bp: [100], bs: [10], ap: [101], as: [5] },
      params: { bidPricesField: 'bp', bidSizesField: 'bs', askPricesField: 'ap', askSizesField: 'as' },
    },
  },
  { name: 'lineSparkline', painter: lineSparkline, config: { value: [1, 2, 3, 4] } },
  { name: 'columnSparkline', painter: columnSparkline, config: { value: [1, 2, 3, 4] } },
  { name: 'areaSparkline', painter: areaSparkline, config: { value: [1, 2, 3, 4] } },
  { name: 'barSparkline', painter: barSparkline, config: { value: [1, 2, 3, 4] } },
  { name: 'pieSparkline', painter: pieSparkline, config: { value: [1, 2, 3, 4] } },

  // ─── Category 7: Composite ───────────────────────────────────────────────
  { name: 'stackedValueCell', painter: stackedValueCell, config: {} },
  {
    name: 'priceQuoteCell', painter: priceQuoteCell,
    config: { rowData: { bid: 100, ask: 100.5 }, params: { bidField: 'bid', askField: 'ask' } },
  },
  {
    name: 'nbboCell', painter: nbboCell,
    config: {
      rowData: { bid: 100, bidSz: '10', bidV: 'nyse', ask: 100.5, askSz: '5', askV: 'nasdaq' },
      params: {
        bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidV',
        askField: 'ask', askSizeField: 'askSz', askVenueField: 'askV',
      },
    },
  },
  {
    name: 'benchmarkSpreadCell', painter: benchmarkSpreadCell,
    config: { rowData: { bps: 12, label: 'T 4.25 05/34' }, params: { bpsField: 'bps', benchmarkLabelField: 'label' } },
  },
  {
    name: 'priceChangeComposite', painter: priceChangeComposite,
    config: {
      value: 101,
      rowData: { chg: 1, prev: 100 },
      params: { changeField: 'chg', prevCloseField: 'prev' },
    },
  },
];

describe('flash overlay invariant — every exported CellPainter flashes exactly once, under content', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  for (const { name, painter, config } of ENTRIES) {
    it(`${name} paints exactly one full-bounds flash rect, before any content`, () => {
      const cfg = baseConfig(config);
      painter.paint(gc, cfg);
      const flashIdx = findFlashRectIndices(gc.calls, cfg.bounds);
      expect(flashIdx.length).toBe(1);
      const textIdx = firstFillTextIndex(gc.calls);
      if (textIdx >= 0) {
        expect(flashIdx[0]).toBeLessThan(textIdx);
      }
    });
  }

  it('exactly 49 painters are covered by this catch-all (51 exported minus 2 action affordances)', () => {
    expect(ENTRIES.length).toBe(49);
  });
});

describe('flash overlay — no flash when flashAlpha is 0', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('numberCell emits no flash rect when flashAlpha is 0', () => {
    const cfg = baseConfig({ flashAlpha: 0 });
    numberCell.paint(gc, cfg);
    expect(findFlashRectIndices(gc.calls, cfg.bounds).length).toBe(0);
  });
});
