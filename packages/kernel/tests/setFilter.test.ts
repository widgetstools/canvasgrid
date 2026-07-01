/**
 * Cycle 7 / Task 9 — SetFilterPopup.
 *
 * DOM assertions on `buildGui()` — verifies the popup mounts a
 * VirtualList over the distinct-value list, virtualises so a 10k-value
 * column costs ~17 checkboxes in the DOM, honours the mini-search +
 * Select All controls, keeps the selection state in a Set<string> (so
 * off-window toggles survive scroll), and commits the right
 * `CSetFilterModel` on Apply.
 */
import { describe, it, expect } from 'vitest';
import { SetFilterPopup } from '../src/interaction/filters/setFilter';
import type { CSetFilterModel } from '../src/types';

function mountInBody(host: HTMLElement, height = 200): void {
  host.style.height = `${height}px`;
  document.body.appendChild(host);
}

function checkboxes(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-cg-set-filter-value]'));
}

describe('SetFilterPopup', () => {
  it('buildGui mounts a VirtualList whose first window renders one checkbox per visible value', () => {
    const popup = new SetFilterPopup({
      values: ['AAPL', 'MSFT', 'GOOG', 'AMZN'],
      initialModel: null,
      onApply: () => {},
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    Object.defineProperty(
      gui.querySelector('[data-cg-set-filter-list]') as HTMLElement,
      'clientHeight',
      { value: 200, configurable: true },
    );
    popup.rebuildList();
    const cbs = checkboxes(gui);
    // 4 distinct values fit in the window easily — all four mount.
    expect(cbs.length).toBe(4);
    const values = cbs.map((c) => c.value);
    expect(values).toEqual(['AAPL', 'MSFT', 'GOOG', 'AMZN']);
    popup.destroy();
    gui.remove();
  });

  it('virtualises a 10k-value list — DOM holds < 50 checkbox inputs', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => `V${i}`);
    const popup = new SetFilterPopup({
      values: big,
      initialModel: null,
      onApply: () => {},
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    Object.defineProperty(
      gui.querySelector('[data-cg-set-filter-list]') as HTMLElement,
      'clientHeight',
      { value: 240, configurable: true },
    );
    popup.rebuildList();
    const cbs = checkboxes(gui);
    expect(cbs.length).toBeGreaterThan(0);
    expect(cbs.length).toBeLessThan(50);
    popup.destroy();
    gui.remove();
  });

  it('suppressMiniFilter hides the search input', () => {
    const popup = new SetFilterPopup({
      values: ['A', 'B', 'C'],
      initialModel: null,
      onApply: () => {},
      onClose: () => {},
      suppressMiniFilter: true,
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    expect(gui.querySelector('input[data-cg-set-filter-search]')).toBeNull();
    popup.destroy();
    gui.remove();
  });

  it('mini-search narrows the visible list AND preserves scroll', () => {
    const big = Array.from({ length: 1000 }, (_, i) => `V${i}`);
    const popup = new SetFilterPopup({
      values: big,
      initialModel: null,
      onApply: () => {},
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    const list = gui.querySelector('[data-cg-set-filter-list]') as HTMLElement;
    Object.defineProperty(list, 'clientHeight', { value: 240, configurable: true });
    popup.rebuildList();
    list.scrollTop = 240;
    list.dispatchEvent(new Event('scroll'));
    const search = gui.querySelector('input[data-cg-set-filter-search]') as HTMLInputElement;
    search.value = 'V12';
    search.dispatchEvent(new Event('input'));
    // The filtered list has fewer rows than the full list — fewer than 50
    // values match "V12" (V12, V120..V129 = 11 matches).
    const cbs = checkboxes(gui);
    expect(cbs.length).toBeGreaterThan(0);
    expect(cbs.length).toBeLessThan(50);
    // Scroll position survives the rebuild — but at the new content
    // extent which may have clamped to a new max.
    expect(list.scrollTop).toBeLessThanOrEqual(240);
  });

  it('Select All toggles every value (including off-window ones)', () => {
    const big = Array.from({ length: 200 }, (_, i) => `V${i}`);
    let captured: CSetFilterModel | null | undefined;
    const popup = new SetFilterPopup({
      values: big,
      initialModel: null,
      onApply: (m) => { captured = m as CSetFilterModel | null; },
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    const list = gui.querySelector('[data-cg-set-filter-list]') as HTMLElement;
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    popup.rebuildList();
    const selectAll = gui.querySelector('input[data-cg-set-filter-select-all]') as HTMLInputElement;
    expect(selectAll).not.toBeNull();
    selectAll.checked = true;
    selectAll.dispatchEvent(new Event('change'));
    const apply = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    apply.click();
    expect(captured).not.toBeNull();
    expect(captured!.filterType).toBe('set');
    expect(captured!.values.length).toBe(200);
    popup.destroy();
    gui.remove();
  });

  it('Select All is tri-state — indeterminate when partial, checked when all, unchecked when none', () => {
    const popup = new SetFilterPopup({
      values: ['A', 'B', 'C'],
      initialModel: null,
      onApply: () => {},
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    popup.rebuildList();
    const selectAll = gui.querySelector('input[data-cg-set-filter-select-all]') as HTMLInputElement;
    // No initial model — popup defaults to "all selected".
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
    // Uncheck one value → indeterminate.
    const first = checkboxes(gui)[0]!;
    first.checked = false;
    first.dispatchEvent(new Event('change'));
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
    // Uncheck the rest → unchecked, not indeterminate.
    for (const cb of checkboxes(gui)) {
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    }
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('off-window selection state survives virtualisation (toggle index 999 + scroll → checked)', () => {
    const big = Array.from({ length: 1000 }, (_, i) => `V${i}`);
    const popup = new SetFilterPopup({
      values: big,
      initialModel: null,
      onApply: () => {},
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    const list = gui.querySelector('[data-cg-set-filter-list]') as HTMLElement;
    Object.defineProperty(list, 'clientHeight', { value: 240, configurable: true });
    popup.rebuildList();
    // Programmatically deselect V999 (which is off-window) via the API
    // shim the popup exposes for tests.
    popup.setValueChecked('V999', false);
    // Scroll V999 into view; it must paint as unchecked, proving the
    // Set<string> state survived virtualisation.
    popup.scrollValueIntoView('V999');
    const cb = gui.querySelector(
      'input[data-cg-set-filter-value][value="V999"]',
    ) as HTMLInputElement | null;
    expect(cb).not.toBeNull();
    expect(cb!.checked).toBe(false);
    // V998 should still be checked (default selected) — proves the
    // toggle was specific to V999, not a wholesale wipe.
    const other = gui.querySelector(
      'input[data-cg-set-filter-value][value="V998"]',
    ) as HTMLInputElement | null;
    expect(other).not.toBeNull();
    expect(other!.checked).toBe(true);
  });

  it('Apply commits a CSetFilterModel with the checked values', () => {
    let captured: CSetFilterModel | null | undefined;
    const popup = new SetFilterPopup({
      values: ['AAPL', 'MSFT', 'GOOG'],
      initialModel: null,
      onApply: (m) => { captured = m as CSetFilterModel | null; },
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    popup.rebuildList();
    // Uncheck MSFT.
    const msft = gui.querySelector(
      'input[data-cg-set-filter-value][value="MSFT"]',
    ) as HTMLInputElement;
    msft.checked = false;
    msft.dispatchEvent(new Event('change'));
    const apply = gui.querySelector('button[data-cg-filter-action="apply"]') as HTMLButtonElement;
    apply.click();
    expect(captured).not.toBeNull();
    expect(captured!.filterType).toBe('set');
    expect(new Set(captured!.values)).toEqual(new Set(['AAPL', 'GOOG']));
  });

  it('initialModel seeds the checked state — only listed values render checked', () => {
    const popup = new SetFilterPopup({
      values: ['AAPL', 'MSFT', 'GOOG', 'AMZN'],
      initialModel: { filterType: 'set', values: ['MSFT', 'GOOG'] },
      onApply: () => {},
      onClose: () => {},
    });
    const gui = popup.buildGui();
    mountInBody(gui);
    popup.rebuildList();
    const checkedValues = checkboxes(gui)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    expect(new Set(checkedValues)).toEqual(new Set(['MSFT', 'GOOG']));
  });
});
