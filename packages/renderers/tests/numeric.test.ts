// @wellsfargo-starui/velocity-grid-renderers — numeric category tests (Cycle 21f / Task 5).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@wellsfargo-starui/velocity-grid';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import { SEMANTIC_COLORS } from '../src/palette';
import {
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell,
  bpsCell, pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
} from '../src/numeric';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 100,
    valueFormatted: '100.00',
    bounds: { x: 0, y: 0, w: 120, h: 24 },
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

function fillTexts(calls: FakeGc['calls']): string[] {
  return calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
}

describe('numberCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints right-aligned formatted value (nominal)', () => {
    numberCell.paint(gc, baseConfig());
    expect(fillTexts(gc.calls)).toContain('100.00');
    expect(gc.calls.some((c) => c.op === 'set:textAlign' && c.args[0] === 'right')).toBe(true);
  });

  it('handles empty value (edge)', () => {
    numberCell.paint(gc, baseConfig({ value: null, valueFormatted: '' }));
    expect(fillTexts(gc.calls)).toHaveLength(0);
  });

  it('applies signPolicy always without destroying host formatting (variant)', () => {
    numberCell.paint(gc, baseConfig({
      value: 1234.56,
      valueFormatted: '1,234.56',
      params: { signPolicy: 'always' },
    }));
    expect(fillTexts(gc.calls)).toContain('+1,234.56');
  });
});

describe('priceCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints flash overlay when flashAlpha set (nominal)', () => {
    priceCell.paint(gc, baseConfig({
      flashAlpha: 0.25,
      flashFromColor: '#0aa063',
    }));
    expect(gc.calls.some((c) => c.op === 'fillRect')).toBe(true);
    expect(gc.calls.some((c) => c.op === 'set:globalAlpha' && c.args[0] === 0.25)).toBe(true);
  });

  it('derives flash from prevField tick up (edge direction)', () => {
    priceCell.paint(gc, baseConfig({
      value: 101,
      valueFormatted: '101.00',
      rowData: { prev: 100 },
      params: { prevField: 'prev' },
      flashAlpha: 0.25,
    }));
    expect(fillTexts(gc.calls)).toContain('101.00');
  });

  it('no throw when rowData missing (edge)', () => {
    expect(() => priceCell.paint(gc, baseConfig({ rowData: undefined }))).not.toThrow();
  });
});

describe('priceDirectionCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints direction glyph + number (nominal up)', () => {
    priceDirectionCell.paint(gc, baseConfig({
      value: 102,
      valueFormatted: '102.00',
      rowData: { prev: 100 },
      params: { prevField: 'prev' },
    }));
    expect(gc.calls.some((c) => c.op === 'fill')).toBe(true);
    expect(fillTexts(gc.calls)).toContain('102.00');
  });

  it('flat tick uses muted fg (edge)', () => {
    priceDirectionCell.paint(gc, baseConfig({
      value: 100,
      rowData: { prev: 100 },
      params: { prevField: 'prev' },
    }));
    expect(fillTexts(gc.calls).length).toBeGreaterThan(0);
  });

  it('dark theme variant paints without throw', () => {
    priceDirectionCell.paint(gc, baseConfig({ themeKind: 'dark', fg: '#fff' }));
    expect(fillTexts(gc.calls)).toContain('100.00');
  });

  // B1 fix — canvas Y grows DOWNWARD, so an 'up' (▲) triangle's apex
  // (the moveTo point) must have the SMALLEST y of the three vertices
  // (visually the top), with both lineTo base vertices sharing the
  // LARGEST y (visually the bottom). This deliberately locks in the
  // corrected geometry — the prior implementation had apex/base swapped,
  // which painted 'up' as a downward-pointing ▼.
  it('up triangle apex is the topmost vertex (B1 geometry)', () => {
    priceDirectionCell.paint(gc, baseConfig({
      value: 102,
      rowData: { prev: 100 },
      params: { prevField: 'prev' },
    }));
    const moveTo = gc.calls.find((c) => c.op === 'moveTo')!;
    const lineTos = gc.calls.filter((c) => c.op === 'lineTo');
    const apexY = Number(moveTo.args[1]);
    const baseYs = lineTos.map((c) => Number(c.args[1]));
    expect(baseYs.every((y) => y > apexY)).toBe(true);
  });

  it('down triangle apex is the bottommost vertex (B1 geometry)', () => {
    priceDirectionCell.paint(gc, baseConfig({
      value: 98,
      rowData: { prev: 100 },
      params: { prevField: 'prev' },
    }));
    const moveTo = gc.calls.find((c) => c.op === 'moveTo')!;
    const lineTos = gc.calls.filter((c) => c.op === 'lineTo');
    const apexY = Number(moveTo.args[1]);
    const baseYs = lineTos.map((c) => Number(c.args[1]));
    expect(baseYs.every((y) => y < apexY)).toBe(true);
  });
});

