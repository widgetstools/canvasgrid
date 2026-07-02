import { describe, it, expect } from 'vitest';
import { parse as parseExpression } from '@cgrid/expression';
import { resolveStyle, resolveIcon } from '../../src/tier1/resolver';
import type { Tier1Node } from '../../src/tier1/parser';

function makeAst(expr: string) {
  const r = parseExpression(expr);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
}

describe('Tier 1 resolveStyle', () => {
  it('resolves [color=<expr>] to StyleObj.color', () => {
    const nodes: Tier1Node[] = [{
      channel: 'color',
      ast: makeAst('([x] > 0) ? ("#0a7") : ("#d33")'),
      ruleRefs: [],
      loc: { start: 0, end: 30 },
    }];
    const posStyle = resolveStyle(nodes, { value: null, row: { x: 5 }, colId: 'c' });
    expect(posStyle?.color).toBe('#0a7');
    const negStyle = resolveStyle(nodes, { value: null, row: { x: -5 }, colId: 'c' });
    expect(negStyle?.color).toBe('#d33');
  });

  it('resolves [bg=<expr>] to StyleObj.background', () => {
    const nodes: Tier1Node[] = [{
      channel: 'bg',
      ast: makeAst('"#eef"'),
      ruleRefs: [],
      loc: { start: 0, end: 10 },
    }];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style?.background).toBe('#eef');
  });

  it('resolves [weight=<expr>]', () => {
    const nodes: Tier1Node[] = [{
      channel: 'weight',
      ast: makeAst('"bold"'),
      ruleRefs: [],
      loc: { start: 0, end: 10 },
    }];
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })?.weight).toBe('bold');
  });

  it('resolves [style=italic]', () => {
    const nodes: Tier1Node[] = [{
      channel: 'style',
      ast: makeAst('"italic"'),
      ruleRefs: [],
      loc: { start: 0, end: 10 },
    }];
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })?.italic).toBe(true);
  });

  it('multiple brackets compose additively', () => {
    const nodes: Tier1Node[] = [
      { channel: 'color', ast: makeAst('"#0a7"'), ruleRefs: [], loc: { start: 0, end: 10 } },
      { channel: 'bg', ast: makeAst('"#eef"'), ruleRefs: [], loc: { start: 11, end: 20 } },
    ];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style).toEqual({ color: '#0a7', background: '#eef' });
  });

  it('later bracket wins for same channel', () => {
    const nodes: Tier1Node[] = [
      { channel: 'color', ast: makeAst('"#0a7"'), ruleRefs: [], loc: { start: 0, end: 10 } },
      { channel: 'color', ast: makeAst('"#d33"'), ruleRefs: [], loc: { start: 11, end: 20 } },
    ];
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })?.color).toBe('#d33');
  });

  it('rule-ref node returns null (Cycle 21e reserve)', () => {
    const nodes: Tier1Node[] = [{
      channel: 'color',
      ast: null,
      ruleRefs: [{ kind: 'rule-ref', ruleId: 'up', loc: { start: 0, end: 7 } }],
      loc: { start: 0, end: 10 },
    }];
    const style = resolveStyle(nodes, { value: null, row: {}, colId: 'c' });
    expect(style).toBeNull();
  });

  it('empty nodes returns null', () => {
    expect(resolveStyle([], { value: null, row: {}, colId: 'c' })).toBeNull();
  });

  it('boolean [if] result true keeps style channel active (no-op on style)', () => {
    const nodes: Tier1Node[] = [{
      channel: 'if',
      ast: makeAst('true'),
      ruleRefs: [],
      loc: { start: 0, end: 5 },
    }];
    // [if] doesn't produce a style channel; it's a section selector.
    expect(resolveStyle(nodes, { value: null, row: {}, colId: 'c' })).toBeNull();
  });

  it('NaN weight normalizes to "normal"', () => {
    const nodes: Tier1Node[] = [{
      channel: 'weight',
      ast: makeAst('[w]'),
      ruleRefs: [],
      loc: { start: 0, end: 5 },
    }];
    const style = resolveStyle(nodes, { value: null, row: { w: NaN }, colId: 'c' });
    expect(style?.weight).toBe('normal');
  });
});

describe('Tier 1 resolveIcon', () => {
  it('static icon token returns IconRef.name', () => {
    const icon = resolveIcon([{ name: 'trending-up' }], { value: null, row: {}, colId: 'c' });
    expect(icon).toEqual({ name: 'trending-up', position: 'leading' });
  });

  it('dynamic icon expression evaluates per row', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: '[change] > 0 ? "trending-up" : "trending-down"' }],
      { value: null, row: { change: 5 }, colId: 'c' },
    );
    expect(icon?.name).toBe('trending-up');
  });

  it('first icon token wins (only one icon per format string)', () => {
    const icon = resolveIcon(
      [{ name: 'trending-up' }, { name: 'trending-down' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon?.name).toBe('trending-up');
  });

  it('empty icon-token list returns null', () => {
    expect(resolveIcon([], { value: null, row: {}, colId: 'c' })).toBeNull();
  });

  it('null dynamicExpr result returns null icon', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: 'null' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon).toBeNull();
  });

  it('dynamicExpr returning false returns null icon', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: 'false' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon).toBeNull();
  });

  it('dynamicExpr returning number returns null icon', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: '42' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon).toBeNull();
  });

  it('dynamicExpr returning empty string returns null icon', () => {
    const icon = resolveIcon(
      [{ name: '', dynamicExpr: '""' }],
      { value: null, row: {}, colId: 'c' },
    );
    expect(icon).toBeNull();
  });
});
