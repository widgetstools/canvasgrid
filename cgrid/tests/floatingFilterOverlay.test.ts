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

  it('positions each input via transform: translate(left, top)', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
    ]);
    overlay.repositionAll(vp);
    const inputA = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    const inputB = host.querySelector('input[data-cg-col-id="b"]') as HTMLInputElement;
    // Uses transform, not `left` (avoids layout reads on scroll path).
    expect(inputA.style.transform).toContain('translate(0px');
    expect(inputB.style.transform).toContain('translate(100px');
    // Y comes from deps.getRowTop().
    expect(inputA.style.transform).toContain('30px');
    expect(inputA.style.width).toBe('100px');
    expect(inputA.style.height).toBe('28px');
    // `left` stays at the static reset (0px) across columns — only `transform`
    // varies per column. Proves positioning isn't done via the `left` style
    // (which would force layout reads on the scroll path).
    expect(inputA.style.left).toBe(inputB.style.left);
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
    expect(secondInput.style.transform).toContain('translate(50px');
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

  it('syncInputValue sets the input value from a CFilterModelEntry', () => {
    const overlay = new FloatingFilterOverlay(host, makeDeps());
    const vp = makeViewport([
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ]);
    overlay.repositionAll(vp);
    overlay.syncInputValue('a', { filterType: 'text', type: 'contains', filter: 'POS' });
    const input = host.querySelector('input[data-cg-col-id="a"]') as HTMLInputElement;
    expect(input.value).toBe('POS');
    overlay.syncInputValue('a', null);
    expect(input.value).toBe('');
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
