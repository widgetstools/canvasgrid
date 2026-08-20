import { describe, it, expect } from 'vitest';
import { parseTier1Brackets } from '../../../src/format/tier1/parser';

describe('Tier 1 parser', () => {
  it('parses [color=<expr>]', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: '[change] > 0 ? "#0a7" : "#d33"', interiorLoc: { start: 8, end: 40 }, loc: { start: 0, end: 41 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]!.channel).toBe('color');
    expect(r.nodes[0]!.ast).not.toBeNull();
  });

  it('parses [if <expr>] with sugar', () => {
    const r = parseTier1Brackets([
      { channel: 'if', interior: '[x] > 0', interiorLoc: { start: 4, end: 12 }, loc: { start: 0, end: 13 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes[0]!.channel).toBe('if');
  });

  it('applies sugar: if/then/else + hex + rule:', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: 'if [x] > 0 then #0a7 else rule:my-rule', interiorLoc: { start: 8, end: 48 }, loc: { start: 0, end: 49 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes[0]!.ruleRefs).toHaveLength(1);
    expect(r.nodes[0]!.ruleRefs[0]!.ruleId).toBe('my-rule');
  });

  it('wraps expression parse error as expression-parse with translated loc', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: '[x] > ', interiorLoc: { start: 8, end: 14 }, loc: { start: 0, end: 15 } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.error.code).toBe('expression-parse');
    expect(r.error.loc.start).toBeGreaterThanOrEqual(8);
  });

  it('rejects aggregate calls (compile-time) with not-yet-implemented', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: 'SUM([price]) > 0 ? "#0a7" : "#d33"', interiorLoc: { start: 8, end: 45 }, loc: { start: 0, end: 46 } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.error.code).toBe('expression-compile');
  });

  it('parses multiple brackets', () => {
    const r = parseTier1Brackets([
      { channel: 'color', interior: '[change] > 0 ? "#0a7" : "#d33"', interiorLoc: { start: 8, end: 40 }, loc: { start: 0, end: 41 } },
      { channel: 'bg', interior: '"#eef"', interiorLoc: { start: 46, end: 53 }, loc: { start: 41, end: 54 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes.map((n) => n.channel)).toEqual(['color', 'bg']);
  });
});
