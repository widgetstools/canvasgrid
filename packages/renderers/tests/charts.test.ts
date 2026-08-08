// @wellsfargo-starui/velocity-grid-renderers — charts category tests (Cycle 21f / Task 10).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@wellsfargo-starui/velocity-grid';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import { _resetCoerceCacheForTests } from '../../kernel/src/renderer/cellRenderers/sparkline/coerceToNumberArray';
import {
  winLossSparkline, yieldCurveSparkline, krdBarChart, depthLadderCell,
  lineSparkline, columnSparkline, areaSparkline, barSparkline, pieSparkline,
} from '../src/charts';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: [1, 2, 3, 4],
    valueFormatted: '',
    bounds: { x: 0, y: 0, w: 120, h: 32 },
    font: '13px Inter, sans-serif',
    fg: '#111111',
    bg: '#ffffff',
    borderColor: '#ccc',
    halign: 'left',
    prefillColor: '#ffffff',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
    ...overrides,
  };
}

describe('winLossSparkline', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints up/down 1px bars (nominal)', () => {
    winLossSparkline.paint(gc, baseConfig({
      rowData: { pnl: [1, -1, 2, -2] },
      params: { valuesField: 'pnl' },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBe(4);
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });

  it('no throw on empty array (edge)', () => {
    expect(() => winLossSparkline.paint(gc, baseConfig({
      rowData: { pnl: [] },
      params: { valuesField: 'pnl' },
    }))).not.toThrow();
  });

  it('reads value fallback (variant)', () => {
    winLossSparkline.paint(gc, baseConfig({ value: [2, -3], params: { valuesField: 'missing' } }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  // B5 — bars are a fixed 2px wide with a 1px gap (packed sparkline strip),
  // NOT stretched to fill each `w / data.length` slot — the prior layout
  // produced chunky blocks rather than thin bars at typical data lengths.
  it('paints fixed 2px-wide bars with a 1px gap (B5 geometry)', () => {
    winLossSparkline.paint(gc, baseConfig({
      rowData: { pnl: [1, -1, 2, -2] },
      params: { valuesField: 'pnl' },
    }));
    const rects = gc.calls.filter((c) => c.op === 'fillRect');
    expect(rects.length).toBe(4);
    for (const r of rects) expect(Number(r.args[2])).toBe(2);
    const xs = rects.map((r) => Number(r.args[0])).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBe(3); // 2px bar + 1px gap
    }
  });

  it('all bars share the same height regardless of magnitude (B5 geometry)', () => {
    winLossSparkline.paint(gc, baseConfig({
      rowData: { pnl: [1, -5, 20, -0.5] },
      params: { valuesField: 'pnl' },
    }));
    const rects = gc.calls.filter((c) => c.op === 'fillRect');
    const heights = new Set(rects.map((r) => Number(r.args[3])));
    expect(heights.size).toBe(1);
  });
});

describe('yieldCurveSparkline', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('polyline + tenor labels (nominal)', () => {
    yieldCurveSparkline.paint(gc, baseConfig({
      rowData: { y: [1.2, 1.5, 1.8, 2.0] },
      params: { tenors: ['2y', '5y', '10y', '30y'], valuesField: 'y', markerTenor: '10y' },
    }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBeGreaterThanOrEqual(4);
  });

  it('marker dot at own tenor (edge)', () => {
    yieldCurveSparkline.paint(gc, baseConfig({
      rowData: { y: [1, 2, 3] },
      params: { tenors: ['2y', '5y', '10y'], valuesField: 'y', markerTenor: '5y' },
    }));
    expect(gc.calls.some((c) => c.op === 'arc')).toBe(true);
  });

  it('no paint when fewer than 2 points (variant)', () => {
    yieldCurveSparkline.paint(gc, baseConfig({
      rowData: { y: [1] },
      params: { tenors: ['2y'], valuesField: 'y' },
    }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(false);
  });
});

describe('krdBarChart', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('micro histogram above/below zero (nominal)', () => {
    krdBarChart.paint(gc, baseConfig({
      rowData: { krd: [2, -1, 3, -2] },
      params: { tenors: ['2y', '5y', '10y', '30y'], valuesField: 'krd' },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBe(4);
  });

  it('center line stroke (edge)', () => {
    krdBarChart.paint(gc, baseConfig({
      rowData: { krd: [0, 0] },
      params: { tenors: ['2y', '5y'], valuesField: 'krd' },
    }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });

  it('no throw on missing field (variant)', () => {
    expect(() => krdBarChart.paint(gc, baseConfig({ params: { tenors: ['2y'], valuesField: 'krd' } }))).not.toThrow();
  });
});

describe('depthLadderCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('bid/ask ladder bars (nominal)', () => {
    depthLadderCell.paint(gc, baseConfig({
      rowData: {
        bidPx: [100, 99.9], bidSz: [500, 300],
        askPx: [100.1, 100.2], askSz: [400, 200],
      },
      params: {
        bidPricesField: 'bidPx', bidSizesField: 'bidSz',
        askPricesField: 'askPx', askSizesField: 'askSz', levels: 2,
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBe(4);
  });

  it('caps levels at 5 (edge)', () => {
    depthLadderCell.paint(gc, baseConfig({
      rowData: {
        bidPx: [1, 2, 3, 4, 5, 6], bidSz: [1, 1, 1, 1, 1, 1],
        askPx: [1, 2, 3, 4, 5, 6], askSz: [1, 1, 1, 1, 1, 1],
      },
      params: {
        bidPricesField: 'bidPx', bidSizesField: 'bidSz',
        askPricesField: 'askPx', askSizesField: 'askSz', levels: 9,
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBe(10);
  });

  it('no throw when rowData missing (variant)', () => {
    expect(() => depthLadderCell.paint(gc, baseConfig({
      params: {
        bidPricesField: 'bidPx', bidSizesField: 'bidSz',
        askPricesField: 'askPx', askSizesField: 'askSz',
      },
    }))).not.toThrow();
  });
});

describe('kernel sparkline re-exports', () => {
  let gc: FakeGc;
  beforeEach(() => {
    gc = makeFakeGc();
    _resetCoerceCacheForTests();
  });

  it('lineSparkline delegates with stroke (nominal)', () => {
    lineSparkline.paint(gc, baseConfig({ value: [1, 3, 2, 5] }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });

  it('columnSparkline delegates with fillRect bars (edge)', () => {
    columnSparkline.paint(gc, baseConfig({ value: [1, 3, 2] }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('area/bar/pie adapters paint without throw (variant)', () => {
    expect(() => areaSparkline.paint(gc, baseConfig({ value: [1, 2, 3, 4] }))).not.toThrow();
    expect(() => barSparkline.paint(gc, baseConfig({ value: [1, 2, 3] }))).not.toThrow();
    expect(() => pieSparkline.paint(gc, baseConfig({ value: [1, 2, 3, 4] }))).not.toThrow();
  });
});
