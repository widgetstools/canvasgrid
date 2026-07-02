// @cgrid/renderers — indicators category tests (Cycle 21f / Task 7).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import { SEMANTIC_COLORS } from '../src/palette';
import {
  statusDot, quoteQualityDot, staleFlag, directionArrow,
  structureIconStrip, trafficLightCell, getLastStaleFlagTooltip,
} from '../src/indicators';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: '100.00',
    valueFormatted: '100.00',
    bounds: { x: 0, y: 0, w: 120, h: 24 },
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

function dotFillColors(calls: FakeGc['calls']): string[] {
  const colors: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    if (calls[i]!.op === 'set:fillStyle') colors.push(String(calls[i]!.args[0]));
  }
  return colors;
}

describe('statusDot', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints 8px dot with explicit color (nominal)', () => {
    statusDot.paint(gc, baseConfig({ params: { color: SEMANTIC_COLORS.positive } }));
    expect(gc.calls.some((c) => c.op === 'arc')).toBe(true);
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.positive);
  });

  it('paints optional label after dot (variant)', () => {
    statusDot.paint(gc, baseConfig({ params: { color: SEMANTIC_COLORS.info, label: 'Connected' } }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'Connected')).toBe(true);
  });

  it('reads colorField from rowData (edge)', () => {
    statusDot.paint(gc, baseConfig({
      rowData: { healthColor: SEMANTIC_COLORS.warning },
      params: { colorField: 'healthColor' },
    }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.warning);
  });
});

describe('quoteQualityDot', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('green when fresh+tight+deep (nominal)', () => {
    quoteQualityDot.paint(gc, baseConfig({
      rowData: { fresh: true, tight: true, deep: true },
      params: { freshField: 'fresh', tightField: 'tight', deepField: 'deep' },
    }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.positive);
  });

  it('red when stale (truth-table)', () => {
    quoteQualityDot.paint(gc, baseConfig({
      rowData: { fresh: true, tight: true, deep: true, stale: true },
      params: {
        freshField: 'fresh', tightField: 'tight', deepField: 'deep', staleField: 'stale',
      },
    }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.negative);
  });

  it('amber when partial quality (truth-table)', () => {
    quoteQualityDot.paint(gc, baseConfig({
      rowData: { fresh: true, tight: false, deep: false },
      params: { freshField: 'fresh', tightField: 'tight', deepField: 'deep' },
    }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.warning);
  });

  it('red when one-sided even if fresh (truth-table)', () => {
    quoteQualityDot.paint(gc, baseConfig({
      rowData: { fresh: true, tight: true, deep: true, oneSided: true },
      params: {
        freshField: 'fresh', tightField: 'tight', deepField: 'deep', oneSidedField: 'oneSided',
      },
    }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.negative);
  });
});

describe('staleFlag', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('applies globalAlpha 0.6 when stale (nominal)', () => {
    staleFlag.paint(gc, baseConfig({
      valueFormatted: '101.25',
      rowData: { lastTick: 1000 },
      params: { nowMs: 12000, lastTickField: 'lastTick', staleAfterMs: 8000 },
    }));
    expect(gc.calls.some((c) => c.op === 'set:globalAlpha' && c.args[0] === 0.6)).toBe(true);
    expect(gc.calls.some((c) => c.op === 'arc')).toBe(true);
    expect(getLastStaleFlagTooltip()).toBe('last tick 11s ago');
  });

  it('paints normally without alpha when fresh (edge)', () => {
    staleFlag.paint(gc, baseConfig({
      valueFormatted: '101.25',
      rowData: { lastTick: 9000 },
      params: { nowMs: 10000, lastTickField: 'lastTick', staleAfterMs: 8000 },
    }));
    expect(gc.calls.some((c) => c.op === 'set:globalAlpha')).toBe(false);
    expect(getLastStaleFlagTooltip()).toBeUndefined();
  });

  it('draws value text before stale icon (variant)', () => {
    staleFlag.paint(gc, baseConfig({
      valueFormatted: '99.50',
      rowData: { lastTick: 0 },
      params: { nowMs: 10000, lastTickField: 'lastTick' },
    }));
    const textIdx = gc.calls.findIndex((c) => c.op === 'fillText');
    const arcIdx = gc.calls.findIndex((c) => c.op === 'arc');
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(arcIdx).toBeGreaterThan(textIdx);
  });
});

describe('directionArrow', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints up triangle fill (nominal)', () => {
    directionArrow.paint(gc, baseConfig({ params: { direction: 'up' } }));
    expect(gc.calls.some((c) => c.op === 'fill')).toBe(true);
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.positive)).toBe(true);
  });

  it('paints flat line stroke (edge)', () => {
    directionArrow.paint(gc, baseConfig({ params: { direction: 'flat' } }));
    expect(gc.calls.some((c) => c.op === 'stroke')).toBe(true);
  });

  it('reads directionField from rowData (variant)', () => {
    directionArrow.paint(gc, baseConfig({
      rowData: { dir: 'down' },
      params: { directionField: 'dir' },
    }));
    expect(gc.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === SEMANTIC_COLORS.negative)).toBe(true);
  });
});

describe('structureIconStrip', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints two active flags with expected slot width (nominal)', () => {
    structureIconStrip.paint(gc, baseConfig({
      params: { flags: { callable: true, puttable: true } },
    }));
    const arcs = gc.calls.filter((c) => c.op === 'arc');
    expect(arcs.length).toBe(2);
    const firstCx = Number(arcs[0]!.args[0]);
    const secondCx = Number(arcs[1]!.args[0]);
    expect(secondCx - firstCx).toBe(14);
  });

  it('skips inactive flags (edge)', () => {
    structureIconStrip.paint(gc, baseConfig({
      params: { flags: { callable: true, sinker: false } },
    }));
    expect(gc.calls.filter((c) => c.op === 'arc').length).toBe(1);
  });

  it('labels active slots with abbreviations (variant)', () => {
    structureIconStrip.paint(gc, baseConfig({
      params: { flags: { floater: true, 'make-whole': true } },
    }));
    const texts = gc.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toEqual(expect.arrayContaining(['F', 'M']));
  });
});

describe('trafficLightCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints green RAG dot (nominal)', () => {
    trafficLightCell.paint(gc, baseConfig({ params: { state: 'green' } }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.positive);
  });

  it('paints amber from stateField (edge)', () => {
    trafficLightCell.paint(gc, baseConfig({
      rowData: { risk: 'amber' },
      params: { stateField: 'risk' },
    }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.warning);
  });

  it('paints red state (variant)', () => {
    trafficLightCell.paint(gc, baseConfig({ params: { state: 'red' } }));
    expect(dotFillColors(gc.calls)).toContain(SEMANTIC_COLORS.negative);
  });
});
