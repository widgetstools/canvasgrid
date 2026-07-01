/**
 * Cycle 7 / Task 4 — DateFilterPopup unit tests.
 *
 * Exercises the popup body the FilterPopupHost mounts for a date
 * column. Structurally identical to numberFilter.test.ts — the only
 * differences are <input type="date"> in place of <input type="number">
 * and ISO-string filter values in place of numbers.
 *
 * Covers:
 * - operator <select> contents (the 9 date-filter ops, same surface as number)
 * - second date input visibility (only when operator === 'inRange')
 * - input visibility for `blank` / `notBlank` (both hide — operator is the model)
 * - Apply with `equals` produces `{filterType:'date', type:'equals', filter:'2026-06-25'}`
 * - Apply with `inRange` produces `{filter, filterTo, type:'inRange'}`
 * - Apply with empty primary input on a value-operator produces null
 * - Clear empties both inputs but does NOT call onApply
 * - Reset calls onApply(null) and empties both inputs
 * - Initial model populates the inputs + operator on first mount
 * - buttons param filters which buttons render
 * - closeOnApply triggers onClose after Apply
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateFilterPopup } from '../src/interaction/filters/dateFilter';

describe('DateFilterPopup', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('buildGui returns a root with one <select> and a primary date <input>', () => {
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const selects = gui.querySelectorAll('select');
    expect(selects.length).toBe(1);
    const primary = gui.querySelector('input[type="date"][data-cg-filter-input="primary"]');
    expect(primary).not.toBeNull();
  });

  it('operator <select> carries the nine ag-grid date-filter options', () => {
    const popup = new DateFilterPopup({
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

  it('selecting inRange reveals a second date input', () => {
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const visibleBefore = Array.from(gui.querySelectorAll('input[type="date"]'))
      .filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visibleBefore.length).toBe(1);
    select.value = 'inRange';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const visibleAfter = Array.from(gui.querySelectorAll('input[type="date"]'))
      .filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visibleAfter.length).toBe(2);
  });

  it('selecting blank / notBlank hides both date inputs', () => {
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'blank';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const visibleInputs = Array.from(gui.querySelectorAll('input[type="date"]'))
      .filter((el) => (el as HTMLElement).style.display !== 'none');
    expect(visibleInputs.length).toBe(0);
  });

  it('Apply with equals + ISO date produces the v2 date model', () => {
    const onApply = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="date"]') as HTMLInputElement;
    primary.value = '2026-06-25';
    const applyBtn = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'date', type: 'equals', filter: '2026-06-25',
    });
  });

  it('Apply with inRange + two ISO dates produces filter + filterTo', () => {
    const onApply = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'inRange';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const inputs = gui.querySelectorAll('input[type="date"]');
    (inputs[0] as HTMLInputElement).value = '2026-01-01';
    (inputs[1] as HTMLInputElement).value = '2026-12-31';
    const applyBtn = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'date', type: 'inRange', filter: '2026-01-01', filterTo: '2026-12-31',
    });
  });

  it('Apply on blank produces an operator-only model with no filter field', () => {
    const onApply = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    select.value = 'blank';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const applyBtn = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith({
      filterType: 'date', type: 'blank',
    });
  });

  it('Apply with empty primary input on a value-operator produces null (no filter)', () => {
    const onApply = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const applyBtn = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Clear empties both inputs without calling onApply', () => {
    const onApply = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: { filterType: 'date', type: 'inRange', filter: '2026-01-01', filterTo: '2026-12-31' },
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const inputs = gui.querySelectorAll('input[type="date"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('2026-01-01');
    expect((inputs[1] as HTMLInputElement).value).toBe('2026-12-31');
    const clearBtn = gui.querySelector('button[data-cg-filter-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    expect((inputs[1] as HTMLInputElement).value).toBe('');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Reset empties both inputs AND calls onApply(null)', () => {
    const onApply = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: { filterType: 'date', type: 'inRange', filter: '2026-01-01', filterTo: '2026-12-31' },
      onApply,
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const resetBtn = gui.querySelector('button[data-cg-filter-action="reset"]') as HTMLButtonElement;
    resetBtn.click();
    const inputs = gui.querySelectorAll('input[type="date"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('initialModel hydrates the operator + primary input on first mount', () => {
    const popup = new DateFilterPopup({
      initialModel: { filterType: 'date', type: 'greaterThan', filter: '2026-06-25' },
      onApply: vi.fn(),
      onClose: vi.fn(),
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const select = gui.querySelector('select') as HTMLSelectElement;
    const primary = gui.querySelector('input[type="date"]') as HTMLInputElement;
    expect(select.value).toBe('greaterThan');
    expect(primary.value).toBe('2026-06-25');
  });

  it('buttons param filters which buttons render', () => {
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose: vi.fn(),
      buttons: ['apply'],
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    expect(gui.querySelector('button[data-cg-filter-action="apply"]')).not.toBeNull();
    expect(gui.querySelector('button[data-cg-filter-action="clear"]')).toBeNull();
    expect(gui.querySelector('button[data-cg-filter-action="reset"]')).toBeNull();
  });

  it('closeOnApply: true triggers onClose after Apply', () => {
    const onClose = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose,
      closeOnApply: true,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="date"]') as HTMLInputElement;
    primary.value = '2026-06-25';
    const applyBtn = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnApply defaults to false — onClose is NOT called after Apply', () => {
    const onClose = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply: vi.fn(),
      onClose,
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const primary = gui.querySelector('input[type="date"]') as HTMLInputElement;
    primary.value = '2026-06-25';
    const applyBtn = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    applyBtn.click();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel button (when configured) calls onClose without onApply', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const popup = new DateFilterPopup({
      initialModel: null,
      onApply,
      onClose,
      buttons: ['apply', 'cancel'],
    });
    const gui = popup.buildGui();
    host.appendChild(gui);
    const cancelBtn = gui.querySelector('button[data-cg-filter-action="cancel"]') as HTMLButtonElement;
    cancelBtn.click();
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
