import { describe, it, expect } from 'vitest';
import { formatTick } from '../../src/excel/tick';
import { compileFormat } from '../../src/compile';

const run = (fmt: string, value: unknown): string => {
  const r = compileFormat(fmt);
  if (!r.ok) throw new Error(r.error.message);
  return r.program.formatText({ value, row: {}, colId: 'c' });
};

describe('formatTick', () => {
  it('renders whole 32nds', () => {
    expect(formatTick(101.5, 32, false)).toBe('101-16');
    expect(formatTick(101, 32, false)).toBe('101-00');
    expect(formatTick(99.96875, 32, false)).toBe('99-31');
  });
  it('rounds to the nearest tick', () => {
    expect(formatTick(101.5001, 32, false)).toBe('101-16');
    expect(formatTick(101.51, 32, false)).toBe('101-16'); // 16.32/32 rounds down
    expect(formatTick(101.516, 32, false)).toBe('101-17'); // 16.5+ rounds up
  });
  it('TICK32+ marks the half-tick with +', () => {
    expect(formatTick(101.5, 32, true)).toBe('101-16');
    expect(formatTick(101.515625, 32, true)).toBe('101-16+'); // 33/64
  });
  it('finer denominations append the eighths digit', () => {
    expect(formatTick(101.515625, 64, false)).toBe('101-164');   // 33/64 = 16/32 + 4/8
    expect(formatTick(101.5078125, 128, false)).toBe('101-162'); // 16/32 + 2/8
    expect(formatTick(101.50390625, 256, false)).toBe('101-161');// 16/32 + 1/8
    expect(formatTick(101.5, 256, false)).toBe('101-16');        // zero tail omitted
  });
  it('carries a round-up across the handle', () => {
    expect(formatTick(101.999, 32, false)).toBe('102-00'); // 31.968/32 → 32 → carry
  });
  it('handles sign and junk', () => {
    expect(formatTick(-101.5, 32, false)).toBe('-101-16');
    expect(formatTick(null, 32, false)).toBe('');
    expect(formatTick('abc', 32, false)).toBe('');
  });
  it('a tiny negative that quantizes to zero units renders unsigned (no -0)', () => {
    expect(formatTick(-0.001, 32, false)).toBe('0-00');
  });
});

describe('TICK format strings via compileFormat', () => {
  it('compiles all five tokens', () => {
    expect(run('TICK32', 101.5)).toBe('101-16');
    expect(run('TICK32+', 101.515625)).toBe('101-16+');
    expect(run('TICK64', 101.515625)).toBe('101-164');
    expect(run('TICK128', 101.5078125)).toBe('101-162');
    expect(run('TICK256', 101.50390625)).toBe('101-161');
  });
  it('is whole-string only — embedded TICK32 stays a literal format', () => {
    const r = compileFormat('"TICK32"');
    expect(r.ok).toBe(true);
  });
  it('tick programs style/icon resolve to null', () => {
    const r = compileFormat('TICK32');
    if (!r.ok) throw new Error('compile failed');
    expect(r.program.resolveStyle({ value: 1, row: {}, colId: 'c' })).toBeNull();
    expect(r.program.resolveIcon({ value: 1, row: {}, colId: 'c' })).toBeNull();
    expect(r.program.tiers).toEqual({ tier0: true, tier1: false, tier2: false });
  });
});
