import { describe, it, expect } from 'vitest';
import { compileFormat } from '../../src/compile';

const run = (fmt: string, value: unknown): string => {
  const r = compileFormat(fmt);
  if (!r.ok) throw new Error(r.error.message);
  return r.program.formatText({ value, row: {}, colId: 'c' });
};

describe('scientific notation', () => {
  it('formats 0.00E+00 with signed, zero-padded exponent', () => {
    expect(run('0.00E+00', 1234.5678)).toBe('1.23E+03');
    expect(run('0.00E+00', 0.00123)).toBe('1.23E-03');
    expect(run('0.00E+00', 0)).toBe('0.00E+00');
  });
  it('mantissa decimals follow the pattern', () => {
    expect(run('0.0E+00', 1234.5678)).toBe('1.2E+03');
    expect(run('0E+00', 1234.5678)).toBe('1E+03');
  });
  it('E- signs only negative exponents', () => {
    expect(run('0.00E-00', 1234.5678)).toBe('1.23E03');
    expect(run('0.00E-00', 0.00123)).toBe('1.23E-03');
  });
  it('exponent pads to the pattern width', () => {
    expect(run('0.00E+0', 1234.5678)).toBe('1.23E+3');
    expect(run('0.00E+000', 1234.5678)).toBe('1.23E+003');
  });
  it('negatives keep the mantissa sign', () => {
    expect(run('0.00E+00', -1234.5678)).toBe('-1.23E+03');
  });
});
