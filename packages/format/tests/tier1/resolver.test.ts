import { describe, it, expect } from 'vitest';
import { parse as parseExpression } from '@wellsfargo-starui/velocity-grid-expression';
import { resolveStyle, resolveIcon, evaluateIfSelector } from '../../src/tier1/resolver';
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

  it('rule-ref node contributes null when ctx.resolveRuleRef is absent (accessor-absent branch — 21c behavior preserved)', () => {
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

describe('Tier 1 resolveStyle — rule refs (Cycle 21e)', () => {
  const pureRefNode = (channel: Tier1Node['channel'], ruleId: string): Tier1Node => ({
    channel,
    ast: null,
    ruleRefs: [{ kind: 'rule-ref', ruleId, loc: { start: 0, end: 5 + ruleId.length } }],
    loc: { start: 0, end: 10 },
  });

  it('accessor present: pure rule-ref resolves the color channel', () => {
    const style = resolveStyle([pureRefNode('color', 'hot')], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: (ruleId) => (ruleId === 'hot' ? '#ff0000' : null),
    });
    expect(style).toEqual({ color: '#ff0000' });
  });

  it('accessor present: pure rule-ref resolves the bg channel', () => {
    const style = resolveStyle([pureRefNode('bg', 'hot')], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: () => '#fff3e0',
    });
    expect(style).toEqual({ background: '#fff3e0' });
  });

  it('accessor returning null (rule not matched) → null style', () => {
    const style = resolveStyle([pureRefNode('color', 'hot')], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: () => null,
    });
    expect(style).toBeNull();
  });

  it('first non-null resolution wins across multiple rule refs, in order', () => {
    const node: Tier1Node = {
      channel: 'color',
      ast: null,
      ruleRefs: [
        { kind: 'rule-ref', ruleId: 'cold', loc: { start: 0, end: 9 } },
        { kind: 'rule-ref', ruleId: 'hot', loc: { start: 10, end: 18 } },
      ],
      loc: { start: 0, end: 20 },
    };
    const seen: string[] = [];
    const style = resolveStyle([node], {
      value: null, row: {}, colId: 'c',
      resolveRuleRef: (ruleId) => {
        seen.push(ruleId);
        return ruleId === 'hot' ? '#ff0000' : null;
      },
    });
    expect(style).toEqual({ color: '#ff0000' });
    expect(seen).toEqual(['cold', 'hot']);
  });

  it('[if rule:<id>] stays false — the accessor never drives section selection', () => {
    const node: Tier1Node = {
      channel: 'if',
      ast: null,
      ruleRefs: [{ kind: 'rule-ref', ruleId: 'hot', loc: { start: 0, end: 8 } }],
      loc: { start: 0, end: 12 },
    };
    const ctx = { value: null, row: {}, colId: 'c', resolveRuleRef: () => '#ff0000' };
    expect(evaluateIfSelector(node, ctx)).toBe(false);
    // resolveStyle also skips `if` nodes before any rule-ref consult.
    expect(resolveStyle([node], ctx)).toBeNull();
  });
});
