// @cgrid/renderers — bars category tests (Cycle 21f / Task 9).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import { SEMANTIC_COLORS } from '../src/palette';
import {
  progressBarCell, rangeBarCell, bidirectionalBarCell, heatCell,
  gaugeCell, spreadBarCell, volumeBar, maturityLadderBar,
} from '../src/bars';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 50,
    valueFormatted: '50',
    bounds: { x: 0, y: 0, w: 140, h: 24 },
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
    ...overrides,
  };
}

describe('progressBarCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints track + fill + label (nominal)', () => {
    progressBarCell.paint(gc, baseConfig({ params: { fraction: 0.5 } }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThanOrEqual(2);
    expect(gc.calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('clamps fraction above 1 (edge)', () => {
    progressBarCell.paint(gc, baseConfig({ params: { fraction: 1.5, showLabel: false } }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.positive)).toBe(true);
  });

  it('reads fractionField from rowData (variant)', () => {
    progressBarCell.paint(gc, baseConfig({
      rowData: { fill: 0.25 },
      params: { fractionField: 'fill', showLabel: false },
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  // B6 — label renders as a percent (never the raw `0.72` fraction) and is
  // right-aligned, drawn AFTER the track/fill.
  it('renders the label as a percent, right-aligned (B6)', () => {
    progressBarCell.paint(gc, baseConfig({ params: { fraction: 0.72 } }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '72%')).toBe(true);
    expect(gc.calls.some((c) => c.op === 'set:textAlign' && c.args[0] === 'right')).toBe(true);
  });

  it('draws the fill/track before the label (B6 z-order)', () => {
    progressBarCell.paint(gc, baseConfig({ params: { fraction: 0.5 } }));
    const fillIdx = gc.calls.findIndex((c) => c.op === 'fillRect');
    const textIdx = gc.calls.findIndex((c) => c.op === 'fillText');
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThan(fillIdx);
  });
});

describe('rangeBarCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints marker dot within range (nominal)', () => {
    rangeBarCell.paint(gc, baseConfig({
      rowData: { lo: 0, hi: 100, val: 50 },
      params: { minField: 'lo', maxField: 'hi', valueField: 'val' },
    }));
    expect(gc.calls.some((c) => c.op === 'arc')).toBe(true);
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBeGreaterThanOrEqual(2);
  });

  it('no marker when range invalid (edge)', () => {
    rangeBarCell.paint(gc, baseConfig({
      rowData: { lo: 10, hi: 10, val: 10 },
      params: { minField: 'lo', maxField: 'hi', valueField: 'val' },
    }));
    expect(gc.calls.some((c) => c.op === 'arc')).toBe(false);
  });

  it('track always drawn (variant)', () => {
    rangeBarCell.paint(gc, baseConfig({
      rowData: {},
      params: { minField: 'lo', maxField: 'hi', valueField: 'val' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });
});

describe('bidirectionalBarCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints right-side green bar for positive (nominal)', () => {
    bidirectionalBarCell.paint(gc, baseConfig({
      value: 40,
      params: { stats: { min: -50, max: 50, maxAbs: 50, sum: 0, count: 5 } },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.positive)).toBe(true);
  });

  it('paints left-side red bar for negative (edge)', () => {
    bidirectionalBarCell.paint(gc, baseConfig({
      value: -30,
      params: { stats: { min: -50, max: 50, maxAbs: 50, sum: 0, count: 5 } },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.negative)).toBe(true);
  });

  it('degrades without stats using abs(value) (variant)', () => {
    bidirectionalBarCell.paint(gc, baseConfig({ value: 10, params: {} }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThanOrEqual(2);
  });
});

describe('heatCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints full-cell background tint (nominal)', () => {
    heatCell.paint(gc, baseConfig({
      value: 75,
      valueFormatted: '75',
      params: { stats: { min: 0, max: 100, maxAbs: 100, sum: 500, count: 10 }, curve: 'lab' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect' && c.args[2] === 140)).toBe(true);
  });

  it('uses linear curve opt-out (edge)', () => {
    heatCell.paint(gc, baseConfig({
      value: 50,
      params: { stats: { min: 0, max: 100, maxAbs: 100, sum: 0, count: 2 }, curve: 'linear' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('midpoint tint when stats absent (variant)', () => {
    heatCell.paint(gc, baseConfig({ value: 0, valueFormatted: '0', params: {} }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });
});

describe('gaugeCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints segmented zones + tick (nominal)', () => {
    gaugeCell.paint(gc, baseConfig({
      value: 5,
      params: { min: -20, max: 20, zones: [-20, 0, 20] },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThanOrEqual(2);
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });

  it('no tick when value null (edge)', () => {
    gaugeCell.paint(gc, baseConfig({
      value: null,
      params: { min: 0, max: 100 },
    }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(false);
  });

  it('reads valueField (variant)', () => {
    gaugeCell.paint(gc, baseConfig({
      rowData: { v: 10 },
      params: { min: 0, max: 100, valueField: 'v' },
    }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });
});

describe('spreadBarCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints spread bar + mid label (nominal)', () => {
    spreadBarCell.paint(gc, baseConfig({
      rowData: { bid: 100, ask: 100.05 },
      params: { bidField: 'bid', askField: 'ask', history: { values: [0.04, 0.05, 0.06], window: 60 } },
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
    expect(gc.calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('escalates fill color when spread exceeds rolling band (edge)', () => {
    spreadBarCell.paint(gc, baseConfig({
      rowData: { bid: 100, ask: 100.5 },
      params: {
        bidField: 'bid', askField: 'ask',
        history: { values: [0.05, 0.05, 0.06, 0.04], window: 60 },
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThanOrEqual(2);
    expect(gc.calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('no throw when rowData missing (variant)', () => {
    expect(() => spreadBarCell.paint(gc, baseConfig({
      params: { bidField: 'bid', askField: 'ask' },
    }))).not.toThrow();
  });
});

describe('volumeBar', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('sizes bar to scope max (nominal)', () => {
    volumeBar.paint(gc, baseConfig({
      value: 500,
      valueFormatted: '500',
      params: { stats: { min: 0, max: 1000, maxAbs: 1000, sum: 5000, count: 10 } },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThanOrEqual(2);
  });

  it('reverse-out text color when bar covers text (edge)', () => {
    volumeBar.paint(gc, baseConfig({
      value: 900,
      valueFormatted: '900',
      params: {
        stats: { min: 0, max: 1000, maxAbs: 1000, sum: 0, count: 5 },
        reverseOutText: true,
      },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('degrades without stats (variant)', () => {
    volumeBar.paint(gc, baseConfig({ value: 100, params: {} }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream A (2026-07-06 CSS styling model) — renderer-palette threading.
// Geometry-as-style: `--cg-bar-height` → `RendererPalette.barHeight`,
// read by `innerBarRect()`. Colors: direct single-field SEMANTIC_COLORS
// reads (outside `colorsFromParams`) now resolve `p.palette?.<x>` first.
// ───────────────────────────────────────────────────────────────────────
describe('bars — Workstream A renderer palette', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('progressBarCell track height reads p.palette.barHeight when present', () => {
    progressBarCell.paint(gc, baseConfig({
      params: { fraction: 0.5, showLabel: false },
      palette: {
        positive: SEMANTIC_COLORS.positive, negative: SEMANTIC_COLORS.negative,
        warning: SEMANTIC_COLORS.warning, info: SEMANTIC_COLORS.info, muted: SEMANTIC_COLORS.muted,
        barHeight: 20, chipHeight: 16, chipRadius: 3,
      },
    }));
    const track = gc.calls.find((c) => c.op === 'fillRect');
    expect(track?.args[3]).toBe(20);
  });

  it('progressBarCell track height falls back to 8 when p.palette is absent (byte-identical)', () => {
    progressBarCell.paint(gc, baseConfig({ params: { fraction: 0.5, showLabel: false } }));
    const track = gc.calls.find((c) => c.op === 'fillRect');
    expect(track?.args[3]).toBe(8);
  });

  it('volumeBar reads info color from p.palette when present', () => {
    volumeBar.paint(gc, baseConfig({
      value: 100,
      valueFormatted: '100',
      params: {},
      palette: {
        positive: '#111111', negative: '#222222', warning: '#333333',
        info: '#010203', muted: '#444444', barHeight: 8, chipHeight: 16, chipRadius: 3,
      },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === 'rgba(1,2,3,0.45)')).toBe(true);
  });

  it('volumeBar falls back to SEMANTIC_COLORS.info when p.palette is absent (byte-identical)', () => {
    volumeBar.paint(gc, baseConfig({ value: 100, valueFormatted: '100', params: {} }));
    const expected = `rgba(${parseInt(SEMANTIC_COLORS.info.slice(1, 3), 16)},${parseInt(SEMANTIC_COLORS.info.slice(3, 5), 16)},${parseInt(SEMANTIC_COLORS.info.slice(5, 7), 16)},0.45)`;
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === expected)).toBe(true);
  });
});

describe('maturityLadderBar', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('segments by bucket notional (nominal)', () => {
    maturityLadderBar.paint(gc, baseConfig({
      rowData: { n01: 30, n13: 20, n10p: 50 },
      params: { bucketFields: { '0-1y': 'n01', '1-3y': 'n13', '10y+': 'n10p' } },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBe(3);
  });

  it('empty track when total zero (edge)', () => {
    maturityLadderBar.paint(gc, baseConfig({
      rowData: {},
      params: { bucketFields: { '0-1y': 'n01' } },
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('skips zero buckets (variant)', () => {
    maturityLadderBar.paint(gc, baseConfig({
      rowData: { n01: 100, n13: 0 },
      params: { bucketFields: { '0-1y': 'n01', '1-3y': 'n13' } },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillRect').length).toBe(1);
  });
});
