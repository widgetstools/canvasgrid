import { describe, it, expect } from 'vitest';
import { compileFormat } from '../../src/format/compile';

const program = (fmt: string) => {
  const r = compileFormat(fmt);
  if (!r.ok) throw new Error(r.error.message);
  return r.program;
};
const run = (fmt: string, value: unknown, row: Record<string, unknown> = {}): string =>
  program(fmt).formatText({ value, row, colId: 'c' });

describe('=expr value-formatter form', () => {
  it('formats via expression with value bound', () => {
    expect(run('=UPPER([value])', 'sample')).toBe('SAMPLE');
    expect(run('=[value] ? "Y" : "N"', true)).toBe('Y');
    expect(run('=([value] >= 0 ? "+" : "") + FIXED([value] * 10000, 1) + " bp"', 0.001234)).toBe('+12.3 bp');
  });
  it('value wins a row-field collision; other identifiers hit the row', () => {
    expect(run('=UPPER([value])', 'cell', { value: 'row' })).toBe('CELL');
    expect(run('=UPPER([ticker])', 'ignored', { ticker: 'ibm' })).toBe('IBM');
  });
  it('never throws at eval time', () => {
    expect(run('=FIXED([value], 1)', 'junk')).toBe('');       // builtin total-function path
    expect(run('=[value] / [other]', 5, { other: 0 })).toBe(''); // div-by-zero EvalError → ''
    expect(run('=UPPER([value])', null)).toBe('');
  });
  it('rejects a bad expression at compile time', () => {
    const r = compileFormat('=UPPER(');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('compile-format');
  });
  it('tier flags: tier0 only; style/icon null', () => {
    const p = program('=UPPER([value])');
    expect(p.tiers).toEqual({ tier0: true, tier1: false, tier2: false });
    expect(p.resolveStyle({ value: 'x', row: {}, colId: 'c' })).toBeNull();
  });
});
