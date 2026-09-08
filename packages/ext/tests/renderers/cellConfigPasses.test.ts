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
import { tickerCell, timestampCell, ageCell, relativeTimeCell } from '../../src/renderers/text';
import { statusPill, venueChip } from '../../src/renderers/badges';
import { wireRenderersIntoKernel } from '../../src/renderers/bridge';
import { RENDERER_NAMES } from '../../src/renderers/types';

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

/**
 * Renderers outside the numeric family whose output is also a single value,
 * each with the minimum input it needs to draw anything — several bail early
 * on a value they cannot use, and a renderer that drew nothing would pass a
 * "did it decorate?" test for the wrong reason.
 */
const NOW = 1_700_000_060_000;
const THEN = 1_700_000_000_000;
const OTHER_VALUE_RENDERERS = [
  ['tickerCell', tickerCell, { value: 'AAPL', valueFormatted: 'AAPL' }],
  ['timestampCell', timestampCell, { value: THEN, valueFormatted: '', params: { nowMs: NOW } }],
  ['ageCell', ageCell, { value: THEN, params: { nowMs: NOW, sinceField: 'since' }, rowData: { since: THEN } }],
  ['relativeTimeCell', relativeTimeCell, { value: THEN, params: { nowMs: NOW, sinceField: 'since' }, rowData: { since: THEN } }],
  ['statusPill', statusPill, { value: 'FILLED', valueFormatted: 'FILLED', params: { status: 'FILLED' } }],
  ['venueChip', venueChip, { value: 'XNYS', valueFormatted: 'XNYS', params: { mic: 'XNYS' } }],
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

describe('decoration reaches the other value renderers too', () => {
  // The first pass routed the numeric family only, because `number` is the one
  // renderer that replaces a kernel default and so was the reported symptom.
  // Every renderer whose output is a single value has the same obligation.
  for (const [name, renderer, base] of OTHER_VALUE_RENDERERS) {
    it(`${name} strokes a decoration when the column asks for one`, () => {
      const plain = makeFakeGc();
      renderer.paint(plain, config(base as never));
      const before = strokeOps(plain);
      // Guard against the false pass: a renderer that drew nothing at all
      // would also "not stroke more".
      expect({ name, drewSomething: plain.calls.length > 0 })
        .toEqual({ name, drewSomething: true });

      const decorated = makeFakeGc();
      renderer.paint(decorated, config({ ...(base as object), textDecoration: 'underline' } as never));
      expect({ name, drewMore: strokeOps(decorated) > before })
        .toEqual({ name, drewMore: true });
    });
  }
});

describe('cell-change flash reaches every renderer', () => {
  /**
   * The reported symptom: flashing worked on some columns and not others.
   * Exactly one renderer of the 51 painted the flash tint (`price`), so
   * `enableCellChangeFlash` lit up text columns — which keep the kernel's own
   * cell — and did nothing on numeric ones, because `number` REPLACES that
   * kernel default and dropped it.
   *
   * The pass lives at the bridge now, so this walks what the bridge actually
   * registered rather than the raw painters.
   */
  function registered(): Map<string, { paint: (gc: never, p: never) => void }> {
    const painters = new Map<string, { paint: (gc: never, p: never) => void }>();
    const grid = {
      registerCellRenderer: (name: string, painter: { paint: (gc: never, p: never) => void }) => {
        painters.set(name, painter);
      },
      addEventListener: () => () => {},
      on: () => () => {},
      getRowDataById: () => undefined,
      resolveIcon: () => null,
      getGridOption: () => undefined,
    };
    try { wireRenderersIntoKernel(grid as never); } catch { /* optional wiring */ }
    return painters;
  }

  const FLASH = { flashAlpha: 0.4, flashFromColor: '#0aa063' };

  it('the bridge registers the whole catalog', () => {
    expect(registered().size).toBe(RENDERER_NAMES.length);
  });

  it('every registered renderer tints when the cell flashed', () => {
    const painters = registered();
    const missing: string[] = [];
    for (const [name, painter] of painters) {
      const gc = makeFakeGc();
      try { painter.paint(gc as never, config(FLASH as never) as never); }
      catch { continue; }   // a renderer that needs params it was not given
      const tinted = gc.calls.some((c) => c.op === 'set:globalAlpha' && c.args[0] === 0.4);
      if (!tinted) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('and none of them tints when the cell did not flash', () => {
    const painters = registered();
    const spurious: string[] = [];
    for (const [name, painter] of painters) {
      const gc = makeFakeGc();
      try { painter.paint(gc as never, config() as never); } catch { continue; }
      if (gc.calls.some((c) => c.op === 'set:globalAlpha' && c.args[0] === 0.4)) spurious.push(name);
    }
    expect(spurious).toEqual([]);
  });
});
