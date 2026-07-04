import { describe, it, expect } from 'vitest';
import { makeRows, fmtCcy, fmtBp, fmtSignedCcy } from './data';

describe('makeRows', () => {
  it('returns the requested number of fully-populated rows', () => {
    const rows = makeRows(50);
    expect(rows).toHaveLength(50);
    for (const r of rows) {
      expect(typeof r.positionId).toBe('string');
      expect(r.positionId.length).toBeGreaterThan(0);
      expect(typeof r.dayPnl).toBe('number');
      expect(typeof r.delta).toBe('number');
      expect(r.maturity).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('is deterministic (seeded)', () => {
    expect(makeRows(10)).toEqual(makeRows(10));
  });

  it('defaults to 200 rows', () => {
    expect(makeRows()).toHaveLength(200);
  });
});

describe('formatters', () => {
  it('formats currency with a $ and thousands separators', () => {
    expect(fmtCcy({ value: 1234567 } as never)).toBe('$1,234,567');
  });
  it('formats basis points', () => {
    expect(fmtBp({ value: 12.5 } as never)).toBe('12.50 bp');
  });
  it('formats signed currency with sign', () => {
    expect(fmtSignedCcy({ value: -2100 } as never)).toBe('-$2,100');
    expect(fmtSignedCcy({ value: 3400 } as never)).toBe('+$3,400');
  });
  it('renders empty string for nullish values', () => {
    expect(fmtCcy({ value: null } as never)).toBe('');
  });
});
