// Cycle 21c / Task 13 — composite cell renderer.
//
// Verifies the 'composite' painter: no-op guards, fragment text + icon
// drawing, per-fragment style, background handling via paintBackground,
// alignment, and ellipsis overflow.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { compositeCell } from '../src/renderer/cellRenderers/composite';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';
import { registerIconSet, _resetIconRegistry_forTests } from '../src/icons/registry';
import type { FormatProgramShape } from '../src/core/formatCompilerSlot';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class {
      constructor(_d?: string) {}
    };
  }
});

function makeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    // 7px per char keeps layout math deterministic across fragments.
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

function makeProgram(
  fragments: Array<{ text: string; style: Record<string, unknown>; icon?: { name: string; color?: string } }> | null,
): FormatProgramShape {
  return {
    formatText: () => fragments?.map((f) => f.text).join('') ?? '',
    resolveStyle: () => null,
    resolveIcon: () => null,
    resolveFragments: () => fragments as any,
    source: 'test',
    tiers: { tier0: false, tier1: false, tier2: true },
  };
}

const baseConfig = (over: Partial<CellPaintConfig> = {}): CellPaintConfig => ({
  value: null, valueFormatted: '',
  bounds: { x: 0, y: 0, w: 200, h: 24 },
  font: '400 13px Inter', fg: '#111', bg: '#fff', borderColor: '#ccc',
  halign: 'left', prefillColor: '#fff',
  isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  rowData: { symbol: 'AAPL', price: 150 },
  colId: 'summary',
  ...over,
});

describe('compositeCell — guards', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('no-ops when compositeProgram missing', () => {
    const gc = makeGc();
    expect(() => compositeCell.paint(gc, baseConfig())).not.toThrow();
    expect(gc.fillText as any).not.toHaveBeenCalled();
  });

  it('no-ops (after bg) when fragments resolve to null', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({ compositeProgram: makeProgram(null) }));
    expect(gc.fillText as any).not.toHaveBeenCalled();
  });

  it('no-ops (after bg) when fragments resolve to empty array', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({ compositeProgram: makeProgram([]) }));
    expect(gc.fillText as any).not.toHaveBeenCalled();
  });
});

describe('compositeCell — drawing', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('draws a single text fragment', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'AAPL', style: {} }]),
    }));
    expect(gc.fillText as any).toHaveBeenCalledTimes(1);
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('AAPL');
  });

  it('draws fragments left-to-right in row order', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([
        { text: 'AB', style: {} },
        { text: 'CD', style: {} },
      ]),
    }));
    const calls = (gc.fillText as any).mock.calls;
    expect(calls.map((c: unknown[]) => c[0])).toEqual(['AB', 'CD']);
    // Second fragment starts after the first (14px wide at 7px/char).
    expect(calls[1]![1]).toBeGreaterThan(calls[0]![1]);
  });

  it('applies per-fragment color; falls back to config fg', () => {
    const gc = makeGc();
    const colors: string[] = [];
    (gc.fillText as any).mockImplementation(() => colors.push(String((gc as any).fillStyle)));
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([
        { text: 'red', style: { color: '#d33' } },
        { text: 'plain', style: {} },
      ]),
    }));
    expect(colors).toEqual(['#d33', '#111']);
  });

  it('per-fragment bold weight lands in the canvas font', () => {
    const gc = makeGc();
    const fonts: string[] = [];
    (gc.fillText as any).mockImplementation(() => fonts.push(String((gc as any).font)));
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'B', style: { weight: 'bold' } }]),
    }));
    expect(fonts[0]).toContain('700');
    expect(fonts[0]).toContain('Inter');
  });

  it('draws icon via registry Path2D when fragment carries an icon', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'x', style: {}, icon: { name: 'star' } }]),
    }));
    expect(gc.stroke as any).toHaveBeenCalledTimes(1);
    expect(gc.translate as any).toHaveBeenCalled();
    expect(gc.scale as any).toHaveBeenCalled();
  });

  it('unresolvable icon name skips the icon but still draws text', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'x', style: {}, icon: { name: 'nope' } }]),
    }));
    expect(gc.stroke as any).not.toHaveBeenCalled();
    expect(gc.fillText as any).toHaveBeenCalled();
  });

  it('paints cell background when bg differs from prefillColor', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      bg: '#efe', prefillColor: '#fff',
      compositeProgram: makeProgram([{ text: 'x', style: {} }]),
    }));
    expect(gc.fillRect as any).toHaveBeenCalled();
  });

  it('skips background fill when bg === prefillColor', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      bg: '#fff', prefillColor: '#fff',
      compositeProgram: makeProgram([{ text: 'x', style: {} }]),
    }));
    expect(gc.fillRect as any).not.toHaveBeenCalled();
  });

  it('fragment background highlights its own run', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'hi', style: { background: '#ff0' } }]),
    }));
    expect(gc.fillRect as any).toHaveBeenCalled();
  });
});

