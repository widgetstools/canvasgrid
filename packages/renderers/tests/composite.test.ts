// @cgrid/renderers — composite category tests (Cycle 21f / Task 11).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import { SEMANTIC_COLORS } from '../src/palette';
import {
  stackedValueCell, priceQuoteCell, nbboCell, benchmarkSpreadCell, priceChangeComposite,
} from '../src/composite';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 100,
    valueFormatted: '100.00',
    bounds: { x: 0, y: 0, w: 180, h: 28 },
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
    rowData: {},
    ...overrides,
  };
}

describe('stackedValueCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('stacks primary + secondary right-aligned (nominal)', () => {
    stackedValueCell.paint(gc, baseConfig({
      valueFormatted: '234.56',
      rowData: { note: 'CUSIP' },
      params: { secondaryField: 'note' },
    }));
    const texts = gc.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toEqual(expect.arrayContaining(['234.56', 'CUSIP']));
  });

  it('primary-only when secondary missing (edge)', () => {
    stackedValueCell.paint(gc, baseConfig({ valueFormatted: '99.00', params: {} }));
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBe(1);
  });

  it('uses primaryField from rowData (variant)', () => {
    stackedValueCell.paint(gc, baseConfig({
      rowData: { px: '101.25' },
      params: { primaryField: 'px' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '101.25')).toBe(true);
  });
});

