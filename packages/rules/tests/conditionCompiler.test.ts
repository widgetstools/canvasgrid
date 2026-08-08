import { describe, expect, it } from 'vitest';
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileCondition, validateRule } from '../src/conditionCompiler';
import type { ConditionalStyleRule, IndicatorRule } from '../src/types';

const schema: Schema = { fields: { price: 'number', qty: 'number', sym: 'string' } };

function mustCompile(condition: string, sch?: Schema, onEvalError?: () => void) {
  const res = compileCondition(condition, 'r-test', sch, onEvalError ? { onEvalError } : undefined);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.compiled;
}

describe('compileCondition — plain conditions', () => {
  it.each([
    ['[price] > 100', { price: 150 }, true],
    ['[price] > 100', { price: 50 }, false],
    ['[qty] != 0 && [price] > 100', { qty: 1, price: 150 }, true],
  ])('%s over %o → %s', (condition, row, expected) => {
    expect(mustCompile(condition).matches(row as Record<string, unknown>)).toBe(expected);
  });

  it('is strict-boolean: a bare field never matches, even when truthy', () => {
    const compiled = mustCompile('[price]');
    expect(compiled.matches({ price: 5 })).toBe(false);
    expect(compiled.matches({ price: 1 })).toBe(false);
  });
});

describe('compileCondition — [col.old]/[col.new] rewrite', () => {
  const wentUp = '[price.old] != null && [price] > [price.old]';

  it('flags diffAware and reads old values from the __cgridDiff injection', () => {
    const compiled = mustCompile(wentUp, schema);
    expect(compiled.diffAware).toBe(true);
    expect(compiled.matches({ price: 105, __cgridDiff: { price: { old: 100 } } })).toBe(true);
    expect(compiled.matches({ price: 95, __cgridDiff: { price: { old: 100 } } })).toBe(false);
  });

  it('resolves [col.old] to null on quiescent rows (no diff injected)', () => {
    const compiled = mustCompile(wentUp, schema);
    expect(compiled.matches({ price: 105 })).toBe(false);
  });

  it('[col.new] rewrites to the current row value and is not diffAware by itself', () => {
    const compiled = mustCompile('[price.new] > 100', schema);
    expect(compiled.diffAware).toBe(false);
    expect(compiled.matches({ price: 150 })).toBe(true);
    expect(compiled.matches({ price: 50 })).toBe(false);
  });

  it('with a schema, unknown heads are NOT rewritten (stay nested-object reads)', () => {
    const compiled = mustCompile('[meta.old] == 1', schema); // 'meta' is not a schema field
    expect(compiled.diffAware).toBe(false);
    expect(compiled.matches({ meta: { old: 1 } })).toBe(true);
  });

  it('without a schema, any 2-segment .old path is rewritten', () => {
    const compiled = mustCompile('[meta.old] == 1'); // no schema
    expect(compiled.diffAware).toBe(true);
    expect(compiled.matches({ meta: { old: 1 } })).toBe(false); // nested read no longer applies
    expect(compiled.matches({ __cgridDiff: { meta: { old: 1 } } })).toBe(true);
  });
});

describe('compileCondition — watchedColIds', () => {
  it('collects the first path segment of every field read (incl. rewritten .old refs)', () => {
    const compiled = mustCompile('[price.old] != null && [qty] > 0', schema);
    expect([...compiled.watchedColIds].sort()).toEqual(['price', 'qty']);
  });

  it('collects dot-path heads — nested reads watch the head colId', () => {
    const compiled = mustCompile('[trade.venue.fee] > 0');
    expect([...compiled.watchedColIds]).toEqual(['trade']); // 3 segments — never rewritten
    expect(compiled.diffAware).toBe(false);
  });

  it("never watches the '__cgridDiff' injection root itself", () => {
    const compiled = mustCompile('[__cgridDiff.price.old] != null');
    expect(compiled.watchedColIds.has('__cgridDiff')).toBe(false);
  });
});

describe('compileCondition — EvalError handling', () => {
  it('EvalError → non-matching + onEvalError callback fires once per occurrence', () => {
    let errs = 0;
    const compiled = mustCompile('[a] / [b] > 0', undefined, () => {
      errs += 1;
    });
    expect(compiled.matches({ a: 1, b: 0 })).toBe(false); // div-by-zero
    expect(errs).toBe(1);
    expect(compiled.matches({ a: 1, b: 2 })).toBe(true); // recovers on good data
    expect(errs).toBe(1);
  });
});

describe('compileCondition — reserved aggregates', () => {
  it("SUM([x]) > 0 surfaces 21b's not-yet-implemented compile error verbatim", () => {
    const res = compileCondition('SUM([x]) > 0', 'r-agg');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('not-yet-implemented');
    expect(res.error.ruleId).toBe('r-agg');
    expect(res.error.loc).not.toBeNull();
  });
});

describe('validateRule', () => {
  const base: ConditionalStyleRule = {
    kind: 'style',
    id: 'r1',
    name: 'Rule 1',
    enabled: true,
    priority: 10,
    condition: '[price] > 100',
    scope: { kind: 'cell', columnIds: ['price'] },
    style: { base: { color: '#c62828' } },
  };

  it('accepts a well-formed style rule', () => {
    expect(validateRule(base, schema)).toEqual([]);
  });

  it.each([
    ['empty id', { ...base, id: '' }],
    ['empty name', { ...base, name: '' }],
    ['non-finite priority', { ...base, priority: Number.NaN }],
    ['blank condition', { ...base, condition: '   ' }],
    ['cell scope with empty columnIds', { ...base, scope: { kind: 'cell', columnIds: [] } as never }],
    ['style rule without style object', { ...base, style: null as never }],
  ])('%s → bad-shape', (_label, rule) => {
    const errors = validateRule(rule as ConditionalStyleRule, schema);
    expect(errors.some((e) => e.code === 'bad-shape')).toBe(true);
  });

  it('indicator rule without indicator object → bad-shape', () => {
    const rule: IndicatorRule = {
      kind: 'indicator',
      id: 'r2',
      name: 'Ind',
      enabled: true,
      priority: 1,
      condition: '[qty] > 0',
      scope: { kind: 'row' },
      indicator: null as never,
    };
    expect(validateRule(rule, schema).some((e) => e.code === 'bad-shape')).toBe(true);
  });

  it('unparseable condition → parse (single error, loc populated)', () => {
    const errors = validateRule({ ...base, condition: '[price] >' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('parse');
    expect(errors[0]!.ruleId).toBe('r1');
    expect(errors[0]!.loc).not.toBeNull();
  });

  it('uncompilable valueFormatter → format-compile', () => {
    const errors = validateRule({ ...base, valueFormatter: '[color=1+]' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('format-compile');
  });
});
