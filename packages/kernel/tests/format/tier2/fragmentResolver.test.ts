import { describe, it, expect } from 'vitest';
import { compileFragments, resolveFragments, resolveCellBackground } from '../../../src/format/tier2/fragmentResolver';
import type { CompositeColDef } from '../../../src/format/types';

function makeCol(fragments: CompositeColDef['fragments'], extra?: Partial<CompositeColDef>): CompositeColDef {
  return { colId: 'summary', type: 'composite', fragments, ...extra };
}

describe('Composite fragmentResolver', () => {
  it('static text fragment', () => {
    const plan = compileFragments(makeCol([{ text: 'hello' }]));
    const fragments = resolveFragments(plan, { value: null, row: {}, colId: 'summary' });
    expect(fragments).toEqual([{ text: 'hello', style: {} }]);
  });

  it('expression fragment with no format returns raw stringified value', () => {
    const plan = compileFragments(makeCol([{ expr: '[symbol]' }]));
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'AAPL' }, colId: 'summary' });
    expect(fragments[0]!.text).toBe('AAPL');
  });

  it('expression fragment with format applies Excel format', () => {
    const plan = compileFragments(makeCol([{ expr: '[price]', format: '$#,##0.00' }]));
    const fragments = resolveFragments(plan, { value: null, row: { price: 1234.5 }, colId: 'summary' });
    expect(fragments[0]!.text).toBe('$1,234.50');
  });

  it('per-fragment static style applies', () => {
    const plan = compileFragments(makeCol([{ expr: '[symbol]', style: { weight: 'bold' } }]));
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'AAPL' }, colId: 'summary' });
    expect(fragments[0]!.style.weight).toBe('bold');
  });

  it('per-fragment [<expr>] shorthand style auto-wraps into Tier 1 bracket', () => {
    const plan = compileFragments(makeCol([{
      expr: '[change]',
      format: '+0.00%;-0.00%',
      style: { color: '[[change] > 0 ? "#0a7" : "#d33"]' },
    }]));
    const posFragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(posFragments[0]!.style.color).toBe('#0a7');
    const negFragments = resolveFragments(plan, { value: null, row: { change: -0.02 }, colId: 'summary' });
    expect(negFragments[0]!.style.color).toBe('#d33');
  });

  it('multi-fragment composite preserves order + separates styles', () => {
    const plan = compileFragments(makeCol([
      { expr: '[symbol]', style: { weight: 'bold' } },
      { text: '  ' },
      { expr: '[price]', format: '$#,##0.00' },
    ]));
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'AAPL', price: 150 }, colId: 'summary' });
    expect(fragments).toHaveLength(3);
    expect(fragments[0]!.text).toBe('AAPL');
    expect(fragments[0]!.style.weight).toBe('bold');
    expect(fragments[1]!.text).toBe('  ');
    expect(fragments[2]!.text).toBe('$150.00');
  });

  it('cellBackground Tier 1 bracket produces style at eval', () => {
    const plan = compileFragments(makeCol([{ text: 'x' }], {
      cellBackground: '[bg=[change] > 0 ? "#efe" : "#fee"]',
    }));
    expect(plan.cellBackgroundProgram).not.toBeNull();

    const posBg = resolveCellBackground(plan, { value: null, row: { change: 5 }, colId: 'x' });
    expect(posBg?.background).toBe('#efe');

    const negBg = resolveCellBackground(plan, { value: null, row: { change: -5 }, colId: 'x' });
    expect(negBg?.background).toBe('#fee');
  });

  it('per-fragment format with {icon:name} token emits ResolvedFragment.icon', () => {
    // Spec §3.4 example: fragment format string can carry icon tokens.
    // e.g. `[Green]{icon:trending-up}+0.00%;[Red]{icon:trending-down}-0.00%`
    const plan = compileFragments(makeCol([{ expr: '[change]', format: '{icon:trending-up}+0.00%' }]));
    const fragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(fragments[0]!.icon?.name).toBe('trending-up');
  });

  it('per-fragment format with dynamic {icon:name|<expr>}', () => {
    const plan = compileFragments(makeCol([{
      expr: '[change]',
      format: '{icon:x|[change] > 0 ? "trending-up" : "trending-down"}+0.00%',
    }]));
    const posFragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(posFragments[0]!.icon?.name).toBe('trending-up');
    const negFragments = resolveFragments(plan, { value: null, row: { change: -0.02 }, colId: 'summary' });
    expect(negFragments[0]!.icon?.name).toBe('trending-down');
  });

  // Fix 1 (HIGH): multi-section format picks icon from the routed section
  it('multi-section format picks icon from the routed section', () => {
    const plan = compileFragments(makeCol([
      { expr: '[change]', format: '{icon:up}+0.00%;{icon:down}-0.00%' },
    ]));
    const posFragments = resolveFragments(plan, { value: null, row: { change: 0.02 }, colId: 'summary' });
    expect(posFragments[0]!.icon?.name).toBe('up');
    const negFragments = resolveFragments(plan, { value: null, row: { change: -0.02 }, colId: 'summary' });
    expect(negFragments[0]!.icon?.name).toBe('down');
  });

  // Fix 2 (MEDIUM): malformed [<expr>] shorthand is stripped, never leaks as literal
  it('malformed [<expr>] shorthand is deleted, does not leak as literal', () => {
    const plan = compileFragments(makeCol([
      { expr: '[symbol]', style: { color: '[notAnExpr' } },
    ]));
    const fragments = resolveFragments(plan, { value: null, row: { symbol: 'X' }, colId: 'summary' });
    // Not a [<expr>] pattern (no closing bracket as last char) → stays as static, but we also
    // verify the actual malformed-parse path by using a value that starts/ends with brackets
    // but whose interior parse fails.
    expect(fragments[0]!.style.color).toBe('[notAnExpr');  // non-bracket-wrapped → passthrough

    // True malformed: brackets present but interior is not a valid expression
    const plan2 = compileFragments(makeCol([
      { expr: '[symbol]', style: { color: '[!!!invalid!!!]' } },
    ]));
    const fragments2 = resolveFragments(plan2, { value: null, row: { symbol: 'X' }, colId: 'summary' });
    expect(fragments2[0]!.style.color).toBeUndefined();
  });

  // Fix 3 (MEDIUM): locale from opts threads through to Excel evaluator
  it('locale from opts threads through to Excel evaluator', () => {
    const plan = compileFragments(
      makeCol([{ expr: '[price]', format: '#,##0.00' }]),
      { locale: 'de-DE' },
    );
    const fragments = resolveFragments(plan, { value: null, row: { price: 1234.5 }, colId: 'x' });
    // German locale uses . as thousands separator and , as decimal
    expect(fragments[0]!.text).toMatch(/1\.234,5/);
  });
});