describe('priceQuoteCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints bid/ask/mid layout (nominal)', () => {
    priceQuoteCell.paint(gc, baseConfig({
      rowData: { bid: 100.1, ask: 100.3, mid: 100.2 },
      params: { bidField: 'bid', askField: 'ask', midField: 'mid' },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBeGreaterThanOrEqual(2);
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('WIDE tag when spread exceeds threshold (edge)', () => {
    priceQuoteCell.paint(gc, baseConfig({
      rowData: { bid: 100, ask: 100.2 },
      params: { bidField: 'bid', askField: 'ask', spreadWarnThreshold: 0.05 },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'WIDE')).toBe(true);
  });

  it('no throw without rowData (variant)', () => {
    expect(() => priceQuoteCell.paint(gc, baseConfig({
      params: { bidField: 'bid', askField: 'ask' },
      rowData: undefined,
    }))).not.toThrow();
  });

  // B4 — the spread band is a thin 2px bar, muted at 20% alpha when the
  // spread is within threshold — NOT the previous flat 4px, always
  // amber-tinted (0.45 alpha) block regardless of severity.
  it('paints a muted 2px band when the spread is within threshold (B4)', () => {
    priceQuoteCell.paint(gc, baseConfig({
      rowData: { bid: 100, ask: 100.02, mid: 100.01 },
      params: { bidField: 'bid', askField: 'ask', midField: 'mid', spreadWarnThreshold: 0.05 },
    }));
    const bandRect = gc.calls.find((c) => c.op === 'fillRect' && Number(c.args[3]) === 2);
    expect(bandRect).toBeDefined();
    const fillIdx = gc.calls.indexOf(bandRect!);
    const colorCall = [...gc.calls.slice(0, fillIdx)].reverse()
      .find((c) => c.op === 'set:fillStyle');
    expect(String(colorCall?.args[0])).toMatch(/rgba\(138,143,152,0\.2\)/);
  });

  it('paints a warning-tinted band at 40% alpha when the spread exceeds threshold (B4)', () => {
    priceQuoteCell.paint(gc, baseConfig({
      rowData: { bid: 100, ask: 100.2, mid: 100.1 },
      params: { bidField: 'bid', askField: 'ask', midField: 'mid', spreadWarnThreshold: 0.05 },
    }));
    const bandRect = gc.calls.find((c) => c.op === 'fillRect' && Number(c.args[3]) === 2);
    expect(bandRect).toBeDefined();
    const fillIdx = gc.calls.indexOf(bandRect!);
    const colorCall = [...gc.calls.slice(0, fillIdx)].reverse()
      .find((c) => c.op === 'set:fillStyle');
    expect(String(colorCall?.args[0])).toMatch(/rgba\(240,180,41,0\.4\)/);
  });
});

describe('nbboCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('formats bid/ask with venues (nominal)', () => {
    nbboCell.paint(gc, baseConfig({
      rowData: {
        bid: 100.1, bidSz: 500, bidVenue: 'XNAS',
        ask: 100.2, askSz: 300, askVenue: 'ARCX',
      },
      params: {
        bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidVenue',
        askField: 'ask', askSizeField: 'askSz', askVenueField: 'askVenue',
      },
    }));
    const joined = gc.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])).join(' ');
    expect(joined).toContain('100.10');
    expect(joined).toContain('@XNAS');
    expect(joined).toContain('@ARCX');
  });

  it('separator pipe between sides (edge)', () => {
    nbboCell.paint(gc, baseConfig({
      rowData: { bid: 1, bidSz: 1, bidVenue: 'XNAS', ask: 2, askSz: 2, askVenue: 'BATS' },
      params: {
        bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidVenue',
        askField: 'ask', askSizeField: 'askSz', askVenueField: 'askVenue',
      },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '|')).toBe(true);
  });

  it('no throw when rowData missing (variant)', () => {
    expect(() => nbboCell.paint(gc, baseConfig({
      params: {
        bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidVenue',
        askField: 'ask', askSizeField: 'askSz', askVenueField: 'askVenue',
      },
      rowData: undefined,
    }))).not.toThrow();
  });

  // Workstream A, part 2 (2026-07-06 CSS styling model) — venue palette
  // via CSS tokens, threaded through `p.palette.venue` (same open
  // `Record<string, string>` shape as `DEFAULT_VENUE_PALETTE`).
  it('reads p.palette.venue[mic] when present (Workstream A part 2)', () => {
    nbboCell.paint(gc, baseConfig({
      rowData: { bid: 100.1, bidSz: 500, bidVenue: 'XNAS' },
      params: {
        bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidVenue',
      },
      palette: {
        positive: '#000', negative: '#000', warning: '#000', info: '#000', muted: '#000',
        barHeight: 8, chipHeight: 16, chipRadius: 3,
        status: {} as never, rating: {} as never,
        venue: { XNAS: '#abcdef' },
      },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#abcdef')).toBe(true);
  });

  it('falls back to DEFAULT_VENUE_PALETTE when p.palette is absent (byte-identical)', () => {
    nbboCell.paint(gc, baseConfig({
      rowData: { bid: 100.1, bidSz: 500, bidVenue: 'XNAS' },
      params: {
        bidField: 'bid', bidSizeField: 'bidSz', bidVenueField: 'bidVenue',
      },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#3b82f6')).toBe(true);
  });
});

describe('benchmarkSpreadCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints signed bps + benchmark (nominal)', () => {
    benchmarkSpreadCell.paint(gc, baseConfig({
      rowData: { bps: 185, bench: 'T 4.25 05/34' },
      params: { bpsField: 'bps', benchmarkLabelField: 'bench' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && String(c.args[0]).includes('185'))).toBe(true);
    expect(gc.calls.some((c) => c.op === 'fillText' && String(c.args[0]).includes('T 4.25'))).toBe(true);
  });

  it('negative bps uses negative color (edge)', () => {
    benchmarkSpreadCell.paint(gc, baseConfig({
      rowData: { bps: -12, bench: 'BM' },
      params: { bpsField: 'bps', benchmarkLabelField: 'bench' },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.negative)).toBe(true);
  });

  it('no throw when bps missing (variant)', () => {
    expect(() => benchmarkSpreadCell.paint(gc, baseConfig({
      rowData: {},
      params: { bpsField: 'bps', benchmarkLabelField: 'bench' },
    }))).not.toThrow();
  });

  // B3 — the bps number always paints in full (never truncated); only the
  // trailing benchmark tag ellipsizes when the cell is too narrow to fit
  // it, instead of clipping mid-glyph past the cell edge.
  it('truncates the benchmark tag with an ellipsis in a narrow cell, keeping bps intact (B3)', () => {
    benchmarkSpreadCell.paint(gc, baseConfig({
      bounds: { x: 0, y: 0, w: 70, h: 28 },
      rowData: { bps: 185, bench: 'T 4.25 05/34' },
      params: { bpsField: 'bps', benchmarkLabelField: 'bench' },
    }));
    const texts = gc.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts.some((t) => t === '+185 bps')).toBe(true);
    expect(texts.some((t) => t.endsWith('…'))).toBe(true);
  });

  it('does not truncate when the benchmark tag fits (B3 nominal-width)', () => {
    benchmarkSpreadCell.paint(gc, baseConfig({
      bounds: { x: 0, y: 0, w: 400, h: 28 },
      rowData: { bps: 185, bench: 'T 4.25 05/34' },
      params: { bpsField: 'bps', benchmarkLabelField: 'bench' },
    }));
    const texts = gc.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes('T 4.25 05/34'))).toBe(true);
    expect(texts.some((t) => t.endsWith('…'))).toBe(false);
  });
});

describe('priceChangeComposite', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints price + arrow + deltas (nominal)', () => {
    priceChangeComposite.paint(gc, baseConfig({
      rowData: { price: 234.56, chg: 2.34, prev: 230 },
      params: { priceField: 'price', changeField: 'chg', prevCloseField: 'prev' },
    }));
    expect(gc.calls.some((c) => c.op === 'fill')).toBe(true);
    expect(gc.calls.some((c) => c.op === 'fillText' && String(c.args[0]).includes('+2.34'))).toBe(true);
  });

  it('flat arrow when zero change (edge)', () => {
    priceChangeComposite.paint(gc, baseConfig({
      rowData: { price: 10, chg: 0, prev: 10 },
      params: { changeField: 'chg', prevCloseField: 'prev', priceField: 'price' },
    }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });

  it('uses valueFormatted when price absent (variant)', () => {
    priceChangeComposite.paint(gc, baseConfig({
      value: null,
      valueFormatted: '50.00',
      rowData: { chg: 1, prev: 49 },
      params: { changeField: 'chg', prevCloseField: 'prev' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '50.00')).toBe(true);
  });
});
