import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile';
import { evaluate } from '../src/evaluate';
import { parse } from '../src/parse';
import { EvalError } from '../src/types';

describe('parse errors — loc points to the offending substring', () => {
  it('unterminated string starts at opening quote', () => {
    const src = '1 + "foo';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('unmatched paren points to eof or offending token', () => {
    const src = '(1 + 2';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(src.length);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('unexpected character points at exactly that char', () => {
    const src = '1 + @ + 2';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(5);
  });

  it('bare identifier loc covers the identifier', () => {
    const src = 'foo';
    const r = parse(src);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(0);
    expect(r.error.loc.end).toBe(3);
  });
});

describe('compile errors — loc points to the offending call', () => {
  it('unknown function loc covers full call expression', () => {
    const src = '1 + NOPE(1, 2)';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const r = compile(p.ast);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('arity error loc covers the offending call', () => {
    const src = '  IF(true, 1)';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const r = compile(p.ast);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(2);
    expect(r.error.loc.end).toBe(src.length);
  });

  it('aggregate rejection loc covers the SUM(...) subtree', () => {
    const src = '2 * SUM([x])';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const r = compile(p.ast);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.loc.start).toBe(4);
    expect(r.error.loc.end).toBe(src.length);
  });
});

describe('eval errors — loc anchors to the binary op that failed', () => {
  it('div-by-zero loc covers the division subtree', () => {
    const src = '[a] / [b]';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const c = compile(p.ast);
    if (!c.ok) throw new Error('compile');
    try {
      evaluate(c.compiled, { row: { a: 1, b: 0 } });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as EvalError;
      expect(err.code).toBe('div-by-zero');
      expect(err.loc.start).toBe(0);
      expect(err.loc.end).toBe(src.length);
    }
  });

  it('type-error on cross-type comparison anchors to the comparison', () => {
    const src = '[a] < [b]';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    const c = compile(p.ast);
    if (!c.ok) throw new Error('compile');
    try {
      evaluate(c.compiled, { row: { a: 1, b: 'x' } });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as EvalError;
      expect(err.code).toBe('type-error');
      expect(err.loc.start).toBe(0);
      expect(err.loc.end).toBe(src.length);
    }
  });
});
