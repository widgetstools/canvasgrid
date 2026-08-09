import { describe, expect, it } from 'vitest';
import { fieldsToColumnDefinitions, inferFieldsFromRows } from '../src/schema/infer';

describe('inferFieldsFromRows', () => {
  it('infers types and null ratios', () => {
    const fields = inferFieldsFromRows([
      { id: 'a', qty: 1, active: true, asOf: '2026-01-01' },
      { id: 'b', qty: null, active: false, asOf: '2026-02-01' },
    ]);
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
    expect(byPath.id?.inferredType).toBe('text');
    expect(byPath.qty?.inferredType).toBe('number');
    expect(byPath.qty?.nullRatio).toBeCloseTo(0.5);
    expect(byPath.active?.inferredType).toBe('boolean');
    expect(byPath.asOf?.inferredType).toBe('date');
  });

  it('promotes fields to column definitions without objects', () => {
    const cols = fieldsToColumnDefinitions([
      { path: 'id', inferredType: 'text', nullRatio: 0, samples: ['a'] },
      { path: 'meta', inferredType: 'object', nullRatio: 0, samples: [{}] },
    ]);
    expect(cols.map((c) => c.field)).toEqual(['id']);
    expect(cols[0]?.headerName).toBe('Id');
  });
});
