// @cgrid/renderers — "look-and-feel" / Task 1: sign-aware painters resolve
// positive/negative color from the theme-threaded `p.posColor`/`p.negColor`
// (kernel `propertyChain.ts` ← `ResolvedTheme.posColor/negColor` ← CSS
// `--cg-pos-color`/`--cg-neg-color`) instead of the hard-coded
// `SEMANTIC_COLORS.positive/negative`, while still honouring an explicit
// per-column `params.colors` override and still falling back to
// `SEMANTIC_COLORS` for un-themed grids (p.posColor/negColor undefined).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import { SEMANTIC_COLORS } from '../src/palette';
import { labInterpolate, withAlpha } from '../src/paintUtils';
import { pnlCell } from '../src/numeric';
import { bidirectionalBarCell, heatCell } from '../src/bars';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 100,
    valueFormatted: '',
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

function fillStyles(calls: FakeGc['calls']): unknown[] {
  return calls.filter((c) => c.op === 'set:fillStyle').map((c) => c.args[0]);
}

describe('pnlCell — theme sign colors', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('uses p.posColor for a positive value when the theme declares it', () => {
    pnlCell.paint(gc, baseConfig({ value: 42.5, posColor: '#6aa9e0' }));
    expect(fillStyles(gc.calls)).toContain('#6aa9e0');
    expect(fillStyles(gc.calls)).not.toContain(SEMANTIC_COLORS.positive);
  });

  it('uses p.negColor for a negative value when the theme declares it', () => {
    pnlCell.paint(gc, baseConfig({ value: -10, negColor: '#e0876a' }));
    expect(fillStyles(gc.calls)).toContain('#e0876a');
    expect(fillStyles(gc.calls)).not.toContain(SEMANTIC_COLORS.negative);
  });

  it('falls back to SEMANTIC_COLORS.positive when p.posColor is undefined (un-themed grid)', () => {
    pnlCell.paint(gc, baseConfig({ value: 42.5, posColor: undefined }));
    expect(fillStyles(gc.calls)).toContain(SEMANTIC_COLORS.positive);
  });

  it('explicit per-column params.colors override still wins over p.posColor', () => {
    pnlCell.paint(gc, baseConfig({
      value: 42.5,
      posColor: '#6aa9e0',
      params: { colors: { positive: '#00ff00' } },
    }));
    expect(fillStyles(gc.calls)).toContain('#00ff00');
    expect(fillStyles(gc.calls)).not.toContain('#6aa9e0');
  });
});

describe('bidirectionalBarCell — theme sign colors', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('uses p.posColor to fill the positive-side bar', () => {
    bidirectionalBarCell.paint(gc, baseConfig({ value: 10, posColor: '#6aa9e0' }));
    expect(fillStyles(gc.calls)).toContain('#6aa9e0');
    expect(fillStyles(gc.calls)).not.toContain(SEMANTIC_COLORS.positive);
  });

  it('uses p.negColor to fill the negative-side bar', () => {
    bidirectionalBarCell.paint(gc, baseConfig({ value: -10, negColor: '#e0876a' }));
    expect(fillStyles(gc.calls)).toContain('#e0876a');
    expect(fillStyles(gc.calls)).not.toContain(SEMANTIC_COLORS.negative);
  });

  it('falls back to SEMANTIC_COLORS when p.posColor/negColor are undefined', () => {
    bidirectionalBarCell.paint(gc, baseConfig({ value: 10 }));
    expect(fillStyles(gc.calls)).toContain(SEMANTIC_COLORS.positive);
  });

  it('explicit per-column params.colors override still wins over p.posColor', () => {
    bidirectionalBarCell.paint(gc, baseConfig({
      value: 10,
      posColor: '#6aa9e0',
      params: { colors: { positive: '#00ff00' } },
    }));
    expect(fillStyles(gc.calls)).toContain('#00ff00');
    expect(fillStyles(gc.calls)).not.toContain('#6aa9e0');
  });
});

describe('heatCell — theme sign colors', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('interpolates between p.negColor/p.posColor endpoints when the theme declares them', () => {
    const stats = { count: 2, min: 0, max: 100, sum: 100, maxAbs: 100 };
    gc = makeFakeGc();
    heatCell.paint(gc, baseConfig({
      value: 100,
      posColor: '#6aa9e0',
      negColor: '#e0876a',
      params: { stats },
    }));
    const expectedTop = withAlpha(labInterpolate('#e0876a', '#6aa9e0', 1, 'lab'), 0.22);
    expect(fillStyles(gc.calls)).toContain(expectedTop);
  });

  it('falls back to SEMANTIC_COLORS endpoints when posColor/negColor are undefined', () => {
    const stats = { count: 2, min: 0, max: 100, sum: 100, maxAbs: 100 };
    heatCell.paint(gc, baseConfig({ value: 100, params: { stats } }));
    const expectedTop = withAlpha(labInterpolate(SEMANTIC_COLORS.negative, SEMANTIC_COLORS.positive, 1, 'lab'), 0.22);
    expect(fillStyles(gc.calls)).toContain(expectedTop);
  });
});

// Regression (look-and-feel surface #3): a custom cellRenderer fully replaces
// the kernel's default paint (which draws the cell-change flash), so each
// renderer must paint the flash overlay itself — else columns using pnl /
// bidirectional-bar / heat silently lose their live-update flash.
describe('cell-change flash overlay — custom renderers must flash', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });
  const flash = (extra: Partial<CellPaintConfig>) =>
    baseConfig({ flashAlpha: 0.5, flashFromColor: '#3b82f6', ...extra });

  it('pnlCell paints the flash fill when flashAlpha > 0', () => {
    pnlCell.paint(gc, flash({ value: 10 }));
    expect(fillStyles(gc.calls)).toContain('#3b82f6');
  });
  it('bidirectionalBarCell paints the flash fill', () => {
    bidirectionalBarCell.paint(gc, flash({ value: 10 }));
    expect(fillStyles(gc.calls)).toContain('#3b82f6');
  });
  it('heatCell paints the flash fill', () => {
    heatCell.paint(gc, flash({ value: 10 }));
    expect(fillStyles(gc.calls)).toContain('#3b82f6');
  });
  it('no flash fill when flashAlpha is absent', () => {
    pnlCell.paint(gc, baseConfig({ value: 10, flashFromColor: '#3b82f6' }));
    expect(fillStyles(gc.calls)).not.toContain('#3b82f6');
  });
});
