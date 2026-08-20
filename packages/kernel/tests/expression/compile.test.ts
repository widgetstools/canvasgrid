import { describe, expect, it } from 'vitest';
import { compile } from '../../src/expression/compile';
import { parse } from '../../src/expression/parse';
import type { Ast } from '../../src/expression/types';

function mustParse(src: string): Ast {
  const r = parse(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  return r.ast;
}

describe('compile — built-in dispatch', () => {
  it('compiles IF successfully', () => {
    const r = compile(mustParse('IF(true, 1, 2)'));
    expect(r.ok).toBe(true);
  });

  it('compiles nested built-ins', () => {
    const r = compile(mustParse('ROUND(ABS([x]), 2)'));
    expect(r.ok).toBe(true);
  });

  it('compiles all 14 built-ins', () => {
    const cases = [
      'IF(true, 1, 2)', 'COALESCE([a], [b], 0)',
      'NOT(true)', 'AND(true, false)', 'OR(true, false)',
      'ABS(-1)', 'ROUND(1.5)', 'ROUND(1.234, 2)',
      'MIN(1, 2, 3)', 'MAX(1, 2, 3)',
      'FLOOR(1.9)', 'CEIL(1.1)',
      'LOWER("A")', 'UPPER("a")', 'LEN("abc")',
    ];
    for (const src of cases) {
      const r = compile(mustParse(src));
      if (!r.ok) throw new Error(`compile failed for '${src}': ${r.error.message}`);
      expect(r.ok).toBe(true);
    }
  });
});

describe('compile — arity errors', () => {
  it('rejects IF with 2 args', () => {
    const r = compile(mustParse('IF(true, 1)'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
    expect(r.error.message).toMatch(/IF expects 3 args/);
  });

  it('rejects ABS with 0 args', () => {
    const r = compile(mustParse('ABS()'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
  });

  it('rejects ROUND with 3 args (max 2)', () => {
    const r = compile(mustParse('ROUND(1, 2, 3)'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
    expect(r.error.message).toMatch(/1..2 args/);
  });

  it('accepts variadic MIN with just 1 arg', () => {
    const r = compile(mustParse('MIN(1)'));
    expect(r.ok).toBe(true);
  });

  it('rejects variadic COALESCE with 0 args', () => {
    const r = compile(mustParse('COALESCE()'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('arity');
  });
});

describe('compile — unknown function', () => {
  it('rejects an unknown name', () => {
    const r = compile(mustParse('NOPE(1)'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unknown-fn');
    expect(r.error.message).toMatch(/unknown function 'NOPE'/);
  });
});

describe('compile — aggregate + PREV rejection (not-yet-implemented)', () => {
  const AGGS = [
    'SUM([x])', 'AVG([x])', 'COUNT([x])',
    'RUNNING_SUM([x])', 'RUNNING_AVG([x])', 'MOVING_AVG([x], 3)',
    'FIRST([x])', 'LAST([x])',
    'DELTA_FROM_PREV([x])', 'DELTA_FROM_FIRST([x])', 'DELTA_FROM_LAST([x])',
    'PREV([x])',
  ];
  for (const src of AGGS) {
    it(`rejects '${src}' with not-yet-implemented`, () => {
      const r = compile(mustParse(src));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('not-yet-implemented');
      expect(r.error.message).toMatch(/Cycle 21d/);
    });
  }

  it('MIN/MAX with args stay as built-in (do not trigger aggregate rejection)', () => {
    expect(compile(mustParse('MIN(1, 2, 3)')).ok).toBe(true);
    expect(compile(mustParse('MAX(1, 2)')).ok).toBe(true);
  });
});

describe('compile — custom built-ins via CompileOptions', () => {
  it('accepts custom function registered via opts.builtins', () => {
    const r = compile(mustParse('DOUBLE(3)'), {
      builtins: {
        DOUBLE: { arity: 1, impl: (args) => (args[0] as number) * 2 },
      },
    });
    expect(r.ok).toBe(true);
  });

  it('custom overrides built-in of same name', () => {
    const r = compile(mustParse('ABS(1)'), {
      builtins: {
        ABS: { arity: 1, impl: () => 'overridden' },
      },
    });
    expect(r.ok).toBe(true);
  });
});
