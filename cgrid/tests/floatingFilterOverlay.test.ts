import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FloatingFilterOverlay, type FloatingFilterOverlayDeps } from '../src/interaction/floatingFilterOverlay';
import type { ViewportState, ViewportColumn } from '../src/core/viewport';
import type { CFilterModelEntry } from '../src/types';

function makeViewport(cols: ViewportColumn[]): ViewportState {
  return {
    visibleColumns: cols,
    visibleRows: [],
    firstRow: 0,
    lastRow: -1,
    scrollLeft: 0,
    scrollTop: 0,
    bodyLeft: 0,
    bodyRight: cols.reduce((s, c) => Math.max(s, c.right), 0),
    bodyTop: 0,
    bodyBottom: 400,
    bodyWidth: cols.reduce((s, c) => Math.max(s, c.right), 0),
    bodyHeight: 400,
    contentWidth: cols.reduce((s, c) => s + c.width, 0),
    contentHeight: 0,
    maxScrollLeft: 0,
    maxScrollTop: 0,
  };
}

function makeDeps(
  overrides: Partial<FloatingFilterOverlayDeps> = {},
): FloatingFilterOverlayDeps {
  const models = new Map<string, CFilterModelEntry | null>();
  return {
    getColumnFilterModel: (colId) => models.get(colId) ?? null,
    setColumnFilterModel: vi.fn((colId, model) => { models.set(colId, model); }),
    getColDef: (_colId) => ({ floatingFilter: true, filter: 'text' }),
    openColumnFilter: vi.fn(),
    getRowTop: () => 30,
    getRowHeight: () => 28,
    debounceMs: 0,
    ...overrides,
  };
}

