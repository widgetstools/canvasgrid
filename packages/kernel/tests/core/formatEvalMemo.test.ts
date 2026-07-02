// Cycle 21e / Task 14 — per-cell format-eval memo tests.
//
// evalFormatProgram is the shared entry point the compileFormatSlots
// wrapped lambdas (valueFormatter / cellStyle / cellIcon) route through.
// A paint pass calls all three back-to-back for one cell; the memo
// collapses that into a single underlying program eval, keyed on cell
// identity + value + theme.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evalFormatProgram,
  bumpFormatEvalGeneration,
  _resetFormatEvalMemo_forTests,
} from '../../src/core/formatEvalMemo';
import {
  registerRuleEngine,
  _resetRuleEngine_forTests,
  type RuleEngineShape,
} from '../../src/core/ruleEngineSlot';
import type { FormatProgramShape } from '../../src/core/formatCompilerSlot';

function countingProgram(hasRuleRefs = false): { program: FormatProgramShape; counts: { text: number; style: number; icon: number } } {
  const counts = { text: 0, style: 0, icon: 0 };
  const program: FormatProgramShape = {
    formatText: (ctx) => { counts.text++; return `t:${String(ctx.value)}`; },
    resolveStyle: (ctx) => { counts.style++; return { color: String(ctx.value) }; },
    resolveIcon: (ctx) => { counts.icon++; return { name: `icon:${String(ctx.value)}` }; },
    resolveFragments: () => null,
    source: 'x',
    tiers: { tier0: true, tier1: false, tier2: false },
    hasRuleRefs,
  };
  return { program, counts };
}

