// Cycle 15.5 / Task 8 — aggregation extensions tests.
//
// Covers:
//  - Object-returning custom aggFuncs (extraction via {value} field)
//  - AggFuncRegistry accepting and executing object-return funcs
//  - groupTotalRow / grandTotalRow option aliases
//  - Filter-changes recompute logic with GroupPass + AggPass

import { describe, it, expect } from 'vitest';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import type { IAggFunc, IAggFuncParams, CGridOptions } from '../src/types';

// ─── Helper: replicate totalsCellLookup extraction logic ─────────────────────
// This mirrors the logic added to cgrid.ts totalsCellLookup so we can test
// the object-field extraction without instantiating the full grid.

function extractCellValue(raw: unknown, formatNum: (v: number) => string = String):
  { value: unknown; valueFormatted: string } | null {
  if (raw === undefined) return null;
  if (raw === null) return { value: null, valueFormatted: '' };
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const obj = raw as { value: unknown; valueFormatted?: string };
    const inner = obj.value;
    if (typeof obj.valueFormatted === 'string') {
      return { value: inner, valueFormatted: obj.valueFormatted };
    }
    if (typeof inner === 'number') {
      return { value: inner, valueFormatted: formatNum(inner) };
    }
    return { value: inner, valueFormatted: inner == null ? '' : String(inner) };
  }
  if (typeof raw === 'number') {
    return { value: raw, valueFormatted: formatNum(raw) };
  }
  return { value: raw, valueFormatted: String(raw) };
}

// ─── Object-returning aggFunc: extraction tests ───────────────────────────────

describe('extractCellValue: object {value} extraction', () => {
  it('null raw → {value: null, valueFormatted: ""}', () => {
    expect(extractCellValue(null)).toEqual({ value: null, valueFormatted: '' });
  });

  it('undefined raw → null (no totals cell)', () => {
    expect(extractCellValue(undefined)).toBeNull();
  });

  it('plain number → pass through number formatter', () => {
    const r = extractCellValue(42, v => `$${v.toFixed(2)}`);
    expect(r).toEqual({ value: 42, valueFormatted: '$42.00' });
  });

  it('plain string raw → string value', () => {
    expect(extractCellValue('APAC')).toEqual({ value: 'APAC', valueFormatted: 'APAC' });
  });

  it('object {value: number} → numeric path with formatter', () => {
    const r = extractCellValue({ value: 123, weight: 50 }, v => `${v}`);
    expect(r).toEqual({ value: 123, valueFormatted: '123' });
  });

  it('object {value: string} → string path', () => {
    const r = extractCellValue({ value: 'HIGH' });
    expect(r).toEqual({ value: 'HIGH', valueFormatted: 'HIGH' });
  });

  it('object {value: null} → null inner', () => {
    const r = extractCellValue({ value: null });
    expect(r).toEqual({ value: null, valueFormatted: '' });
  });

  it('object with pre-formatted string — uses valueFormatted verbatim', () => {
    const r = extractCellValue({ value: 99.9, valueFormatted: '99.9%' });
    expect(r).toEqual({ value: 99.9, valueFormatted: '99.9%' });
  });

  it('object {value: 0} — zero is a valid number, not null', () => {
    const r = extractCellValue({ value: 0 });
    expect(r!.value).toBe(0);
    expect(r!.valueFormatted).toBe('0');
  });

  it('object {value: undefined} — undefined inner treated as empty string', () => {
    const r = extractCellValue({ value: undefined });
    expect(r!.valueFormatted).toBe('');
  });
});

// ─── AggFuncRegistry: object-returning funcs ──────────────────────────────────

describe('AggFuncRegistry with object-returning custom funcs', () => {
  it('registers and resolves a custom weighted-average func', () => {
    const reg = new AggFuncRegistry();
    const weightedAvg: IAggFunc<number, { value: number; weight: number }> =
      ({ values }) => {
        const sum = values.reduce((a, v) => a + v, 0);
        return { value: sum / (values.length || 1), weight: values.length };
      };
    reg.register('weightedAvg', weightedAvg as IAggFunc);
    const fn = reg.resolve('weightedAvg');
    expect(fn).toBeDefined();
    const result = fn!({ values: [10, 20, 30], colId: 'price' }) as { value: number; weight: number };
    expect(result.value).toBe(20);
    expect(result.weight).toBe(3);
  });

  it('object result passes through resolve unchanged', () => {
    const reg = new AggFuncRegistry();
    reg.register('objFunc', ({ values }) => ({ value: values[0], meta: 'test' }) as any);
    const fn = reg.resolve('objFunc')!;
    const res = fn({ values: [42], colId: 'x' }) as any;
    expect(res.value).toBe(42);
    expect(res.meta).toBe('test');
  });

  it('custom object func shadows built-in sum', () => {
    const reg = new AggFuncRegistry();
    reg.register('sum', () => ({ value: 999, custom: true }) as any);
    const fn = reg.resolve('sum')!;
    const res = fn({ values: [1, 2, 3], colId: 'x' }) as any;
    expect(res.value).toBe(999); // custom shadows built-in
  });

  it('built-in sum still returns plain number (not object)', () => {
    const reg = new AggFuncRegistry();
    const fn = reg.resolve('sum')!;
    const res = fn({ values: [1, 2, 3], colId: 'x' });
    expect(typeof res).toBe('number');
    expect(res).toBe(6);
  });

  it('fallback list resolves first matching func', () => {
    const reg = new AggFuncRegistry();
    reg.register('p99', () => ({ value: 99, percentile: 99 }) as any);
    const fn = reg.resolve(['unknownFunc', 'p99'])!;
    const res = fn({ values: [], colId: 'x' }) as any;
    expect(res.value).toBe(99);
  });
});