describe('FloatingFilterOverlay', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  it('creates one input per visible floating-enabled column on first repositionAll', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const inputs = host.querySelectorAll('input[data-cg-floating-filter]');
    expect(inputs.length).toBe(2);
    expect((inputs[0] as HTMLInputElement).getAttribute('data-cg-col-id')).toBe('a');
    expect((inputs[1] as HTMLInputElement).getAttribute('data-cg-col-id')).toBe('b');
    overlay.destroy();
  });

  it('positions each cell wrapper via transform: translate(left+inset, top+inset)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const cellA = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="a"]') as HTMLElement;
    const cellB = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="b"]') as HTMLElement;
    // Uses transform, not `left` (avoids layout reads on scroll path).
    // Cells are inset 6px horizontally / 4px vertically so the input's
    // border + padding fit cleanly inside the column rect.
    expect(cellA.style.transform).toContain('translate(6px');
    expect(cellB.style.transform).toContain('translate(106px');
    // Y comes from deps.getRowTop() + INSET_Y (4).
    expect(cellA.style.transform).toContain('34px');
    // width = col.width - 2*INSET_X; height = rowHeight - 2*INSET_Y.
    expect(cellA.style.width).toBe('88px');
    expect(cellA.style.height).toBe('20px');
    overlay.destroy();
  });

  it('applies the cg-floating-filter-input class for theming', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    expect(input.classList.contains('cg-floating-filter-input')).toBe(true);
    overlay.destroy();
  });

  it('sets an operator-hint placeholder on number-typed columns', () => {
    const deps = makeDeps({
      getColDef: (colId) => colId === 'qty'
        ? { floatingFilter: true, filter: 'number' }
        : colId === 'price'
          ? { floatingFilter: true, cellDataType: 'number' }
          : { floatingFilter: true, filter: 'text' },
    });
    const overlay = new FloatingFilterOverlay(host, deps);
    const vp = makeViewport([
      { colId: 'name',  index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'qty',   index: 1, left: 100, right: 200, width: 100 },
      { colId: 'price', index: 2, left: 200, right: 300, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const text   = host.querySelector('input[data-cg-col-id="name"]') as HTMLInputElement;
    const qty    = host.querySelector('input[data-cg-col-id="qty"]') as HTMLInputElement;
    const price  = host.querySelector('input[data-cg-col-id="price"]') as HTMLInputElement;
    expect(text.placeholder).toBe('');
    // Explicit `filter: 'number'` lights up the placeholder.
    expect(qty.placeholder).toBe('>100, 1,2,3, 100..200');
    // `cellDataType: 'number'` is the fallback signal when `filter` is unset.
    expect(price.placeholder).toBe('>100, 1,2,3, 100..200');
    // Resolved filter type also lands as a data-* attribute.
    expect(qty.getAttribute('data-cg-filter-type')).toBe('number');
    expect(price.getAttribute('data-cg-filter-type')).toBe('number');
    overlay.destroy();
  });

  it('skips columns whose colDef has floatingFilter:false', () => {
    const deps = makeDeps({
      getColDef: (colId) => colId === 'b'
        ? { floatingFilter: false }
        : { floatingFilter: true, filter: 'text' },
    });
    const overlay = new FloatingFilterOverlay(host, deps);
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
      { colId: 'c', index: 2, left: 200, right: 300, width: 100 },
    ]);
    overlay.repositionAll(vp);
    expect(host.querySelector('input[data-cg-col-id="a"]')).not.toBeNull();
    expect(host.querySelector('input[data-cg-col-id="b"]')).toBeNull();
    expect(host.querySelector('input[data-cg-col-id="c"]')).not.toBeNull();
    overlay.destroy();
  });

  it('reuses pooled cells across repositionAll (no detach/reattach churn)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp1 = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp1);
    const firstInput = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const firstCell  = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="a"]') as HTMLElement;
    expect(firstInput).not.toBeNull();
    expect(firstCell).not.toBeNull();
    firstInput.dataset.testMarker = 'original';
    const vp2 = makeViewport([
      { colId: 'a', index: 0, left: 50, right: 150, width: 100 },
    ]);
    overlay.repositionAll(vp2);
    const secondInput = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const secondCell  = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="a"]') as HTMLElement;
    expect(secondInput).toBe(firstInput);
    expect(secondCell).toBe(firstCell);
    expect(secondInput.dataset.testMarker).toBe('original');
    // 50 (col.left) + 6 (INSET_X) = 56.
    expect(secondCell.style.transform).toContain('translate(56px');
    overlay.destroy();
  });

  it('hides (does not destroy) cells whose column scrolled out of the visible set', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp1 = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp1);
    const inputB = host.querySelector('input[data-cg-col-id="b"]') as HTMLInputElement;
    const cellB  = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="b"]') as HTMLElement;
    inputB.value = 'typed-state';
    const vp2 = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp2);
    // Pool retains the cell + input.
    const stillPresentInput = host.querySelector('input[data-cg-col-id="b"]') as HTMLInputElement | null;
    const stillPresentCell  = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="b"]') as HTMLElement | null;
    expect(stillPresentInput).toBe(inputB);
    expect(stillPresentCell).toBe(cellB);
    expect(stillPresentCell!.style.display).toBe('none');
    // User's typing state survives the scroll-out.
    expect(stillPresentInput!.value).toBe('typed-state');
    overlay.destroy();
  });

  it('syncInputValue sets the input value from a simple v2 entry', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    overlay.syncInputValue('a', { filterType: 'text', type: 'contains', filter: 'POS' });
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    expect(input.value).toBe('POS');
    overlay.destroy();
  });

  it('syncInputValue with null leaves the input alone (protects in-flight user typing)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    input.value = 'user-typed-unparseable';
    overlay.syncInputValue('a', null);
    expect(input.value).toBe('user-typed-unparseable');
    overlay.destroy();
  });

  it('syncInputValue with a multi-condition entry leaves the input alone', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    input.value = '>100 and <200';
    overlay.syncInputValue('a', {
      filterType: 'multi', operator: 'AND',
      conditions: [
        { filterType: 'number', type: 'greaterThan', filter: 100 },
        { filterType: 'number', type: 'lessThan', filter: 200 },
      ],
    });
    expect(input.value).toBe('>100 and <200');
    overlay.destroy();
  });

  it('typing >100 on a number column produces the parsed v2 number entry', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      setColumnFilterModel,
      debounceMs: 50,
      getColDef: () => ({ floatingFilter: true, filter: 'number' }),
    }));
    const vp = makeViewport([
      { colId: 'qty', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="qty"]') as HTMLInputElement;
    input.value = '>100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(setColumnFilterModel).toHaveBeenCalledWith('qty', {
      filterType: 'number', type: 'greaterThan', filter: 100,
    });
    overlay.destroy();
  });

  it('typing a CSV on a number column produces a multi-OR-of-equals entry', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      setColumnFilterModel,
      debounceMs: 50,
      getColDef: () => ({ floatingFilter: true, filter: 'number' }),
    }));
    const vp = makeViewport([
      { colId: 'qty', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="qty"]') as HTMLInputElement;
    input.value = '12,20,33';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(setColumnFilterModel).toHaveBeenCalledWith('qty', {
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'number', type: 'equals', filter: 12 },
        { filterType: 'number', type: 'equals', filter: 20 },
        { filterType: 'number', type: 'equals', filter: 33 },
      ],
    });
    overlay.destroy();
  });

  it('typing unparseable input on a number column clears the filter (null)', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      setColumnFilterModel,
      debounceMs: 50,
      getColDef: () => ({ floatingFilter: true, filter: 'number' }),
    }));
    const vp = makeViewport([
      { colId: 'qty', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="qty"]') as HTMLInputElement;
    input.value = 'not-a-number';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(setColumnFilterModel).toHaveBeenCalledWith('qty', null);
    // Crucially, the typed text stays in the input so the user can correct it.
    expect(input.value).toBe('not-a-number');
    overlay.destroy();
  });

  it('typing in an input calls setColumnFilterModel with the v2 CFilterModelEntry shape', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({ setColumnFilterModel, debounceMs: 100 }));
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    input.value = 'POS-1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Debounce hasn't fired yet.
    expect(setColumnFilterModel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(setColumnFilterModel).toHaveBeenCalledTimes(1);
    expect(setColumnFilterModel).toHaveBeenCalledWith('a', {
      filterType: 'text',
      type: 'contains',
      filter: 'POS-1',
    });
    overlay.destroy();
  });

  it('typing an empty string clears the column filter (null)', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({ setColumnFilterModel, debounceMs: 50 }));
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(setColumnFilterModel).toHaveBeenCalledWith('a', null);
    overlay.destroy();
  });

  it('destroy removes every pooled cell from the DOM', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp);
    expect(host.querySelectorAll('input[data-cg-floating-filter]').length).toBe(2);
    expect(host.querySelectorAll('div[data-cg-floating-filter-cell]').length).toBe(2);
    expect(host.querySelectorAll('button[data-cg-floating-filter-clear]').length).toBe(2);
    overlay.destroy();
    expect(host.querySelectorAll('div[data-cg-floating-filter-cell]').length).toBe(0);
    expect(host.querySelectorAll('input[data-cg-floating-filter]').length).toBe(0);
    expect(host.querySelectorAll('button[data-cg-floating-filter-clear]').length).toBe(0);
  });

  it('mounts a clear button alongside each input, hidden until the input has a value', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps({ debounceMs: 0 }));
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const cell  = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="a"]') as HTMLElement;
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const clear = host.querySelector('button[data-cg-floating-filter-clear][data-cg-col-id="a"]') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    // No value yet — wrapper does NOT carry .has-value class.
    expect(cell.classList.contains('has-value')).toBe(false);
    // Type a character.
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cell.classList.contains('has-value')).toBe(true);
    // Clear via DOM.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cell.classList.contains('has-value')).toBe(false);
    overlay.destroy();
  });

  it('clicking the clear button empties the input and emits setColumnFilterModel(null) immediately', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      setColumnFilterModel,
      // Use a non-zero debounce to prove the clear bypasses it (fires immediately).
      debounceMs: 500,
    }));
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const cell  = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="a"]') as HTMLElement;
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const clear = host.querySelector('button[data-cg-floating-filter-clear][data-cg-col-id="a"]') as HTMLButtonElement;
    input.value = 'POS';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cell.classList.contains('has-value')).toBe(true);
    // Reset the spy so we only see the clear-driven call below.
    setColumnFilterModel.mockClear();
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(input.value).toBe('');
    expect(cell.classList.contains('has-value')).toBe(false);
    // Immediate — no advanceTimersByTime needed.
    expect(setColumnFilterModel).toHaveBeenCalledTimes(1);
    expect(setColumnFilterModel).toHaveBeenCalledWith('a', null);
    overlay.destroy();
  });

  it('clear button cancels any pending typing debounce (no double-fire)', () => {
    const setColumnFilterModel = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      setColumnFilterModel,
      debounceMs: 500,
    }));
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const clear = host.querySelector('button[data-cg-floating-filter-clear][data-cg-col-id="a"]') as HTMLButtonElement;
    input.value = 'POS';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setColumnFilterModel.mockClear();
    clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Clear fired once, synchronously.
    expect(setColumnFilterModel).toHaveBeenCalledTimes(1);
    // Run the debounce timer to completion — should not fire again.
    vi.advanceTimersByTime(600);
    expect(setColumnFilterModel).toHaveBeenCalledTimes(1);
    overlay.destroy();
  });

  it('mounts an expand button on popup-capable columns (Task 3)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      getColDef: () => ({ floatingFilter: true, filter: 'number' }),
    }));
    const vp = makeViewport([
      { colId: 'qty', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const expand = host.querySelector('button[data-cg-floating-filter-expand][data-cg-col-id="qty"]');
    expect(expand).not.toBeNull();
    overlay.destroy();
  });

  it('suppressFloatingFilterButton: true hides the expand button (Task 3)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      getColDef: () => ({ floatingFilter: true, filter: 'number', suppressFloatingFilterButton: true }),
    }));
    const vp = makeViewport([
      { colId: 'qty', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const expand = host.querySelector('button[data-cg-floating-filter-expand][data-cg-col-id="qty"]');
    expect(expand).toBeNull();
    overlay.destroy();
  });

  it('clicking the expand button calls deps.openColumnFilter(colId) (Task 3)', () => {
    const openColumnFilter = vi.fn();
    const overlay = new FloatingFilterOverlay(host, makeDeps({
      openColumnFilter,
      getColDef: () => ({ floatingFilter: true, filter: 'number' }),
    }));
    const vp = makeViewport([
      { colId: 'qty', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const expand = host.querySelector('button[data-cg-floating-filter-expand][data-cg-col-id="qty"]') as HTMLButtonElement;
    expand.click();
    expect(openColumnFilter).toHaveBeenCalledWith('qty');
    overlay.destroy();
  });

  it('syncInputValue with a simple v2 entry also toggles .has-value', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const cell = host.querySelector('div[data-cg-floating-filter-cell][data-cg-col-id="a"]') as HTMLElement;
    expect(cell.classList.contains('has-value')).toBe(false);
    overlay.syncInputValue('a', { filterType: 'text', type: 'contains', filter: 'POS' });
    expect(cell.classList.contains('has-value')).toBe(true);
    overlay.destroy();
  });
});
