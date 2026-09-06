/**
 * Regression lock: numeric renderers must paint in the font they were handed.
 *
 * They used to append `"tnum"` to it, reaching for tabular numerals the way
 * CSS does with `font-variant-numeric`. Canvas 2D has no such property and the
 * token is illegal in the `font` shorthand, so the browser REJECTED the whole
 * assignment — silently, per spec, leaving whatever font was set last. The
 * visible symptom was narrow and confusing: changing the font size from the
 * formatting toolbar worked on text columns and did nothing on numeric ones,
 * because only numeric columns route through these renderers.
 *
 * The invariant is therefore simple and worth stating: a renderer may choose
 * a colour, an alignment or a glyph, but it must not rewrite the font.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@wellsfargo-starui/velocity-grid';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import {
  numberCell, priceCell, priceDirectionCell, pnlCell, deltaCell,
  bpsCell, pctChangeCell, fractionalPriceCell, abbreviatedNumberCell,
} from '../../src/renderers/numeric';

/** The real shape: a size, then a quoted, comma-separated family stack. */
const MONO = '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace';

function config(font: string, overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: 100, valueFormatted: '100.00',
    bounds: { x: 0, y: 0, w: 120, h: 24 },
    font,
    fg: '#111', bg: '#fff', borderColor: '#ccc',
    halign: 'right', prefillColor: '#fff',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
    ...overrides,
  };
}

const fontsSet = (gc: FakeGc): string[] =>
  gc.calls.filter((c) => c.op === 'set:font').map((c) => String(c.args[0]));

const RENDERERS = [
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

describe('numeric renderers keep the font they are given', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  for (const [name, renderer] of RENDERERS) {
    it(`${name} never rewrites the font`, () => {
      const font = `26px ${MONO}`;
      renderer.paint(gc, config(font));
      const seen = fontsSet(gc);
      // Some renderers set no font at all (they inherit); those that do must
      // set exactly what they were handed.
      for (const f of seen) expect(f).toBe(font);
    });

    it(`${name} carries an oversized font through`, () => {
      renderer.paint(gc, config(`26px ${MONO}`));
      const seen = fontsSet(gc);
      if (seen.length === 0) return;
      // The bug: the size the column asked for never reached the canvas.
      expect(seen.every((f) => f.startsWith('26px'))).toBe(true);
    });
  }

  it('never appends a font-feature token, which canvas rejects wholesale', () => {
    for (const [, renderer] of RENDERERS) {
      const g = makeFakeGc();
      renderer.paint(g, config(`18px ${MONO}`));
      for (const f of fontsSet(g)) {
        expect(f).not.toContain('tnum');
        // A canvas font shorthand ends with the family list. Anything after
        // it invalidates the whole declaration.
        expect(f.trimEnd().endsWith('"tnum"')).toBe(false);
      }
    }
  });

  it('the font it sets is a shape a canvas will accept', () => {
    // `size family` or `weight size family` / `style weight size family` — a
    // quoted token AFTER the family is what broke it.
    const shorthand = /^(?:(?:normal|italic|oblique)\s+)?(?:(?:normal|bold|lighter|bolder|\d{3})\s+)?\d+(?:\.\d+)?px\s+\S.*$/;
    for (const [name, renderer] of RENDERERS) {
      const g = makeFakeGc();
      renderer.paint(g, config(`13px ${MONO}`));
      for (const f of fontsSet(g)) {
        expect({ name, font: f, ok: shorthand.test(f) }).toEqual({ name, font: f, ok: true });
      }
    }
  });
});
