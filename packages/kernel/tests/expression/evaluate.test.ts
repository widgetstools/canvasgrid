import { describe, expect, it } from 'vitest';
import { compile } from '../../src/expression/compile';
import { evaluate } from '../../src/expression/evaluate';
import { parse } from '../../src/expression/parse';
import { EvalError } from '../../src/expression/types';

function evalStr(src: string, row: Record<string, unknown> = {}): unknown {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse: ${p.error.message}`);
  const c = compile(p.ast);
  if (!c.ok) throw new Error(`compile: ${c.error.message}`);
  return evaluate(c.compiled, { row });
}

describe('evaluate — literals + field access', () => {
  it('returns numeric literal', () => expect(evalStr('42')).toBe(42));
  it('returns string literal', () => expect(evalStr('"hi"')).toBe('hi'));
  it('returns boolean literal', () => expect(evalStr('true')).toBe(true));
  it('returns null literal', () => expect(evalStr('null')).toBeNull());

  it('resolves top-level field', () =>
    expect(evalStr('[price]', { price: 100 })).toBe(100));

  it('resolves nested field', () =>
    expect(evalStr('[trade.price]', { trade: { price: 100 } })).toBe(100));

  it('resolves array-index field', () =>
    expect(evalStr('[bids.0.px]', { bids: [{ px: 99 }] })).toBe(99));

  it('null-safe: returns null on missing intermediate', () =>
    expect(evalStr('[trade.price]', {})).toBeNull());

  it('null-safe: returns null on null intermediate', () =>
    expect(evalStr('[trade.price]', { trade: null })).toBeNull());
});

describe('evaluate — arithmetic', () => {
  it('adds numbers', () => expect(evalStr('1 + 2')).toBe(3));
  it('respects precedence', () => expect(evalStr('1 + 2 * 3')).toBe(7));
  it('respects parens', () => expect(evalStr('(1 + 2) * 3')).toBe(9));
  it('subtracts left-assoc', () => expect(evalStr('10 - 3 - 2')).toBe(5));
  it('divides', () => expect(evalStr('6 / 2')).toBe(3));
  it('modulos', () => expect(evalStr('7 % 3')).toBe(1));
  it('handles unary minus', () => expect(evalStr('-5')).toBe(-5));

  it('throws div-by-zero', () => {
    try {
      evalStr('1 / 0');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('div-by-zero');
    }
  });

  it('throws mod-by-zero', () => {
    try {
      evalStr('1 % 0');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('div-by-zero');
    }
  });
});

describe('evaluate — string concat via +', () => {
  it('concatenates two strings', () =>
    expect(evalStr('"a" + "b"')).toBe('ab'));

  it('treats string+number as type error', () => {
    try {
      evalStr('"a" + 1');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('type-error');
    }
  });
});

describe('evaluate — comparisons + equality', () => {
  it('<, <=, >, >= on numbers', () => {
    expect(evalStr('1 < 2')).toBe(true);
    expect(evalStr('2 <= 2')).toBe(true);
    expect(evalStr('3 > 2')).toBe(true);
    expect(evalStr('2 >= 2')).toBe(true);
    expect(evalStr('2 > 3')).toBe(false);
  });

  it('==, != strict, no coercion', () => {
    expect(evalStr('1 == 1')).toBe(true);
    expect(evalStr('1 != 2')).toBe(true);
    expect(evalStr('null == null')).toBe(true);
  });

  it('compares strings lexicographically', () => {
    expect(evalStr('"a" < "b"')).toBe(true);
    expect(evalStr('"b" > "a"')).toBe(true);
  });

  it('type-errors on cross-type comparison', () => {
    try {
      evalStr('1 < "a"');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('type-error');
    }
  });
});

describe('evaluate — logical + short-circuit', () => {
  it('&& returns first falsy', () =>
    expect(evalStr('false && [missing]')).toBe(false));

  it('&& returns last if all truthy', () =>
    expect(evalStr('1 && 2')).toBe(2));

  it('|| returns first truthy', () =>
    expect(evalStr('0 || 5')).toBe(5));

  it('|| returns last if all falsy', () =>
    expect(evalStr('0 || null')).toBeNull());

  it('short-circuits &&: right side not evaluated', () => {
    // If not short-circuiting, [zero] / 0 would throw div-by-zero.
    expect(evalStr('false && (1 / 0)')).toBe(false);
  });
});

describe('evaluate — ternary', () => {
  it('picks consequent when truthy', () =>
    expect(evalStr('true ? "yes" : "no"')).toBe('yes'));

  it('picks alternate when falsy', () =>
    expect(evalStr('null ? "yes" : "no"')).toBe('no'));

  it('short-circuits alternate', () => {
    // If not short-circuiting, 1/0 branch would throw.
    expect(evalStr('true ? 1 : (1/0)')).toBe(1);
  });
});

describe('evaluate — built-ins', () => {
  it('IF returns branch', () => {
    expect(evalStr('IF([x] > 0, "pos", "neg")', { x: 1 })).toBe('pos');
    expect(evalStr('IF([x] > 0, "pos", "neg")', { x: -1 })).toBe('neg');
  });

  it('COALESCE returns first non-null', () => {
    expect(evalStr('COALESCE(null, null, 42)')).toBe(42);
    expect(evalStr('COALESCE([a], [b], 0)', { b: 7 })).toBe(7);
  });

  it('NOT inverts truthiness', () => {
    expect(evalStr('NOT(true)')).toBe(false);
    expect(evalStr('NOT(null)')).toBe(true);
  });

  it('AND / OR variadic', () => {
    expect(evalStr('AND(true, true, true)')).toBe(true);
    expect(evalStr('AND(true, false, true)')).toBe(false);
    expect(evalStr('OR(false, false, true)')).toBe(true);
  });

  it('ABS, FLOOR, CEIL, ROUND', () => {
    expect(evalStr('ABS(-3.5)')).toBe(3.5);
    expect(evalStr('FLOOR(1.9)')).toBe(1);
    expect(evalStr('CEIL(1.1)')).toBe(2);
    expect(evalStr('ROUND(1.5)')).toBe(2);
    expect(evalStr('ROUND(1.2345, 2)')).toBe(1.23);
  });

  it('MIN, MAX variadic', () => {
    expect(evalStr('MIN(3, 1, 2)')).toBe(1);
    expect(evalStr('MAX(3, 1, 2)')).toBe(3);
  });

  it('LOWER, UPPER, LEN', () => {
    expect(evalStr('LOWER("ABC")')).toBe('abc');
    expect(evalStr('UPPER("abc")')).toBe('ABC');
    expect(evalStr('LEN("hello")')).toBe(5);
  });
});

describe('evaluate — error paths', () => {
  it('null-field error on unary - null', () => {
    try {
      evalStr('-[missing]', {});
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EvalError).code).toBe('null-field');
    }
  });

  it('runtime error wraps unexpected throws', () => {
    // A custom built-in that throws a non-EvalError, plain Error.
    const p = parse('BOOM()');
    if (!p.ok) throw new Error('parse');
    const c = compile(p.ast, {
      builtins: { BOOM: { arity: 0, impl: () => { throw new Error('kaboom'); } } },
    });
    if (!c.ok) throw new Error('compile');
    try {
      evaluate(c.compiled, { row: {} });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('runtime');
      expect((e as EvalError).message).toMatch(/kaboom/);
    }
  });
});

describe('evaluate — builtins edge cases (coverage)', () => {
  it('COALESCE returns null when all args are null', () => {
    expect(evalStr('COALESCE(null, null)')).toBeNull();
  });

  it('ABS accepts a boolean (coerces to number)', () => {
    // asNumber(true) → 1; abs(1) = 1
    expect(evalStr('ABS(true)')).toBe(1);
  });

  it('ROUND accepts a boolean (coerces to number)', () => {
    // asNumber(false) → 0
    expect(evalStr('ROUND(false)')).toBe(0);
  });

  it('MIN throws on null arg via asNumber(null) path', () => {
    try {
      evalStr('MIN(null)');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('runtime');
    }
  });

  it('LEN throws on null arg via asString(null) path', () => {
    try {
      evalStr('LEN(null)');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('runtime');
    }
  });

  it('LOWER throws on null arg via asString(null) path', () => {
    try {
      evalStr('LOWER(null)');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('runtime');
    }
  });

  it('ABS throws on non-numeric string arg via asNumber NaN path', () => {
    try {
      evalStr('ABS("notanumber")');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EvalError);
      expect((e as EvalError).code).toBe('runtime');
    }
  });

  it('UPPER converts number to string via String() path', () => {
    // asString(42) → String(42) → "42" → "42".toUpperCase() = "42"
    expect(evalStr('UPPER(42)')).toBe('42');
  });
});
