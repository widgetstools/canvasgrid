import { describe, it, expect, vi } from 'vitest';
import type { ICellEditor, ICellEditorParams } from '../src/interaction/editors/iCellEditor';
import { NumberCellEditor } from '../src/interaction/editors/builtins/number';
import { DateCellEditor } from '../src/interaction/editors/builtins/date';
import { DateStringCellEditor } from '../src/interaction/editors/builtins/dateString';
import { SelectCellEditor } from '../src/interaction/editors/builtins/select';
import { LargeTextCellEditor } from '../src/interaction/editors/builtins/largeText';
import { CheckboxCellEditor } from '../src/interaction/editors/builtins/checkbox';

/**
 * Helper — build an ICellEditorParams object with sensible defaults so each
 * test only specifies the bits it cares about.
 */
function makeParams<T = unknown>(over: Partial<ICellEditorParams<unknown, T>> = {}): ICellEditorParams<unknown, T> {
  return {
    data: {},
    colId: 'c',
    value: undefined as T | undefined as T,
    charPress: null,
    params: {},
    cellBounds: { x: 0, y: 0, w: 100, h: 22 },
    stopEditing: () => {},
    ...over,
  };
}

/** Mounts the editor, runs `init`, returns its root element + the editor. */
function mount<E extends ICellEditor>(editor: E, params: ICellEditorParams): { gui: HTMLElement; editor: E } {
  editor.init(params);
  const gui = editor.getGui();
  document.body.appendChild(gui);
  editor.afterGuiAttached?.();
  return { gui, editor };
}

describe('NumberCellEditor', () => {
  it('mounts an <input type="number"> with the initial value', () => {
    const { gui } = mount(new NumberCellEditor(), makeParams<number>({ value: 42 }));
    const input = gui as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('number');
    expect(input.value).toBe('42');
  });

  it('forwards min, max, step, precision into the input attributes', () => {
    const { gui } = mount(
      new NumberCellEditor(),
      makeParams<number>({ value: 5, params: { min: 0, max: 100, step: 0.5, precision: 2 } }),
    );
    const input = gui as HTMLInputElement;
    expect(input.min).toBe('0');
    expect(input.max).toBe('100');
    expect(input.step).toBe('0.5');
  });

  it('getValue() returns a Number and clamps to min/max', () => {
    const e1 = new NumberCellEditor();
    mount(e1, makeParams<number>({ value: 5, params: { min: 0, max: 10 } }));
    (e1.getGui() as HTMLInputElement).value = '99';
    expect(e1.getValue()).toBe(10);
    const e2 = new NumberCellEditor();
    mount(e2, makeParams<number>({ value: 5, params: { min: 0, max: 10 } }));
    (e2.getGui() as HTMLInputElement).value = '-7';
    expect(e2.getValue()).toBe(0);
  });

  it('getValue() rounds to precision', () => {
    const e = new NumberCellEditor();
    mount(e, makeParams<number>({ value: 0, params: { precision: 2 } }));
    (e.getGui() as HTMLInputElement).value = '3.14159';
    expect(e.getValue()).toBe(3.14);
  });

  it('getValue() returns null for empty / NaN input', () => {
    const e = new NumberCellEditor();
    mount(e, makeParams<number>({ value: 1 }));
    (e.getGui() as HTMLInputElement).value = '';
    expect(e.getValue()).toBeNull();
  });

  it('Enter calls stopEditing(false); Escape calls stopEditing(true)', () => {
    const stopEditing = vi.fn();
    const e = new NumberCellEditor();
    mount(e, makeParams<number>({ value: 1, stopEditing }));
    const input = e.getGui() as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(true);
  });
});

describe('DateCellEditor', () => {
  it('mounts an <input type="date"> with the date value as yyyy-mm-dd', () => {
    const d = new Date(Date.UTC(2026, 5, 24));
    const e = new DateCellEditor();
    mount(e, makeParams<Date>({ value: d }));
    const input = e.getGui() as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-06-24');
  });

  it('getValue() returns a Date for the input string', () => {
    const e = new DateCellEditor();
    mount(e, makeParams<Date>({ value: null }));
    (e.getGui() as HTMLInputElement).value = '2030-01-15';
    const v = e.getValue();
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).toISOString().slice(0, 10)).toBe('2030-01-15');
  });

  it('getValue() returns null for empty input', () => {
    const e = new DateCellEditor();
    mount(e, makeParams<Date>({ value: null }));
    (e.getGui() as HTMLInputElement).value = '';
    expect(e.getValue()).toBeNull();
  });

  it('Enter and Escape route through stopEditing', () => {
    const stopEditing = vi.fn();
    const e = new DateCellEditor();
    mount(e, makeParams<Date>({ value: null, stopEditing }));
    const input = e.getGui() as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(true);
  });
});