describe('pnlCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('shows explicit sign and semantic color (positive nominal)', () => {
    pnlCell.paint(gc, baseConfig({ value: 42.5, valueFormatted: '' }));
    expect(fillTexts(gc.calls).some((t) => t.startsWith('+'))).toBe(true);
  });

  it('negative sign (edge)', () => {
    pnlCell.paint(gc, baseConfig({ value: -10, valueFormatted: '' }));
    expect(fillTexts(gc.calls).some((t) => t.startsWith('-'))).toBe(true);
  });

  it('null value — empty (edge)', () => {
    pnlCell.paint(gc, baseConfig({ value: null, valueFormatted: '' }));
    expect(fillTexts(gc.calls)).toHaveLength(0);
  });
});

describe('deltaCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('formats absolute + percent from rowData (nominal)', () => {
    deltaCell.paint(gc, baseConfig({
      rowData: { chg: 0.42, pct: 1.18 },
      params: { absoluteField: 'chg', percentField: 'pct' },
    }));
    const texts = fillTexts(gc.calls);
    expect(texts.some((t) => t === '+0.42')).toBe(true);
    expect(texts.some((t) => t === ' (+1.18%)')).toBe(true);
    expect(gc.calls.filter((c) => c.op === 'set:fillStyle').length).toBeGreaterThanOrEqual(2);
  });

  it('missing fields — em dash (edge)', () => {
    deltaCell.paint(gc, baseConfig({
      rowData: {},
      params: { absoluteField: 'chg', percentField: 'pct' },
    }));
    expect(fillTexts(gc.calls)[0]).toContain('—');
  });

  it('dark theme (variant)', () => {
    deltaCell.paint(gc, baseConfig({
      themeKind: 'dark',
      rowData: { chg: -1, pct: -2 },
      params: { absoluteField: 'chg', percentField: 'pct' },
    }));
    expect(fillTexts(gc.calls).length).toBe(2);
  });
});

describe('bpsCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('signed integer bps (nominal)', () => {
    bpsCell.paint(gc, baseConfig({ value: 12, valueFormatted: '' }));
    expect(fillTexts(gc.calls).some((t) => t.startsWith('+'))).toBe(true);
  });

  it('negative bps (edge)', () => {
    bpsCell.paint(gc, baseConfig({ value: -185, valueFormatted: '' }));
    expect(fillTexts(gc.calls).some((t) => t.includes('-185'))).toBe(true);
  });

  it('benchmark-relative coloring (variant)', () => {
    bpsCell.paint(gc, baseConfig({
      value: 10,
      rowData: { bench: 5 },
      params: { benchmarkField: 'bench' },
    }));
    expect(fillTexts(gc.calls).length).toBeGreaterThan(0);
  });
});

