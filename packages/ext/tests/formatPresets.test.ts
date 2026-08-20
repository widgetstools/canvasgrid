import { describe, it, expect } from 'vitest';
import { compileFormat } from '@wellsfargo-starui/velocity-grid/format';
import {
  CATEGORY_LABELS, CURRENCY_QUICK_INSERT, EXCEL_EXAMPLES,
  adjustFormatDecimals, applyCurrencySymbol, categoriesForDataType, codeText,
  defaultSampleValue, filterPresets, findPresetByFormat, presetsForCategory,
  presetsForDataType,
} from '../src/toolbar/formatPresets';

describe('categories', () => {
  it('maps data types to ordered category rails', () => {
    expect(categoriesForDataType('number')).toEqual(['number', 'currency', 'negatives', 'conditional', 'tick', 'percent']);
    expect(categoriesForDataType('date')).toEqual(['date']);
    expect(categoriesForDataType('text')).toEqual(['text']);
    expect(categoriesForDataType('boolean')).toEqual(['boolean', 'text']);
  });
  it('labels match the reference UI', () => {
    expect(CATEGORY_LABELS.negatives).toBe('Negatives & P&L');
    expect(CATEGORY_LABELS.date).toBe('Date & time');
  });
  it('category sizes match the reference counts', () => {
    expect(presetsForCategory('number')).toHaveLength(6);
    expect(presetsForCategory('negatives')).toHaveLength(5);
    expect(presetsForCategory('conditional')).toHaveLength(2);
    expect(presetsForCategory('tick')).toHaveLength(5);
    expect(presetsForCategory('percent')).toHaveLength(3);
    expect(presetsForCategory('date')).toHaveLength(6);
    expect(presetsForCategory('text')).toHaveLength(9);
    expect(presetsForCategory('boolean')).toHaveLength(3);
    expect(presetsForCategory('currency')).toHaveLength(12);
  });
});

describe('every preset compiles and renders its reference sample', () => {
  const all = (['number', 'text', 'date', 'boolean'] as const).flatMap(presetsForDataType);
  it('compiles', () => {
    for (const p of all) {
      const r = compileFormat(p.format);
      expect(r.ok, `${p.id}: ${p.format}`).toBe(true);
    }
  });
  const dtFor = (p: (typeof all)[number]) =>
    p.category === 'date' ? 'date' : p.category === 'text' ? 'text' : p.category === 'boolean' ? 'boolean' : 'number';
  const spot = (id: string, expected: string) => {
    const p = all.find((x) => x.id === id)!;
    const r = compileFormat(p.format);
    if (!r.ok) throw new Error(p.id);
    const value = p.sample ?? defaultSampleValue(dtFor(p));
    expect(r.program.formatText({ value, row: { value }, colId: 'c' })).toBe(expected);
  };
  it('spot-checks screenshot samples', () => {
    spot('num-integer', '1,235');
    spot('num-2dp', '1,234.57');
    spot('num-sci', '1.23E+03');
    spot('num-bps', '+12.3 bp');
    spot('tick-32', '101-16');
    spot('tick-32-plus', '101-16+');
    spot('pct-2', '12.34%');
    spot('str-upper', 'SAMPLE');
    spot('str-prefix-px', 'PX sample');
    spot('date-iso', '2026-04-17');
    spot('bool-yn', 'Y');
  });
});

describe('lookup + search + codeText', () => {
  it('findPresetByFormat trims and matches', () => {
    expect(findPresetByFormat(' #,##0 ')?.id).toBe('num-integer');
    expect(findPresetByFormat('#,##0.0000000')).toBeUndefined();
    expect(findPresetByFormat(undefined)).toBeUndefined();
  });
  it('filterPresets: empty query → [], substring across label/hint/format', () => {
    const presets = presetsForDataType('number');
    expect(filterPresets(presets, '  ')).toEqual([]);
    // 'parens' now matches both the negatives rail and the currency rail's
    // parens-negative variants (currency joined the number data type's rail).
    expect(filterPresets(presets, 'parens').every((p) => p.category === 'negatives' || p.category === 'currency')).toBe(true);
    expect(filterPresets(presets, 'TICK64')).toHaveLength(1);
  });
  it('codeText marks ƒ(x) and tick forms', () => {
    expect(codeText('=UPPER([value])')).toBe('ƒ(x)');
    expect(codeText('TICK32+')).toBe('denom 32+');
    expect(codeText('TICK128')).toBe('denom 128');
    expect(codeText('#,##0')).toBe('#,##0');
  });
});

describe('applyCurrencySymbol', () => {
  it('seeds an empty draft', () => {
    expect(applyCurrencySymbol('', '$')).toBe('$#,##0.00');
    expect(applyCurrencySymbol('', '"£"')).toBe('"£"#,##0.00');
  });
  it('replaces an existing symbol in every section', () => {
    expect(applyCurrencySymbol('$#,##0.00;($#,##0.00)', '€')).toBe('€#,##0.00;(€#,##0.00)');
    expect(applyCurrencySymbol('"£"#,##0.00', '$')).toBe('$#,##0.00');
  });
  it('prepends when no symbol present', () => {
    expect(applyCurrencySymbol('#,##0.00', '"CHF "')).toBe('"CHF "#,##0.00');
  });
  it('quick-insert entries carry the quoted forms', () => {
    expect(CURRENCY_QUICK_INSERT.map((c) => c.label)).toEqual(['$', '€', '£', '¥', '₹', 'CHF']);
    expect(CURRENCY_QUICK_INSERT.find((c) => c.label === 'CHF')!.symbol).toBe('"CHF "');
  });
});

describe('excel reference data', () => {
  it('has the 8 reference sections with tick sentinels', () => {
    expect(EXCEL_EXAMPLES.map((s) => s.title)).toEqual([
      'Numbers & decimals', 'Currency', 'Percent & basis points',
      'Negatives in parens / red', 'Dates & times', 'Conditional (directional)',
      'Fixed-income tick (via preset dropdown)', 'Scientific & custom text',
    ]);
    const tick = EXCEL_EXAMPLES.find((s) => s.title.startsWith('Fixed-income'))!;
    expect(tick.rows.every((r) => r.format.startsWith('—'))).toBe(true);
  });
});

describe('adjustFormatDecimals', () => {
  it('preserves currency / percent wrappers while bumping decimals', () => {
    expect(adjustFormatDecimals('$#,##0.00', +1)).toBe('$#,##0.000');
    expect(adjustFormatDecimals('$#,##0.00', -1)).toBe('$#,##0.0');
    expect(adjustFormatDecimals('$#,##0.0', -1)).toBe('$#,##0');
    expect(adjustFormatDecimals('0.00%', +1)).toBe('0.000%');
    expect(adjustFormatDecimals('€#,##0.00;(€#,##0.00)', -1)).toBe('€#,##0.0;(€#,##0.0)');
  });
  it('adds decimals to integer / raw formats', () => {
    expect(adjustFormatDecimals('$#,##0', +1)).toBe('$#,##0.0');
    expect(adjustFormatDecimals(undefined, +1)).toBe('#,##0.0');
    expect(adjustFormatDecimals('#,##0', +2)).toBe('#,##0.00');
  });
  it('leaves expression and tick formats alone', () => {
    expect(adjustFormatDecimals('TICK32', +1)).toBe('TICK32');
    expect(adjustFormatDecimals('=FIXED([value], 2)', +1)).toBe('=FIXED([value], 2)');
  });
});