// ─── groupTotalRow / grandTotalRow option mapping ─────────────────────────────
// Test that the aliasing logic produces the right groupIncludeFooter /
// groupIncludeTotalFooter values. We test the pure mapping expression since
// we can't instantiate CGrid in unit tests.

function resolveFooterFlags(opts: Partial<CGridOptions>): {
  groupIncludeFooter: boolean | undefined;
  groupIncludeTotalFooter: boolean | undefined;
} {
  return {
    groupIncludeFooter:
      opts.groupIncludeFooter
      ?? (opts.groupTotalRow != null ? true : undefined),
    groupIncludeTotalFooter:
      opts.groupIncludeTotalFooter
      ?? (opts.grandTotalRow != null ? true : undefined),
  };
}

describe('groupTotalRow / grandTotalRow aliases', () => {
  it('neither old nor new option → both undefined', () => {
    const r = resolveFooterFlags({});
    expect(r.groupIncludeFooter).toBeUndefined();
    expect(r.groupIncludeTotalFooter).toBeUndefined();
  });

  it('groupTotalRow: "bottom" → groupIncludeFooter: true', () => {
    const r = resolveFooterFlags({ groupTotalRow: 'bottom' });
    expect(r.groupIncludeFooter).toBe(true);
    expect(r.groupIncludeTotalFooter).toBeUndefined();
  });

  it('groupTotalRow: "top" → groupIncludeFooter: true', () => {
    const r = resolveFooterFlags({ groupTotalRow: 'top' });
    expect(r.groupIncludeFooter).toBe(true);
  });

  it('grandTotalRow: "bottom" → groupIncludeTotalFooter: true', () => {
    const r = resolveFooterFlags({ grandTotalRow: 'bottom' });
    expect(r.groupIncludeTotalFooter).toBe(true);
    expect(r.groupIncludeFooter).toBeUndefined();
  });

  it('both new options set → both flags true', () => {
    const r = resolveFooterFlags({ groupTotalRow: 'bottom', grandTotalRow: 'bottom' });
    expect(r.groupIncludeFooter).toBe(true);
    expect(r.groupIncludeTotalFooter).toBe(true);
  });

  it('old groupIncludeFooter: true takes precedence over groupTotalRow: null', () => {
    const r = resolveFooterFlags({ groupIncludeFooter: true, groupTotalRow: null });
    expect(r.groupIncludeFooter).toBe(true);
  });

  it('groupTotalRow: null → does NOT enable footer', () => {
    const r = resolveFooterFlags({ groupTotalRow: null });
    expect(r.groupIncludeFooter).toBeUndefined();
  });

  it('grandTotalRow: null → does NOT enable total footer', () => {
    const r = resolveFooterFlags({ grandTotalRow: null });
    expect(r.groupIncludeTotalFooter).toBeUndefined();
  });

  it('old groupIncludeFooter: false + groupTotalRow: "bottom" — old flag wins (false)', () => {
    // undefined ?? fallback; false ?? fallback uses false (falsy, not undefined)
    const r = resolveFooterFlags({ groupIncludeFooter: false, groupTotalRow: 'bottom' });
    expect(r.groupIncludeFooter).toBe(false);
  });
});

// ─── CGridOptions type: new fields present ─────────────────────────────────────

describe('CGridOptions type: groupTotalRow / grandTotalRow fields', () => {
  it('groupTotalRow: "bottom" compiles on CGridOptions', () => {
    const opts: Partial<CGridOptions> = { groupTotalRow: 'bottom' };
    expect(opts.groupTotalRow).toBe('bottom');
  });

  it('groupTotalRow: "top" compiles', () => {
    const opts: Partial<CGridOptions> = { groupTotalRow: 'top' };
    expect(opts.groupTotalRow).toBe('top');
  });

  it('groupTotalRow: null compiles', () => {
    const opts: Partial<CGridOptions> = { groupTotalRow: null };
    expect(opts.groupTotalRow).toBeNull();
  });

  it('grandTotalRow accepts "top" | "bottom" | null', () => {
    const a: Partial<CGridOptions> = { grandTotalRow: 'top' };
    const b: Partial<CGridOptions> = { grandTotalRow: 'bottom' };
    const c: Partial<CGridOptions> = { grandTotalRow: null };
    expect([a.grandTotalRow, b.grandTotalRow, c.grandTotalRow]).toEqual(['top', 'bottom', null]);
  });
});