describe('pctChangeCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('two-decimal signed percent (nominal)', () => {
    pctChangeCell.paint(gc, baseConfig({ value: 1.184, valueFormatted: '' }));
    expect(fillTexts(gc.calls)[0]).toBe('+1.18%');
  });

  it('negative percent (edge)', () => {
    pctChangeCell.paint(gc, baseConfig({ value: -0.5, valueFormatted: '' }));
    expect(fillTexts(gc.calls)[0]).toBe('-0.50%');
  });

  it('custom precision (variant)', () => {
    pctChangeCell.paint(gc, baseConfig({
      value: 1.2345,
      params: { precision: 3 },
    }));
    expect(fillTexts(gc.calls)[0]).toBe('+1.234%');
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream A (2026-07-06 CSS styling model) — renderer-palette threading.
// `colorsFromParams()` resolves `overrides ?? p.palette?.<x> ?? SEMANTIC_
// COLORS.<x>`; sign === 0 routes through `colors.muted`, so pctChangeCell
// at value 0 is a clean vehicle for exercising the muted slot (extends the
// existing per-column `overrides` pattern with a theme-driven middle tier).
// ───────────────────────────────────────────────────────────────────────
describe('pctChangeCell — Workstream A renderer palette', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('reads muted color from p.palette when present (sign === 0)', () => {
    pctChangeCell.paint(gc, baseConfig({
      value: 0,
      palette: {
        positive: '#111111', negative: '#222222', warning: '#333333',
        info: '#444444', muted: '#0a0b0c', barHeight: 8, chipHeight: 16, chipRadius: 3,
        status: {} as never, rating: {} as never, venue: {},
      },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#0a0b0c')).toBe(true);
  });

  it('falls back to SEMANTIC_COLORS.muted when p.palette is absent (byte-identical)', () => {
    pctChangeCell.paint(gc, baseConfig({ value: 0 }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.muted)).toBe(true);
  });

  it('an explicit params.colors override still wins over p.palette', () => {
    pctChangeCell.paint(gc, baseConfig({
      value: 0,
      params: { colors: { muted: '#abcabc' } },
      palette: {
        positive: '#111111', negative: '#222222', warning: '#333333',
        info: '#444444', muted: '#0a0b0c', barHeight: 8, chipHeight: 16, chipRadius: 3,
        status: {} as never, rating: {} as never, venue: {},
      },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#abcabc')).toBe(true);
  });
});

describe('fractionalPriceCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('derives 99-16+ from decimal (nominal)', () => {
    fractionalPriceCell.paint(gc, baseConfig({
      value: 99.515625,
      valueFormatted: '',
    }));
    expect(fillTexts(gc.calls)[0]).toBe('99-16+');
  });

  it('passes through desk notation string (edge)', () => {
    fractionalPriceCell.paint(gc, baseConfig({ value: '99-16+', valueFormatted: '99-16+' }));
    expect(fillTexts(gc.calls)[0]).toBe('99-16+');
  });

  it('null — empty (edge)', () => {
    fractionalPriceCell.paint(gc, baseConfig({ value: null, valueFormatted: '' }));
    expect(fillTexts(gc.calls)).toHaveLength(0);
  });
});

describe('abbreviatedNumberCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('formats millions (nominal)', () => {
    abbreviatedNumberCell.paint(gc, baseConfig({ value: 1_200_000, valueFormatted: '' }));
    expect(fillTexts(gc.calls)[0]).toBe('1.2M');
  });

  it('formats thousands (edge)', () => {
    abbreviatedNumberCell.paint(gc, baseConfig({ value: 450_000, valueFormatted: '' }));
    expect(fillTexts(gc.calls)[0]).toBe('450.0K');
  });

  it('currency prefix (variant)', () => {
    abbreviatedNumberCell.paint(gc, baseConfig({
      value: 3_400_000_000,
      params: { currencyPrefix: '$' },
    }));
    expect(fillTexts(gc.calls)[0]).toBe('$3.4B');
  });
});
