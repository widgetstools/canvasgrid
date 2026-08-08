import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/tokenizer';
import { parseExcel } from '../../src/excel/parser';
import { evaluateExcel } from '../../src/excel/evaluator';

function fmt(source: string, value: unknown, opts?: { locale?: string; currency?: string }) {
  const tokens = tokenize(source);
  const parsed = parseExcel(tokens);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return evaluateExcel(parsed.tree, {
    value,
    locale: opts?.locale ?? 'en-US',
    currency: opts?.currency ?? 'USD',
  });
}

describe('Excel evaluator — Number formats', () => {
  it('0.00 with positive value', () => {
    expect(fmt('0.00', 1.5).text).toBe('1.50');
  });

  it('0.00 with negative value (single-section format uses same section)', () => {
    expect(fmt('0.00', -1.5).text).toBe('-1.50');
  });

  it('#,##0.00 with grouping', () => {
    expect(fmt('#,##0.00', 1234.5).text).toBe('1,234.50');
  });

  it('$#,##0.00 with currency prefix', () => {
    expect(fmt('$#,##0.00', 1234.56).text).toBe('$1,234.56');
  });

  it('0% multiplies by 100', () => {
    expect(fmt('0%', 0.5).text).toBe('50%');
  });

  it('0.00% multiplies by 100 with fraction digits', () => {
    expect(fmt('0.00%', 0.1234).text).toBe('12.34%');
  });
});

describe('Excel evaluator — Section routing', () => {
  it('positive value uses first section', () => {
    const r = fmt('0.00;[Red]-0.00', 5);
    expect(r.text).toBe('5.00');
    expect(r.style?.color ?? null).toBeNull();
  });

  it('negative value uses second section + applies [Red] style', () => {
    const r = fmt('0.00;[Red]-0.00', -5);
    expect(r.text).toBe('-5.00');
    expect(r.style?.color).toBe('var(--vg-neg-color, #E53935)');
  });

  it('negative section without a literal minus suppresses the auto sign (Excel)', () => {
    // Preset: Green / Red (no sign)
    const r = fmt('[Green]#,##0.00;[Red]#,##0.00', -1234.57);
    expect(r.text).toBe('1,234.57');
    expect(r.text).not.toMatch(/-/);
    expect(r.style?.color).toBe('var(--vg-neg-color, #E53935)');
  });

  it('negative section with $ prefix and no literal minus suppresses the auto sign', () => {
    // Preset: Green / Red $ (no sign)
    const r = fmt('[Green]$#,##0.00;[Red]$#,##0.00', -1234.57);
    expect(r.text).toBe('$1,234.57');
    expect(r.text).not.toMatch(/-/);
  });

  it('paren negative section does not put a minus inside the parentheses', () => {
    const r = fmt('#,##0.00;(#,##0.00)', -1234.57);
    expect(r.text).toBe('(1,234.57)');
  });

  it('red paren negative section keeps color without an inner minus', () => {
    const r = fmt('#,##0.00;[Red](#,##0.00)', -1234.57);
    expect(r.text).toBe('(1,234.57)');
    expect(r.style?.color).toBe('var(--vg-neg-color, #E53935)');
  });

  it('zero value uses third section when present', () => {
    const r = fmt('0.00;-0.00;"—"', 0);
    expect(r.text).toBe('—');
  });

  it('text value uses fourth section', () => {
    const r = fmt('0.00;-0.00;0.00;@', 'hello');
    expect(r.text).toBe('hello');
  });
});

describe('Excel evaluator — Conditional sections', () => {
  it('[>1000] routes value >1000 to first section', () => {
    const r = fmt('[>1000]0.00"K";0.00', 1500);
    expect(r.text).toBe('1500.00K');
  });

  it('[>1000] routes value <=1000 to second section', () => {
    const r = fmt('[>1000]0.00"K";0.00', 500);
    expect(r.text).toBe('500.00');
  });
});

describe('Excel evaluator — Named colors emit StyleObj', () => {
  it('[Green]0.00 emits StyleObj with color', () => {
    const r = fmt('[Green]0.00', 5);
    expect(r.style?.color).toBe('var(--vg-pos-color, #43A047)');
  });

  it('[Blue]0.00 emits StyleObj with color', () => {
    const r = fmt('[Blue]0.00', 5);
    expect(r.style?.color).toBe('#1E88E5');
  });
});

describe('Excel evaluator — Dates', () => {
  it('yyyy-mm-dd', () => {
    const r = fmt('yyyy-mm-dd', new Date('2026-07-01T00:00:00Z'), { locale: 'en-US' });
    // Intl.DateTimeFormat locale-formatted output; validate structure not exact bytes.
    expect(r.text).toMatch(/2026[-/.]0?7[-/.]0?1/);
  });

  it('mmm d, yyyy', () => {
    const r = fmt('mmm d, yyyy', new Date('2026-07-01T00:00:00Z'), { locale: 'en-US' });
    expect(r.text).toMatch(/Jul.*1.*2026/);
  });
});

describe('Excel evaluator — sectionIndex', () => {
  it('sectionIndex returned for section routing', () => {
    const posResult = fmt('0.00;[Red]-0.00', 5);
    expect(posResult.sectionIndex).toBe(0);
    const negResult = fmt('0.00;[Red]-0.00', -5);
    expect(negResult.sectionIndex).toBe(1);
  });
});

describe('Excel evaluator — @ text-placeholder substitution', () => {
  it('literal prefix + @ substitutes the value after the prefix', () => {
    expect(fmt('"PX "@', 'sample').text).toBe('PX sample');
  });
  it('@ + literal suffix substitutes the value before the suffix', () => {
    expect(fmt('@" units"', 'sample').text).toBe('sample units');
  });
  it('bare @ is unchanged (identity passthrough)', () => {
    expect(fmt('@', 'sample').text).toBe('sample');
  });
  it('@ in a 4th Excel section still routes strings there', () => {
    expect(fmt('0.00;-0.00;0.00;"PX "@', 'sample').text).toBe('PX sample');
  });
  it('a numeric value through a single text-only section is stringified at the placeholder', () => {
    expect(fmt('"PX "@', 123).text).toBe('PX 123');
  });
});

describe('Excel evaluator — Edge cases', () => {
  it('null value renders as empty string', () => {
    expect(fmt('0.00', null).text).toBe('');
  });

  it('undefined value renders as empty string', () => {
    expect(fmt('0.00', undefined).text).toBe('');
  });

  it('NaN value renders as empty string', () => {
    expect(fmt('0.00', Number.NaN).text).toBe('');
  });

  it('@ format returns raw string', () => {
    expect(fmt('@', 'raw text').text).toBe('raw text');
  });

  it('General format returns default toString', () => {
    expect(fmt('General', 42).text).toBe('42');
  });
});
