import { describe, it, expect } from 'vitest';
import { parse, compile, evaluate } from '../../src/expression/index';

const evalExpr = (src: string, row: Record<string, unknown> = {}): unknown => {
  const p = parse(src);
  if (!p.ok) throw new Error(p.error.message);
  const c = compile(p.ast);
  if (!c.ok) throw new Error(c.error.message);
  return evaluate(c.compiled, { row });
};

describe('string/number builtins (format-picker set)', () => {
  it('TRIM', () => {
    expect(evalExpr('TRIM([x])', { x: '  hi  ' })).toBe('hi');
    expect(evalExpr('TRIM([x])', { x: null })).toBe('');
  });
  it('TITLE', () => {
    expect(evalExpr('TITLE([x])', { x: 'hello world' })).toBe('Hello World');
    expect(evalExpr('TITLE([x])', { x: 'MIXED case-words' })).toBe('Mixed Case-Words');
    expect(evalExpr('TITLE([x])', { x: null })).toBe('');
  });
  it('CAMEL', () => {
    expect(evalExpr('CAMEL([x])', { x: 'hello world' })).toBe('helloWorld');
    expect(evalExpr('CAMEL([x])', { x: 'Foo_bar-baz' })).toBe('fooBarBaz');
    expect(evalExpr('CAMEL([x])', { x: null })).toBe('');
  });
  it('CAP', () => {
    expect(evalExpr('CAP([x])', { x: 'sample' })).toBe('Sample');
    expect(evalExpr('CAP([x])', { x: '' })).toBe('');
    expect(evalExpr('CAP([x])', { x: null })).toBe('');
  });
  it('FIXED', () => {
    expect(evalExpr('FIXED([x], 1)', { x: 12.34 })).toBe('12.3');
    expect(evalExpr('FIXED([x], 0)', { x: 1234.5678 })).toBe('1235');
    expect(evalExpr('FIXED([x], 2)', { x: null })).toBe('');
    expect(evalExpr('FIXED([x], 2)', { x: 'junk' })).toBe('');
  });
  it('composes with + string concat (bps shape)', () => {
    expect(evalExpr('([x] >= 0 ? "+" : "") + FIXED([x] * 10000, 1) + " bp"', { x: 0.001234 })).toBe('+12.3 bp');
  });
});