describe('formatEvalMemo — evalFormatProgram', () => {
  beforeEach(() => {
    _resetFormatEvalMemo_forTests();
    _resetRuleEngine_forTests();
  });

  it('memoizes: three calls with identical cell identity → underlying fns called once each', () => {
    const { program, counts } = countingProgram();
    const p = { value: 42, data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' as const };
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    expect(counts.text).toBe(1);
    expect(counts.style).toBe(1);
    expect(counts.icon).toBe(1);
  });

  it('returns the same result values on a memo hit', () => {
    const { program } = countingProgram();
    const p = { value: 42, data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' as const };
    const r1 = evalFormatProgram(program, p);
    const r2 = evalFormatProgram(program, p);
    expect(r1).toEqual(r2);
    expect(r1.text).toBe('t:42');
  });

  it('value change recomputes', () => {
    const { program, counts } = countingProgram();
    const base = { data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' as const };
    evalFormatProgram(program, { ...base, value: 1 });
    evalFormatProgram(program, { ...base, value: 2 });
    expect(counts.text).toBe(2);
  });

  it('rowId change recomputes', () => {
    const { program, counts } = countingProgram();
    const base = { value: 1, data: {}, colId: 'x', themeKind: 'light' as const };
    evalFormatProgram(program, { ...base, rowId: 'r1' });
    evalFormatProgram(program, { ...base, rowId: 'r2' });
    expect(counts.text).toBe(2);
  });

  it('themeKind change recomputes', () => {
    const { program, counts } = countingProgram();
    const base = { value: 1, data: {}, colId: 'x', rowId: 'r1' };
    evalFormatProgram(program, { ...base, themeKind: 'light' as const });
    evalFormatProgram(program, { ...base, themeKind: 'dark' as const });
    expect(counts.text).toBe(2);
  });

  it('hasRuleRefs: true bypasses the memo — every call re-evaluates', () => {
    const { program, counts } = countingProgram(true);
    const p = { value: 42, data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' as const };
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    expect(counts.text).toBe(3);
    expect(counts.style).toBe(3);
    expect(counts.icon).toBe(3);
  });

  it('rowId absent bypasses the memo', () => {
    const { program, counts } = countingProgram();
    const p = { value: 42, data: {}, colId: 'x', themeKind: 'light' as const };
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    expect(counts.text).toBe(2);
  });

  it('resolveRuleRef reaches the program and receives the cell ctx', () => {
    const seen: Array<{ ruleId: string; ctx: unknown }> = [];
    const engine: RuleEngineShape = {
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: (ruleId, ctx) => { seen.push({ ruleId, ctx }); return '#00c853'; },
    };
    registerRuleEngine(engine);

    const program: FormatProgramShape = {
      formatText: (ctx) => String(ctx.value),
      resolveStyle: (ctx) => ({ color: ctx.resolveRuleRef?.('r-up') ?? undefined }),
      resolveIcon: () => null,
      resolveFragments: () => null,
      source: 'x',
      tiers: { tier0: true, tier1: false, tier2: false },
    };

    const result = evalFormatProgram(program, {
      value: 1, data: { a: 1 }, colId: 'px', rowId: 'r1', themeKind: 'light',
    });

    expect(result.style).toEqual({ color: '#00c853' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ruleId).toBe('r-up');
    expect(seen[0]!.ctx).toEqual({ row: { a: 1 }, rowId: 'r1', colId: 'px', theme: 'light' });
  });

  it('tier-1 style reading a DIFFERENT column is re-evaluated on the next paint pass (no stale style)', () => {
    // Regression (review fix pass 1): the memo key only carries this
    // cell's value — a tier-1 program like `[color=[qty] > 100]` on the
    // price column reads OTHER row fields. A qty change without a price
    // change must not serve a stale style on the next paint pass.
    const program: FormatProgramShape = {
      formatText: (ctx) => String(ctx.value),
      resolveStyle: (ctx) => ({
        color: ((ctx.row as Record<string, unknown>).qty as number) > 100 ? '#00c853' : '#c62828',
      }),
      resolveIcon: () => null,
      resolveFragments: () => null,
      source: '[color=[qty] > 100]',
      tiers: { tier0: true, tier1: true, tier2: false },
    };
    const first = evalFormatProgram(program, {
      value: 10, data: { price: 10, qty: 50 }, colId: 'price', rowId: 'r1', themeKind: 'light',
    });
    expect(first.style).toEqual({ color: '#c62828' });
    // qty ticks; price (this cell's value) unchanged. Next paint pass.
    bumpFormatEvalGeneration();
    const second = evalFormatProgram(program, {
      value: 10, data: { price: 10, qty: 200 }, colId: 'price', rowId: 'r1', themeKind: 'light',
    });
    expect(second.style).toEqual({ color: '#00c853' });
  });

  it('tier-1 program still shares one eval per cell within a single paint pass', () => {
    const { program, counts } = countingProgram();
    program.tiers = { tier0: true, tier1: true, tier2: false };
    const p = { value: 42, data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' as const };
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    evalFormatProgram(program, p);
    expect(counts.text).toBe(1);
    expect(counts.style).toBe(1);
    expect(counts.icon).toBe(1);
  });

  it('pure tier-0 program reuses across paint passes (value-determined output)', () => {
    const { program, counts } = countingProgram();
    const p = { value: 42, data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' as const };
    evalFormatProgram(program, p);
    bumpFormatEvalGeneration();
    evalFormatProgram(program, p);
    expect(counts.text).toBe(1);
  });

  it('no engine registered → resolveRuleRef is not attached to the ctx', () => {
    let ctxSeen: any;
    const program: FormatProgramShape = {
      formatText: (ctx) => { ctxSeen = ctx; return 'x'; },
      resolveStyle: () => null,
      resolveIcon: () => null,
      resolveFragments: () => null,
      source: 'x',
      tiers: { tier0: true, tier1: false, tier2: false },
    };
    evalFormatProgram(program, { value: 1, data: {}, colId: 'x', rowId: 'r1', themeKind: 'light' });
    expect(ctxSeen.resolveRuleRef).toBeUndefined();
  });
});
