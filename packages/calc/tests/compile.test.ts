import { describe, expect, it } from 'vitest';
import { compile as compileExpression, evaluate, parse } from '@wellsfargo-starui/velocity-grid-expression';
import type { Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileCalc, evaluatePerRow } from '../src/compile';

const schema: Schema = {
  fields: { price: 'number', qty: 'number', px: 'number', sym: 'string' },
};

function mustCompile(source: string, sch?: Schema) {
  const res = compileCalc(source, sch);
  if (!res.ok) throw new Error(`expected ok for '${source}', got ${res.error.code}: ${res.error.message}`);
  return res.compiled;
}

function mustFail(source: string, sch?: Schema) {
  const res = compileCalc(source, sch);
  if (res.ok) throw new Error(`expected compile failure for '${source}'`);
  return res.error;
}

describe('compileCalc — row-local', () => {
  it('compiles with an empty pre-pass and full metadata', () => {
    const compiled = mustCompile('[price] * [qty]');
    expect(compiled.prePass).toEqual([]);
    expect(compiled.usesPrev).toBe(false);
    expect(compiled.cellDataType).toBe('number');
    expect([...compiled.watchedColIds].sort()).toEqual(['price', 'qty']);
  });

  it('evaluatePerRow matches the raw expression pipeline on row-local programs', () => {
    const source = '[price] * [qty] + 1';
    const compiled = mustCompile(source);
    const parsed = parse(source);
    if (!parsed.ok) throw new Error('unreachable');
    const direct = compileExpression(parsed.ast);
    if (!direct.ok) throw new Error('unreachable');
    const rows = [
      { price: 2, qty: 3 },
      { price: 0, qty: 9 },
      { price: 1.5, qty: 4 },
    ];
    for (const row of rows) {
      expect(evaluatePerRow(compiled, row, [], null))
        .toBe(evaluate(direct.compiled, { row }));
    }
  });

  it('the rewritten ast is postMessage-safe plain JSON', () => {
    const compiled = mustCompile("SUM([price], 'group') + PREV([px]) + [qty]");
    expect(structuredClone(compiled.ast)).toEqual(compiled.ast);
  });
});

describe('compileCalc — aggregates', () => {
  it('aggregate reads become pre-pass slot reads', () => {
    const compiled = mustCompile("[price] / SUM([price], 'group')");
    expect(compiled.prePass).toEqual([
      { slot: 0, fn: 'SUM', colId: 'price', scope: { kind: 'group' } },
    ]);
    expect(evaluatePerRow(compiled, { price: 50 }, [200], null)).toBe(0.25);
  });

  it('deduped slots feed every call site', () => {
    const compiled = mustCompile('SUM([price]) + SUM([price])');
    expect(compiled.prePass).toHaveLength(1);
    expect(evaluatePerRow(compiled, {}, [21], null)).toBe(42);
  });

  it('a missing aggregate value injects null → whole cell null', () => {
    const compiled = mustCompile('[price] / SUM([price])');
    expect(evaluatePerRow(compiled, { price: 50 }, [], null)).toBeNull();
  });

  it('watchedColIds captures aggregate + PREV sources (pre-rewrite heads)', () => {
    const compiled = mustCompile('SUM([price]) + PREV([px]) + [qty]');
    expect([...compiled.watchedColIds].sort()).toEqual(['price', 'px', 'qty']);
  });
});

describe('compileCalc — PREV', () => {
  it('PREV reads flow through the prev lookup', () => {
    const compiled = mustCompile('[price] - PREV([price])');
    expect(compiled.usesPrev).toBe(true);
    const prev = (colId: string): unknown => (colId === 'price' ? 100 : null);
    expect(evaluatePerRow(compiled, { price: 105 }, [], prev)).toBe(5);
  });

  it('no transaction context (prev === null) → PREV reads null → cell null', () => {
    const compiled = mustCompile('[price] - PREV([price])');
    expect(evaluatePerRow(compiled, { price: 105 }, [], null)).toBeNull();
  });
});

describe('evaluatePerRow — error semantics (StarUI: runtime errors → null cell)', () => {
  it('EvalError → null, and recovers on good rows', () => {
    const compiled = mustCompile('[a] / [b]');
    expect(evaluatePerRow(compiled, { a: 1, b: 0 }, [], null)).toBeNull();
    expect(evaluatePerRow(compiled, { a: 4, b: 2 }, [], null)).toBe(2);
  });

  it('builtin coercion failures → null', () => {
    const compiled = mustCompile('LEN([sym])');
    expect(evaluatePerRow(compiled, { sym: null }, [], null)).toBeNull();
    expect(evaluatePerRow(compiled, { sym: 'abc' }, [], null)).toBe(3);
  });
});

describe('compileCalc — error mapping', () => {
  it.each([
    ['[price] >', 'parse'],
    ['FOO(1)', 'unknown-fn'],
    ['ROUND(1, 2, 3)', 'arity'],
    ['RUNNING_SUM([price])', 'not-yet-implemented'],
    ["SUM([price], 'nope')", 'unknown-scope'],
    ['SUM(1)', 'bad-shape'],
  ])('%s → %s', (source, code) => {
    const err = mustFail(source);
    expect(err.code).toBe(code);
    expect(err.colId).toBeNull();
    expect(err.loc).not.toBeNull();
  });

  it('schema validation errors surface through the transform', () => {
    const err = mustFail('SUM([bogus])', schema);
    expect(err.code).toBe('bad-shape');
    expect(err.message).toMatch(/unknown field 'bogus'/);
  });
});
