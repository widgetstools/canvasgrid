import { describe, it, expect } from 'vitest';
import { compileFormat, compileCompositeColDef } from '../src/compile';
import type { CompositeColDef } from '../src/types';

describe('compileFormat — Tier 0', () => {
  it('compiles a simple number format', () => {
    const r = compileFormat('0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.formatText({ value: 1.5, row: {}, colId: 'x' })).toBe('1.50');
    expect(r.program.tiers.tier0).toBe(true);
    expect(r.program.tiers.tier1).toBe(false);
    expect(r.program.tiers.tier2).toBe(false);
  });

  it('compiles a currency format with sections', () => {
    const r = compileFormat('$#,##0.00;[Red]-$#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.formatText({ value: 1234.5, row: {}, colId: 'x' })).toBe('$1,234.50');
    expect(r.program.formatText({ value: -1234.5, row: {}, colId: 'x' })).toBe('-$1,234.50');
    const negStyle = r.program.resolveStyle({ value: -1234.5, row: {}, colId: 'x' });
    expect(negStyle?.color).toBe('var(--cg-neg-color, #E53935)');
  });
});

describe('compileFormat — Tier 1', () => {
  it('compiles [color=<expr>]', () => {
    // Single-bracket field refs: [color=[change] > 0 ? "#0a7" : "#d33"]
    const r = compileFormat('[color=[change] > 0 ? "#0a7" : "#d33"] $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.tiers.tier1).toBe(true);

    const posStyle = r.program.resolveStyle({ value: 100, row: { change: 5 }, colId: 'x' });
    expect(posStyle?.color).toBe('#0a7');

    const negStyle = r.program.resolveStyle({ value: 100, row: { change: -5 }, colId: 'x' });
    expect(negStyle?.color).toBe('#d33');
  });

  it('compiles {icon:name}', () => {
    const r = compileFormat('{icon:trending-up} $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const icon = r.program.resolveIcon({ value: 100, row: {}, colId: 'x' });
    expect(icon?.name).toBe('trending-up');
  });

  it('compiles {icon:name|<expr>} dynamic', () => {
    const r = compileFormat('{icon:x|[change] > 0 ? "trending-up" : "trending-down"} $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const posIcon = r.program.resolveIcon({ value: 100, row: { change: 5 }, colId: 'x' });
    expect(posIcon?.name).toBe('trending-up');
  });

  it('[if <expr>] section selectors route by predicate, not by value sign', () => {
    const r = compileFormat('[if [qty] > 100] "BLOCK";[if [qty] > 50] "LOT"; "ODD"');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);

    const fmt = (qty: number): string =>
      r.program.formatText({ value: qty, row: { qty }, colId: 'x' }).trim();
    expect(fmt(220)).toBe('BLOCK');
    expect(fmt(75)).toBe('LOT');
    expect(fmt(8)).toBe('ODD');    // all positive values — sign routing would pick section 0
  });

  it('[if <expr>] falls back to sign routing when every section has a failing selector', () => {
    const r = compileFormat('[if [qty] > 100] "BIG";[if [qty] > 50] "MID"');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    // qty 8 matches neither selector and there is no selector-free
    // section — standard positive routing picks section 0.
    const text = r.program.formatText({ value: 8, row: { qty: 8 }, colId: 'x' }).trim();
    expect(text).toBe('BIG');
  });

  it('[if <expr>] selection also drives the section style ([Red] etc.)', () => {
    const r = compileFormat('[if [qty] > 100][Red] 0; 0');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const big = r.program.resolveStyle({ value: 220, row: { qty: 220 }, colId: 'x' });
    expect(big?.color?.toLowerCase()).toBe('var(--cg-neg-color, #e53935)');
    const small = r.program.resolveStyle({ value: 8, row: { qty: 8 }, colId: 'x' });
    expect(small?.color).toBeUndefined();
  });
});

describe('compileFormat — errors', () => {
  it('surfaces Tier 1 parse error with format-source loc', () => {
    // A tier1 bracket with bad expression content: [color=!!!]
    const r = compileFormat('[color=!!!] 0.00');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(['expression-parse', 'expression-compile', 'tier1-parse']).toContain(r.error.code);
  });

  it('rejects >4 Excel sections', () => {
    const r = compileFormat('0;0;0;0;0');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.error.code).toBe('excel-section-count');
  });
});

describe('compileCompositeColDef — Tier 2', () => {
  it('compiles a composite column', () => {
    const colDef: CompositeColDef = {
      colId: 'summary',
      type: 'composite',
      fragments: [
        { expr: '[symbol]', style: { weight: 'bold' } },
        { text: '  ' },
        { expr: '[price]', format: '$#,##0.00' },
      ],
    };
    const r = compileCompositeColDef(colDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.tiers.tier2).toBe(true);

    const fragments = r.program.resolveFragments({ value: null, row: { symbol: 'AAPL', price: 150 }, colId: 'summary' });
    expect(fragments).toHaveLength(3);
    expect(fragments?.[0]?.text).toBe('AAPL');
    expect(fragments?.[2]?.text).toBe('$150.00');

    // formatText returns concatenated fragment text
    const text = r.program.formatText({ value: null, row: { symbol: 'AAPL', price: 150 }, colId: 'summary' });
    expect(text).toBe('AAPL  $150.00');
  });

  it('composite with cellBackground', () => {
    const colDef: CompositeColDef = {
      colId: 'summary',
      type: 'composite',
      fragments: [{ text: 'x' }],
      // Single-bracket field ref inside bg expression: [bg=[flag] ? "#efe" : "#fee"]
      cellBackground: '[bg=[flag] ? "#efe" : "#fee"]',
    };
    const r = compileCompositeColDef(colDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    const bg = r.program.resolveStyle({ value: null, row: { flag: true }, colId: 'summary' });
    expect(bg?.background).toBe('#efe');
  });
});

describe('compileFormat — rule refs + hasRuleRefs (Cycle 21e)', () => {
  it('hasRuleRefs is true for formats whose tier-1 brackets contain rule:<id>', () => {
    const r = compileFormat('[color=rule:hot] $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.hasRuleRefs).toBe(true);
  });

  it('hasRuleRefs is undefined for plain formats (tier 0 and expression-only tier 1)', () => {
    const plain = compileFormat('0.00');
    expect(plain.ok).toBe(true);
    if (!plain.ok) throw new Error(plain.error.message);
    expect(plain.program.hasRuleRefs).toBeUndefined();

    const tier1 = compileFormat('[color=[change] > 0 ? "#0a7" : "#d33"] 0.00');
    expect(tier1.ok).toBe(true);
    if (!tier1.ok) throw new Error(tier1.error.message);
    expect(tier1.program.hasRuleRefs).toBeUndefined();
  });

  it('round-trip: [color=rule:hot] resolves through ctx.resolveRuleRef; absent accessor → 21c null contribution', () => {
    const r = compileFormat('[color=rule:hot] $#,##0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);

    // Accessor present + rule matched → live rule color.
    const style = r.program.resolveStyle({
      value: 1234.5, row: {}, colId: 'x',
      resolveRuleRef: (ruleId) => (ruleId === 'hot' ? '#ff0000' : null),
    });
    expect(style?.color).toBe('#ff0000');

    // Text path unaffected by the bracket.
    expect(r.program.formatText({ value: 1234.5, row: {}, colId: 'x' })).toBe('$1,234.50');

    // Accessor absent → exact Cycle 21c reserve behavior.
    expect(r.program.resolveStyle({ value: 1234.5, row: {}, colId: 'x' })?.color).toBeUndefined();
  });

  it('mixed bracket: rule:<id> inside a larger expression is baked to literal null (never accessor-resolved); hasRuleRefs still true', () => {
    // sugar.ts canonicalizes the interior to `[x] > 0 ? null : "#d33"` —
    // ast !== null, so the resolver takes the expression path; the ref
    // position contributes null even with an accessor present. Only
    // whole-interior refs ([color=rule:hot]) get ast === null + accessor
    // resolution. ruleRefs are still recorded → memo bypass stays correct.
    const r = compileFormat('[color=[x] > 0 ? rule:hot : "#d33"] 0.00');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.hasRuleRefs).toBe(true);

    const resolveRuleRef = (): string => '#ff0000';
    // Ternary picks the rule-ref branch → baked null → no color contribution.
    expect(r.program.resolveStyle({ value: 1, row: { x: 5 }, colId: 'c', resolveRuleRef })?.color)
      .toBeUndefined();
    // Ternary picks the literal branch → normal expression result.
    expect(r.program.resolveStyle({ value: 1, row: { x: -5 }, colId: 'c', resolveRuleRef })?.color)
      .toBe('#d33');
  });

  it('composite fragment [rule:<id>] style shorthand resolves via the accessor; program reports hasRuleRefs', () => {
    const colDef: CompositeColDef = {
      colId: 'summary',
      type: 'composite',
      fragments: [{ expr: '[symbol]', style: { color: '[rule:hot]' } }],
    };
    const r = compileCompositeColDef(colDef);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.program.hasRuleRefs).toBe(true);

    const withAccessor = r.program.resolveFragments({
      value: null, row: { symbol: 'AAPL' }, colId: 'summary',
      resolveRuleRef: (ruleId) => (ruleId === 'hot' ? '#ff0000' : null),
    });
    expect(withAccessor?.[0]?.text).toBe('AAPL');
    expect(withAccessor?.[0]?.style.color).toBe('#ff0000');

    // Accessor absent → shorthand contributes nothing (21c behavior).
    const without = r.program.resolveFragments({ value: null, row: { symbol: 'AAPL' }, colId: 'summary' });
    expect(without?.[0]?.text).toBe('AAPL');
    expect(without?.[0]?.style.color).toBeUndefined();
  });
});
