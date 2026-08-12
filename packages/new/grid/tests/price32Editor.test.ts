import { describe, it, expect } from 'vitest';
import type { ICellEditorParams } from '../src/interaction/editors/iCellEditor';
import {
  Price32CellEditor,
  parsePrice32,
  formatPrice32,
} from '../src/interaction/editors/builtins/price32';

function makeParams(over: Partial<ICellEditorParams<unknown, number>> = {}): ICellEditorParams<unknown, number> {
  return {
    data: {}, colId: 'price', value: undefined, charPress: null, params: {},
    cellBounds: { x: 0, y: 0, w: 100, h: 22 }, stopEditing: () => {},
    ...over,
  };
}

describe('parsePrice32', () => {
  it('parses whole-and-32nds notation', () => {
    expect(parsePrice32('101-16')).toBeCloseTo(101.5, 10);
    expect(parsePrice32('101-00')).toBe(101);
    expect(parsePrice32('99-08')).toBeCloseTo(99.25, 10);
    expect(parsePrice32('100-31')).toBeCloseTo(100 + 31 / 32, 10);
  });

  it('parses the half-tick "+" suffix (1/64)', () => {
    expect(parsePrice32('101-16+')).toBeCloseTo(101 + 16.5 / 32, 10);
    expect(parsePrice32('101-00+')).toBeCloseTo(101 + 0.5 / 32, 10);
  });

  it('accepts a plain decimal as a fallback', () => {
    expect(parsePrice32('101.5')).toBe(101.5);
    expect(parsePrice32('  102  ')).toBe(102);
  });

  it('rejects malformed input', () => {
    expect(parsePrice32('')).toBeNull();
    expect(parsePrice32('101-')).toBeNull();
    expect(parsePrice32('101-32')).toBeNull(); // 32nds run 0–31
    expect(parsePrice32('abc')).toBeNull();
    expect(parsePrice32('101-16-')).toBeNull();
  });
});

describe('formatPrice32', () => {
  it('formats decimals as 32nds with zero-padded ticks', () => {
    expect(formatPrice32(101.5)).toBe('101-16');
    expect(formatPrice32(101)).toBe('101-00');
    expect(formatPrice32(99.25)).toBe('99-08');
  });

  it('renders the half-tick "+" suffix', () => {
    expect(formatPrice32(101 + 16.5 / 32)).toBe('101-16+');
    expect(formatPrice32(100 + 31.5 / 32)).toBe('100-31+');
  });

  it('round-trips through parse', () => {
    for (const q of ['101-16', '101-16+', '99-00', '100-31', '100-31+']) {
      expect(formatPrice32(parsePrice32(q)!)).toBe(q);
    }
  });

  it('returns empty string for null / non-finite', () => {
    expect(formatPrice32(null)).toBe('');
    expect(formatPrice32(undefined)).toBe('');
    expect(formatPrice32(NaN)).toBe('');
  });
});

describe('Price32CellEditor', () => {
  it('shows the existing value in 32nds (edit mode)', () => {
    const ed = new Price32CellEditor();
    ed.init(makeParams({ value: 101.5 }));
    expect((ed.getGui() as HTMLInputElement).value).toBe('101-16');
    expect(ed.getValue()).toBeCloseTo(101.5, 10);
    expect(ed.isValid!()).toBe(true);
    ed.destroy();
  });

  it('seeds the raw keystroke in enter mode', () => {
    const ed = new Price32CellEditor();
    ed.init(makeParams({ value: 101.5, charPress: '9' }));
    expect((ed.getGui() as HTMLInputElement).value).toBe('9');
    ed.destroy();
  });

  it('reports invalid for unparseable text', () => {
    const ed = new Price32CellEditor();
    ed.init(makeParams({ value: 101.5 }));
    const input = ed.getGui() as HTMLInputElement;
    input.value = '101-99';
    expect(ed.isValid!()).toBe(false);
    input.value = '';
    expect(ed.isValid!()).toBe(true); // empty clears the cell
    ed.destroy();
  });
});
