/**
 * Cycle 7 / Task 5 — TextFilterPopup unit tests.
 *
 * Exercises the popup body the FilterPopupHost mounts for a text
 * column. Structurally identical to numberFilter.test.ts /
 * dateFilter.test.ts — the operator surface is the eight ag-grid text
 * ops, the input is `<input type="text">`, and a `caseSensitive`
 * checkbox sits below the input.
 *
 * Covers:
 * - operator <select> contents (the 8 text-filter ops)
 * - text input is mounted; blank / notBlank hide it
 * - caseSensitive checkbox renders by default; showCaseSensitiveToggle:
 *   false suppresses it
 * - Apply produces a CTextFilterModel with the resolved fields
 * - Apply with caseSensitive checked sets `caseSensitive: true` on the
 *   committed model
 * - Apply on blank produces an operator-only model
 * - Apply with empty primary input on a value-operator produces null
 * - Clear empties the input without calling onApply
 * - Reset calls onApply(null) and empties the input
 * - initialModel hydrates the operator + input + caseSensitive state
 * - buttons param filters which buttons render
 * - closeOnApply triggers onClose after Apply
 * - cancel button calls onClose without onApply
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextFilterPopup } from '../src/interaction/filters/textFilter';

describe('TextFilterPopup', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('buildGui returns a root with one <select> and a primary text <input>', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const selects = gui.querySelectorAll('select');
    expect(selects.length).toBe(1);
    const primary = gui.querySelector('input[type="text"][data-vg-filter-input="primary"]');
    expect(primary).not.toBeNull();
  });

  it('operator <select> carries the eight ag-grid text-filter options', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      'contains', 'notContains',
      'equals', 'notEqual',
      'startsWith', 'endsWith',
      'blank', 'notBlank',
    ]);
  });

  it('selecting blank hides the text input', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    expect(primary.style.display).not.toBe('none');
    select.value = 'blank';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(primary.style.display).toBe('none');
  });

  it('selecting notBlank hides the text input', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    select.value = 'notBlank';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(primary.style.display).toBe('none');
  });

  it('caseSensitive checkbox renders by default', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const cb = gui.querySelector('input[type="checkbox"][data-vg-filter-case-sensitive]');
    expect(cb).not.toBeNull();
  });

  it('showCaseSensitiveToggle: false suppresses the checkbox', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
      showCaseSensitiveToggle: false,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const cb = gui.querySelector('input[type="checkbox"][data-vg-filter-case-sensitive]');
    expect(cb).toBeNull();
  });

  it('Apply with contains + value produces the v2 text model', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    primary.value = 'POS-1';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'text', type: 'contains', filter: 'POS-1',
    });
  });

  it('Apply with startsWith + value emits the operator on the model', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'startsWith';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    primary.value = 'POS';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'text', type: 'startsWith', filter: 'POS',
    });
  });

  it('Apply with caseSensitive checked sets caseSensitive: true on the model', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    primary.value = 'POS';
    const cb = gui.querySelector('input[type="checkbox"][data-vg-filter-case-sensitive]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'text', type: 'contains', filter: 'POS', caseSensitive: true,
    });
  });

  it('Apply on blank produces an operator-only model with no filter field', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'blank';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'text', type: 'blank',
    });
  });

  it('Apply with empty primary input on a value-operator produces null (no filter)', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Clear empties the input without calling onApply', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: { filterType: 'text', type: 'contains', filter: 'POS' },
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    expect(primary.value).toBe('POS');
    const clearBtn = gui.querySelector('button[data-vg-filter-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect(primary.value).toBe('');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Reset empties the input AND calls onApply(null)', () => {
    const onApply = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: { filterType: 'text', type: 'startsWith', filter: 'POS', caseSensitive: true },
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const resetBtn = gui.querySelector('button[data-vg-filter-action="reset"]') as HTMLButtonElement;
    resetBtn.click();
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    const cb = gui.querySelector('input[type="checkbox"][data-vg-filter-case-sensitive]') as HTMLInputElement;
    expect(primary.value).toBe('');
    expect(cb.checked).toBe(false);
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('initialModel hydrates the operator + primary input + caseSensitive', () => {
    const popup = new TextFilterPopup({
      initialModel: { filterType: 'text', type: 'startsWith', filter: 'POS', caseSensitive: true },
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    const cb = gui.querySelector('input[type="checkbox"][data-vg-filter-case-sensitive]') as HTMLInputElement;
    expect(select.value).toBe('startsWith');
    expect(primary.value).toBe('POS');
    expect(cb.checked).toBe(true);
  });

  it('buttons param filters which buttons render', () => {
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
      buttons: ['apply'],
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    expect(gui.querySelector('button[data-vg-filter-action="apply"]')).not.toBeNull();
    expect(gui.querySelector('button[data-vg-filter-action="clear"]')).toBeNull();
    expect(gui.querySelector('button[data-vg-filter-action="reset"]')).toBeNull();
  });

  it('closeOnApply: true triggers onClose after Apply', () => {
    const onClose = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose,
      closeOnApply: true,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    primary.value = 'POS';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnApply defaults to false — onClose is NOT called after Apply', () => {
    const onClose = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="text"]') as HTMLInputElement;
    primary.value = 'POS';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel button (when configured) calls onClose without onApply', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const popup = new TextFilterPopup({
      initialModel: null,
      onApply,
      onClose,
      buttons: ['apply', 'cancel'],
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const cancelBtn = gui.querySelector('button[data-vg-filter-action="cancel"]') as HTMLButtonElement;
    cancelBtn.click();
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
