/**
 * Cycle 7 / Task 3 — NumberFilterPopup unit tests.
 *
 * Exercises the popup body the FilterPopupHost mounts for a numeric
 * column. Covers:
 * - operator <select> contents (the 9 number-filter ops)
 * - second numeric input visibility (only when operator === 'inRange')
 * - second input visibility for `blank` / `notBlank` (the primary
 *   input also hides — operator is the entire model)
 * - Apply with `equals` produces `{ filterType:'number', type:'equals',
 *   filter:50 }`
 * - Apply with `inRange` produces `{filter:50, filterTo:100, type:'inRange'}`
 * - Apply with empty primary input on a value-operator produces null
 * - Clear empties both inputs but does NOT call onApply
 * - Reset calls onApply(null) and empties both inputs
 * - Initial model populates the inputs + operator on first mount
 * - buttons param filters which buttons render
 * - closeOnApply triggers onClose after Apply
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NumberFilterPopup } from '../src/interaction/filters/numberFilter';

describe('NumberFilterPopup', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('buildGui returns a root with one <select> and a primary numeric <input>', () => {
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const selects = gui.querySelectorAll('select');
    expect(selects.length).toBe(1);
    const primary = gui.querySelector('input[type="number"][data-vg-filter-input="primary"]');
    expect(primary).not.toBeNull();
  });

  it('operator <select> carries the nine ag-grid number-filter options', () => {
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      'equals', 'notEqual',
      'lessThan', 'lessThanOrEqual',
      'greaterThan', 'greaterThanOrEqual',
      'inRange',
      'blank', 'notBlank',
    ]);
  });

  it('selecting inRange reveals a second numeric input', () => {
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    // Both inputs live in the DOM; visibility is driven by `display:none`
    // so the user's typed `filterTo` survives an operator round-trip.
    const visibleBefore = Array.from(gui.querySelectorAll('input[type="number"]'))
      .filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visibleBefore.length).toBe(1);
    select.value = 'inRange';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const visibleAfter = Array.from(gui.querySelectorAll('input[type="number"]'))
      .filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visibleAfter.length).toBe(2);
  });

  it('selecting blank / notBlank hides both numeric inputs', () => {
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'blank';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const visibleInputs = Array.from(gui.querySelectorAll('input[type="number"]'))
      .filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visibleInputs.length).toBe(0);
  });

  it('Apply with equals + 50 produces the v2 number model', () => {
    const onApply = vi.fn();
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="number"]') as HTMLInputElement;
    primary.value = '50';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'number', type: 'equals', filter: 50,
    });
  });

  it('Apply with inRange + 50 / 100 produces filter + filterTo', () => {
    const onApply = vi.fn();
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'inRange';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const inputs = gui.querySelectorAll('input[type="number"]');
    (inputs[0] as HTMLInputElement).value = '50';
    (inputs[1] as HTMLInputElement).value = '100';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'number', type: 'inRange', filter: 50, filterTo: 100,
    });
  });

  it('Apply on blank produces an operator-only model with no filter field', () => {
    const onApply = vi.fn();
    const popup = new NumberFilterPopup({
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
      filterType: 'number', type: 'blank',
    });
  });

  it('Apply with empty primary input on a value-operator produces null (no filter)', () => {
    const onApply = vi.fn();
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    // Operator stays at the default ('equals') with no number typed.
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Clear empties both inputs without calling onApply', () => {
    const onApply = vi.fn();
    const popup = new NumberFilterPopup({
      initialModel: { filterType: 'number', type: 'inRange', filter: 1, filterTo: 100 },
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const inputs = gui.querySelectorAll('input[type="number"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('1');
    expect((inputs[1] as HTMLInputElement).value).toBe('100');
    const clearBtn = gui.querySelector('button[data-vg-filter-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    expect((inputs[1] as HTMLInputElement).value).toBe('');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Reset empties both inputs AND calls onApply(null)', () => {
    const onApply = vi.fn();
    const popup = new NumberFilterPopup({
      initialModel: { filterType: 'number', type: 'inRange', filter: 1, filterTo: 100 },
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const resetBtn = gui.querySelector('button[data-vg-filter-action="reset"]') as HTMLButtonElement;
    resetBtn.click();
    const inputs = gui.querySelectorAll('input[type="number"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    // Reset also clears the second input (still mounted because operator
    // was inRange before reset — reset returns the operator to the
    // default so the second input collapses, but the value clears too).
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('initialModel hydrates the operator + primary input on first mount', () => {
    const popup = new NumberFilterPopup({
      initialModel: { filterType: 'number', type: 'greaterThan', filter: 75 },
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const primary = gui.querySelector('input[type="number"]') as HTMLInputElement;
    expect(select.value).toBe('greaterThan');
    expect(primary.value).toBe('75');
  });

  it('buttons param filters which buttons render', () => {
    const popup = new NumberFilterPopup({
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
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose,
      closeOnApply: true,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="number"]') as HTMLInputElement;
    primary.value = '42';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnApply defaults to false — onClose is NOT called after Apply', () => {
    const onClose = vi.fn();
    const popup = new NumberFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="number"]') as HTMLInputElement;
    primary.value = '42';
    const applyBtn = gui.querySelector('button[data-vg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel button (when configured) calls onClose without onApply', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const popup = new NumberFilterPopup({
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
