import { describe, expect, it } from 'vitest';
import { parse } from '../../src/expression/parse';
import type { Ast } from '../../src/expression/types';
import corpus from './fixtures/ast-corpus.json' with { type: 'json' };

interface CorpusEntry { src: string; ast: Ast }

describe('parse — golden AST corpus', () => {
  for (const entry of corpus as CorpusEntry[]) {
    it(`parses: ${entry.src}`, () => {
      const result = parse(entry.src);
      if (!result.ok) {
        throw new Error(`parse failed unexpectedly: ${result.error.message} @${result.error.loc.start}..${result.error.loc.end}`);
      }
      expect(result.ast).toEqual(entry.ast);
    });
  }
});

describe('parse — grammar coverage beyond corpus', () => {
  it('accepts left-associative multiplicative chain', () => {
    const r = parse('6 / 2 / 3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ((6/2)/3) not (6/(2/3))
    expect(r.ast.kind).toBe('binary');
    if (r.ast.kind !== 'binary') return;
    expect(r.ast.op).toBe('/');
    expect(r.ast.left.kind).toBe('binary');
  });

  it('accepts nested ternary (right-associative through recursion)', () => {
    const r = parse('[a] ? 1 : [b] ? 2 : 3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('ternary');
  });

  it('accepts zero-arg call', () => {
    const r = parse('NOW()');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('call');
    if (r.ast.kind !== 'call') return;
    expect(r.ast.args).toEqual([]);
  });

  it('accepts nested calls', () => {
    const r = parse('ROUND(ABS([x]), 2)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('call');
  });

  it('accepts string with escape sequences', () => {
    const r = parse('"a\\nb\\tc"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('literal');
    if (r.ast.kind !== 'literal') return;
    expect(r.ast.value).toBe('a\nb\tc');
  });

  it('accepts single-quoted strings', () => {
    const r = parse("'foo'");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('literal');
    if (r.ast.kind !== 'literal') return;
    expect(r.ast.value).toBe('foo');
  });

  it('accepts unary minus on parenthesised expr', () => {
    const r = parse('-(1 + 2)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ast.kind).toBe('unary');
  });
});

describe('parse — syntax errors', () => {
  it('rejects unterminated string', () => {
    const r = parse('"foo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unterminated string/);
  });

  it('rejects unterminated field reference', () => {
    const r = parse('[foo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unterminated field/);
  });

  it('rejects empty field reference', () => {
    const r = parse('[]');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Empty field/);
  });

  it('rejects empty path segment', () => {
    const r = parse('[a..b]');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Empty path segment/);
  });

  it('rejects unmatched paren', () => {
    const r = parse('(1 + 2');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Expected '\)'/);
  });

  it('rejects ternary without colon', () => {
    const r = parse('[a] ? 1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Expected ':'/);
  });

  it('rejects bare identifier', () => {
    const r = parse('foo');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Bare identifier/);
  });

  it('rejects trailing garbage', () => {
    const r = parse('1 + 2 3');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/trailing token/);
  });

  it('rejects unexpected character', () => {
    const r = parse('@');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unexpected character/);
  });

  it('rejects invalid number (missing exponent digits)', () => {
    const r = parse('1e');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/missing exponent/);
  });

  it('rejects invalid arg separator', () => {
    const r = parse('IF([a] 1)');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/','.*or.*'\)'/);
  });
});
