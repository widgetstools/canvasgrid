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

  it('positions each input via transform: translate(left+inset, top+inset)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const inputA = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const inputB = host.querySelector('input[data-cg-col-id="b"]') as HTMLInputElement;
    // Uses transform, not `left` (avoids layout reads on scroll path).
    // Inputs are inset 6px horizontally / 4px vertically so the styled
    // border + padding fit cleanly inside the column rect.
    expect(inputA.style.transform).toContain('translate(6px');
    expect(inputB.style.transform).toContain('translate(106px');
    // Y comes from deps.getRowTop() + INSET_Y (4).
    expect(inputA.style.transform).toContain('34px');
    // width = col.width - 2*INSET_X; height = rowHeight - 2*INSET_Y.
    expect(inputA.style.width).toBe('88px');
    expect(inputA.style.height).toBe('20px');
    // `left` stays at the static reset (0px) across columns — only `transform`
    // varies per column. Proves positioning isn't done via the `left` style
    // (which would force layout reads on the scroll path).
    expect(inputA.style.left).toBe(inputB.style.left);
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

  it('reuses pooled input elements across repositionAll (no detach/reattach churn)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp1 = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp1);
    const firstInput = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    expect(firstInput).not.toBeNull();
    // Mark the element so we can detect identity preservation.
    firstInput.dataset.testMarker = 'original';
    const vp2 = makeViewport([
      { colId: 'a', index: 0, left: 50, right: 150, width: 100 },
    ]);
    overlay.repositionAll(vp2);
    const secondInput = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    expect(secondInput).toBe(firstInput);
    expect(secondInput.dataset.testMarker).toBe('original');
    // 50 (col.left) + 6 (INSET_X) = 56.
    expect(secondInput.style.transform).toContain('translate(56px');
    overlay.destroy();
  });

  it('hides (does not destroy) inputs whose column scrolled out of the visible set', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp1 = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp1);
    const inputB = host.querySelector('input[data-cg-col-id="b"]') as HTMLInputElement;
    inputB.value = 'typed-state';
    const vp2 = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp2);
    // Pool retains the element.
    const stillPresent = host.querySelector('input[data-cg-col-id="b"]') as HTMLInputElement | null;
    expect(stillPresent).toBe(inputB);
    expect(stillPresent!.style.display).toBe('none');
    // User's typing state survives the scroll-out.
    expect(stillPresent!.value).toBe('typed-state');
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

  it('destroy removes every pooled input from the DOM', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp);
    expect(host.querySelectorAll('input[data-cg-floating-filter]').length).toBe(2);
    overlay.destroy();
    expect(host.querySelectorAll('input[data-cg-floating-filter]').length).toBe(0);
  });
});
