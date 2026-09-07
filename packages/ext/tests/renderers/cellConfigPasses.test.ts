/**
 * A renderer decides how a value LOOKS. It does not get to decide which parts
 * of the column's configuration apply.
 *
 * Every renderer in this catalog used to drop several: underline and
 * strike-through, letter spacing, per-cell borders, decorator overlays — all
 * painted by the kernel's built-in cells and by none of these. Numeric
 * renderers additionally hard-coded right alignment, so the toolbar's align
 * buttons were dead there too.
 *
 * It surfaced as a baffling asymmetry rather than an obvious bug: the
 * formatting toolbar worked on text columns and did nothing on numeric ones.
 * The reason is that `number` is the one renderer here that REPLACES a kernel
 * default, so it is used by every numeric column the moment the bridge is
 * wired, while the rest are opt-in.
 *
 * These tests hold the line for the whole catalog, not just the case that was
 * reported.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@wellsfargo-starui/velocity-grid';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import {
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell,
  bpsCell, pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
} from '../../src/renderers/numeric';

const VALUE_RENDERERS = [
  ['numberCell', numberCell],
  ['priceCell', priceCell],
  ['priceDirectionCell', priceDirectionCell],
  ['pnlCell', pnlCell],
  ['deltaCell', deltaCell],
  ['bpsCell', bpsCell],
  ['pctChangeCell', pctChangeCell],
  ['fractionalPriceCell', fractionalPriceCell],
  ['abbreviatedNumberCell', abbreviatedNumberCell],
] as const;

function config(over: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 101.5, valueFormatted: '101.500',
    bounds: { x: 0, y: 0, w: 140, h: 24 },
    font: '13px monospace',
    fg: '#111', bg: '#fff', borderColor: '#ccc',
    halign: 'right', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    ...over,
  };
}

/** Underline and strike-through are drawn as a stroked line under/through the
 *  text, so a decorated cell strokes where an undecorated one does not. */
const strokeOps = (gc: FakeGc) =>
  gc.calls.filter((c) => c.op === 'stroke' || c.op === 'lineTo' || c.op === 'moveTo').length;

const alignsUsed = (gc: FakeGc) =>
  gc.calls.filter((c) => c.op === 'set:textAlign').map((c) => String(c.args[0]));

describe('text decoration reaches numeric renderers', () => {
  let plain: FakeGc;
  beforeEach(() => { plain = makeFakeGc(); });

  for (const [name, renderer] of VALUE_RENDERERS) {
    it(`${name} draws an underline when the column asks for one`, () => {
      renderer.paint(plain, config());
      const before = strokeOps(plain);

      const decorated = makeFakeGc();
      renderer.paint(decorated, config({ textDecoration: 'underline' }));
      expect({ name, drewMore: strokeOps(decorated) > before })
        .toEqual({ name, drewMore: true });
    });

    it(`${name} draws a strike-through when the column asks for one`, () => {
      renderer.paint(plain, config());
      const before = strokeOps(plain);

      const struck = makeFakeGc();
      renderer.paint(struck, config({ textDecoration: 'line-through' }));
      expect({ name, drewMore: strokeOps(struck) > before })
        .toEqual({ name, drewMore: true });
    });

    it(`${name} draws nothing extra when the column asks for none`, () => {
      renderer.paint(plain, config());
      const before = strokeOps(plain);
      const none = makeFakeGc();
      renderer.paint(none, config({ textDecoration: 'none' }));
      expect({ name, same: strokeOps(none) === before }).toEqual({ name, same: true });
    });
  }
});

describe('numeric renderers honour the column alignment', () => {
  it('defaults to right, because figures line up on the decimal', () => {
    const gc = makeFakeGc();
    numberCell.paint(gc, config({ halign: undefined }));
    expect(alignsUsed(gc)).toContain('right');
  });

  it.each(['left', 'center'] as const)('follows halign: %s', (halign) => {
    const gc = makeFakeGc();
    numberCell.paint(gc, config({ halign }));
    // Hard-coding 'right' here made the toolbar's align buttons dead on every
    // numeric column.
    expect(alignsUsed(gc)).toContain(halign);
  });
});