describe('compositeCell — alignment', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  const twoFrags = () => makeProgram([
    { text: 'AB', style: {} },
    { text: 'CD', style: {} },
  ]);

  it('left (default) starts at padding', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({ compositeProgram: twoFrags() }));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(6);
  });

  it('center positions total width mid-cell', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: twoFrags(),
      compositeAlign: 'center',
    }));
    // total width = 4 chars * 7 = 28; (200 - 28) / 2 = 86.
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(86);
  });

  it('right ends at w - padding', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: twoFrags(),
      compositeAlign: 'right',
    }));
    // start = 200 - 6 - 28 = 166.
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(166);
  });
});

describe('compositeCell — overflow', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('ellipsis truncates the last fragment when total width exceeds cell', () => {
    const gc = makeGc();
    // 40 chars * 7px = 280px > 200 - 12 = 188 available.
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([
        { text: 'AAAAAAAAAA', style: {} },
        { text: 'B'.repeat(30), style: {} },
      ]),
    }));
    const calls = (gc.fillText as any).mock.calls;
    const lastText = String(calls[calls.length - 1]![0]);
    expect(lastText.endsWith('…')).toBe(true);
    // First fragment survives intact.
    expect(calls[0]![0]).toBe('AAAAAAAAAA');
  });

  it('single overlong fragment truncates character-by-character with ellipsis', () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'X'.repeat(50), style: {} }]),
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(String(text).endsWith('…')).toBe(true);
    // 188 available → at most 26 X's + ellipsis (27 * 7 = 189 > 188 → 25 + …).
    expect(String(text).length).toBeLessThan(30);
  });

  it("overflow: 'clip' draws full text without ellipsis", () => {
    const gc = makeGc();
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'X'.repeat(50), style: {} }]),
      compositeOverflow: 'clip',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('X'.repeat(50));
  });

  it('fits-exactly content is not truncated', () => {
    const gc = makeGc();
    // 26 chars * 7 = 182 <= 188 available.
    compositeCell.paint(gc, baseConfig({
      compositeProgram: makeProgram([{ text: 'Y'.repeat(26), style: {} }]),
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('Y'.repeat(26));
  });
});

// ─── Cycle 21e / final-review fix — rule-ref threading into the painter ──

import {
  registerRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../src/core/ruleEngineSlot';

describe('compositeCell — resolveRuleRef threading (Cycle 21e)', () => {
  beforeEach(() => {
    _resetIconRegistry_forTests();
    _resetRuleEngine_forTests();
  });

  /** Program that records the exact ctx resolveFragments receives. */
  function makeCapturingProgram(captured: unknown[]): FormatProgramShape {
    return {
      formatText: () => '',
      resolveStyle: () => null,
      resolveIcon: () => null,
      resolveFragments: (ctx: unknown) => {
        captured.push(ctx);
        return [{ text: 'z', style: {} }] as any;
      },
      source: 'test',
      tiers: { tier0: false, tier1: false, tier2: true },
    };
  }

  it('attaches resolveRuleRef when an engine is registered and rowId is present', () => {
    const seen: Array<{ ruleId: string; ctx: unknown }> = [];
    const engine: RuleEngineShape = {
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: (ruleId, ctx) => { seen.push({ ruleId, ctx }); return '#ff0000'; },
    };
    registerRuleEngine(engine);
    const captured: unknown[] = [];
    compositeCell.paint(makeGc(), baseConfig({
      compositeProgram: makeCapturingProgram(captured),
      rowId: 'r-7',
      themeKind: 'dark',
    }));
    expect(captured).toHaveLength(1);
    const ctx = captured[0] as {
      value: unknown; row: unknown; colId: string;
      resolveRuleRef?: (id: string) => string | null;
    };
    expect(typeof ctx.resolveRuleRef).toBe('function');
    expect(ctx.resolveRuleRef!('hot')).toBe('#ff0000');
    expect(seen[0]!.ruleId).toBe('hot');
    expect(seen[0]!.ctx).toMatchObject({ rowId: 'r-7', colId: 'summary', theme: 'dark' });
  });

  it('degrades to the plain 21c ctx when no engine is registered', () => {
    const captured: unknown[] = [];
    compositeCell.paint(makeGc(), baseConfig({
      compositeProgram: makeCapturingProgram(captured),
      rowId: 'r-7',
      themeKind: 'dark',
    }));
    const ctx = captured[0] as Record<string, unknown>;
    expect(ctx.resolveRuleRef).toBeUndefined();
    expect(ctx).toMatchObject({ colId: 'summary' });
  });

  it('degrades to the plain 21c ctx when rowId is absent (engine registered)', () => {
    registerRuleEngine({
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => '#ff0000',
    });
    const captured: unknown[] = [];
    compositeCell.paint(makeGc(), baseConfig({
      compositeProgram: makeCapturingProgram(captured),
    }));
    const ctx = captured[0] as Record<string, unknown>;
    expect(ctx.resolveRuleRef).toBeUndefined();
  });
});
