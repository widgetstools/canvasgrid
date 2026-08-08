// @wellsfargo-starui/velocity-grid-renderers — text category tests (Cycle 21f / Task 6).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@wellsfargo-starui/velocity-grid';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import {
  tickerCell, currencyPairCell, timestampCell, ageCell, relativeTimeCell,
} from '../src/text';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 'AAPL',
    valueFormatted: 'AAPL',
    bounds: { x: 0, y: 0, w: 140, h: 28 },
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

function fillTextYs(calls: FakeGc['calls']): number[] {
  return calls.filter((c) => c.op === 'fillText').map((c) => Number(c.args[2] ?? 0));
}

describe('tickerCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('stacks primary + secondary lines (nominal)', () => {
    tickerCell.paint(gc, baseConfig({
      rowData: { cusip: '037833100' },
      params: { secondaryField: 'cusip' },
    }));
    const ys = fillTextYs(gc.calls);
    expect(ys.length).toBe(2);
    expect(ys[0]!).toBeLessThan(ys[1]!);
    expect(gc.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(
      expect.arrayContaining(['AAPL', '037833100']),
    );
  });

  it('never abbreviates ticker — full string (edge)', () => {
    tickerCell.paint(gc, baseConfig({ valueFormatted: 'BRK.A' }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'BRK.A')).toBe(true);
  });

  it('dark theme secondary opacity (variant)', () => {
    tickerCell.paint(gc, baseConfig({
      themeKind: 'dark',
      fg: '#ffffff',
      rowData: { cusip: 'X' },
      params: { secondaryField: 'cusip' },
    }));
    expect(fillTextYs(gc.calls).length).toBe(2);
  });
});

describe('currencyPairCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('pair left, rate right mono (nominal)', () => {
    currencyPairCell.paint(gc, baseConfig({
      rowData: { pair: 'EUR/USD', rate: '1.0834' },
      params: { pairField: 'pair', rateField: 'rate' },
    }));
    const texts = gc.calls.filter((c) => c.op === 'fillText');
    expect(texts.some((c) => c.args[0] === 'EUR/USD')).toBe(true);
    expect(texts.some((c) => c.args[0] === '1.0834')).toBe(true);
    expect(gc.calls.some((c) => c.op === 'set:textAlign' && c.args[0] === 'right')).toBe(true);
  });

  it('missing rowData — empty strings (edge)', () => {
    currencyPairCell.paint(gc, baseConfig({
      params: { pairField: 'pair', rateField: 'rate' },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBe(2);
  });

  it('dark theme (variant)', () => {
    currencyPairCell.paint(gc, baseConfig({
      themeKind: 'dark',
      rowData: { pair: 'GBP/USD', rate: '1.27' },
      params: { pairField: 'pair', rateField: 'rate' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText')).toBe(true);
  });
});

describe('timestampCell', () => {
  const noonUtc = Date.UTC(2026, 6, 2, 12, 0, 0, 0);

  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('formats HH:MM:SS.mmm today (nominal)', () => {
    timestampCell.paint(gc, baseConfig({
      value: noonUtc,
      params: { nowMs: noonUtc + 1000 },
      font: "13px 'Inter', system-ui, sans-serif",
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && String(c.args[0]).includes('12:00:00'))).toBe(true);
    const monoFontCall = gc.calls.find((c) => c.op === 'set:font' && String(c.args[0]).startsWith('13px ui-monospace'));
    expect(monoFontCall).toBeDefined();
  });

  it('prefixes date when not today (edge)', () => {
    const yesterday = noonUtc - 86_400_000;
    timestampCell.paint(gc, baseConfig({
      value: yesterday,
      params: { nowMs: noonUtc },
    }));
    const texts = gc.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes('2026'))).toBe(true);
  });

  it('invalid value — no throw (edge)', () => {
    expect(() => timestampCell.paint(gc, baseConfig({ value: 'n/a', params: { nowMs: noonUtc } }))).not.toThrow();
  });
});

describe('ageCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('15s elapsed — neutral/muted (nominal)', () => {
    ageCell.paint(gc, baseConfig({
      rowData: { t0: 1_000_000 },
      params: { nowMs: 1_000_000 + 15_000, sinceField: 't0' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '00:15')).toBe(true);
  });

  it('120s — warning amber (edge)', () => {
    ageCell.paint(gc, baseConfig({
      rowData: { t0: 0 },
      params: { nowMs: 120_000, sinceField: 't0' },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#f0b429')).toBe(true);
  });

  it('400s — danger red (variant)', () => {
    ageCell.paint(gc, baseConfig({
      rowData: { t0: 0 },
      params: { nowMs: 400_000, sinceField: 't0' },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#fb7185')).toBe(true);
  });
});

describe('relativeTimeCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('"just now" under 5s (nominal)', () => {
    relativeTimeCell.paint(gc, baseConfig({
      rowData: { t0: 1000 },
      params: { nowMs: 3000, sinceField: 't0' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'just now')).toBe(true);
  });

  it('"3m ago" at 3 minutes (edge)', () => {
    relativeTimeCell.paint(gc, baseConfig({
      rowData: { t0: 0 },
      params: { nowMs: 180_000, sinceField: 't0' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === '3m ago')).toBe(true);
  });

  it('dark theme (variant)', () => {
    relativeTimeCell.paint(gc, baseConfig({
      themeKind: 'dark',
      rowData: { t0: 0 },
      params: { nowMs: 10_000, sinceField: 't0' },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText')).toBe(true);
  });
});