describe('DateStringCellEditor', () => {
  it('mounts an <input type="date"> with the string value verbatim', () => {
    const e = new DateStringCellEditor();
    mount(e, makeParams<string>({ value: '2026-06-24' }));
    const input = e.getGui() as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-06-24');
  });

  it('forwards min and max params (string form) to the input', () => {
    const e = new DateStringCellEditor();
    mount(e, makeParams<string>({ value: '2026-06-24', params: { min: '2020-01-01', max: '2030-12-31' } }));
    const input = e.getGui() as HTMLInputElement;
    expect(input.min).toBe('2020-01-01');
    expect(input.max).toBe('2030-12-31');
  });

  it('getValue() returns the raw input string (not a Date)', () => {
    const e = new DateStringCellEditor();
    mount(e, makeParams<string>({ value: '2026-06-24' }));
    (e.getGui() as HTMLInputElement).value = '2027-07-04';
    expect(e.getValue()).toBe('2027-07-04');
  });

  it('Enter and Escape route through stopEditing', () => {
    const stopEditing = vi.fn();
    const e = new DateStringCellEditor();
    mount(e, makeParams<string>({ value: '2026-06-24', stopEditing }));
    const input = e.getGui() as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(true);
  });
});

describe('SelectCellEditor', () => {
  it('mounts a <select> with one <option> per `values` entry; pre-selects the initial value', () => {
    const e = new SelectCellEditor();
    mount(e, makeParams<string>({ value: 'b', params: { values: ['a', 'b', 'c'] } }));
    const select = e.getGui() as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.options).toHaveLength(3);
    expect(select.selectedIndex).toBe(1);
    expect(select.options[select.selectedIndex].textContent).toBe('b');
  });

  it('getValue() returns the typed entry from `values` (not the stringified option)', () => {
    const e = new SelectCellEditor();
    const values = [{ id: 1 }, { id: 2 }, { id: 3 }];
    mount(e, makeParams<{ id: number }>({ value: values[1], params: { values } }));
    const select = e.getGui() as HTMLSelectElement;
    select.selectedIndex = 2;
    expect(e.getValue()).toBe(values[2]);
  });

  it('applies valueListMaxHeight / valueListMaxWidth to the <select> style', () => {
    const e = new SelectCellEditor();
    mount(e, makeParams<string>({
      value: 'a',
      params: { values: ['a', 'b'], valueListMaxHeight: 200, valueListMaxWidth: '120px' },
    }));
    const select = e.getGui() as HTMLSelectElement;
    expect(select.style.maxHeight).toBe('200px');
    expect(select.style.maxWidth).toBe('120px');
  });

  it('Enter and Escape route through stopEditing', () => {
    const stopEditing = vi.fn();
    const e = new SelectCellEditor();
    mount(e, makeParams<string>({ value: 'a', params: { values: ['a', 'b'] }, stopEditing }));
    const select = e.getGui() as HTMLSelectElement;
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(false);
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(true);
  });

  it('change event auto-commits (single-click select)', () => {
    const stopEditing = vi.fn();
    const e = new SelectCellEditor();
    mount(e, makeParams<string>({ value: 'a', params: { values: ['a', 'b', 'c'] }, stopEditing }));
    const select = e.getGui() as HTMLSelectElement;
    select.selectedIndex = 2;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stopEditing).toHaveBeenCalledWith(false);
  });
});

describe('LargeTextCellEditor', () => {
  it('mounts a <textarea> with the initial value and default rows/cols', () => {
    const e = new LargeTextCellEditor();
    mount(e, makeParams<string>({ value: 'hello world' }));
    const ta = e.getGui() as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta.value).toBe('hello world');
    expect(Number(ta.rows)).toBe(10);
    expect(Number(ta.cols)).toBe(60);
  });

  it('honors rows, cols, maxLength params', () => {
    const e = new LargeTextCellEditor();
    mount(e, makeParams<string>({ value: '', params: { rows: 4, cols: 30, maxLength: 50 } }));
    const ta = e.getGui() as HTMLTextAreaElement;
    expect(Number(ta.rows)).toBe(4);
    expect(Number(ta.cols)).toBe(30);
    expect(Number(ta.maxLength)).toBe(50);
  });

  it('isPopup() returns true by default', () => {
    const e = new LargeTextCellEditor();
    expect(e.isPopup?.()).toBe(true);
  });

  it('Ctrl+Enter commits, Enter alone does not, Escape cancels', () => {
    const stopEditing = vi.fn();
    const e = new LargeTextCellEditor();
    mount(e, makeParams<string>({ value: '', stopEditing }));
    const ta = e.getGui() as HTMLTextAreaElement;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stopEditing).not.toHaveBeenCalled();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(false);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(true);
  });
});

describe('CheckboxCellEditor', () => {
  it('mounts an <input type="checkbox"> reflecting the initial boolean', () => {
    const e = new CheckboxCellEditor();
    mount(e, makeParams<boolean>({ value: true }));
    const input = e.getGui() as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(true);
  });

  it('getValue() returns the current checked state (boolean, not "on")', () => {
    const e = new CheckboxCellEditor();
    mount(e, makeParams<boolean>({ value: false }));
    const input = e.getGui() as HTMLInputElement;
    input.checked = true;
    expect(e.getValue()).toBe(true);
    input.checked = false;
    expect(e.getValue()).toBe(false);
  });

  it('Enter and Escape route through stopEditing', () => {
    const stopEditing = vi.fn();
    const e = new CheckboxCellEditor();
    mount(e, makeParams<boolean>({ value: false, stopEditing }));
    const input = e.getGui() as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stopEditing).toHaveBeenLastCalledWith(true);
  });
});
