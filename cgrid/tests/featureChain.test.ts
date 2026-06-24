import { describe, it, expect, vi } from 'vitest';
import { FeatureChain } from '../src/interaction/featureChain';
import { HitTester } from '../src/interaction/hitTester';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { CGridLike } from '../src/interaction/feature';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { CGridCanvas } from '../src/core/canvas';

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 5, getRowHeight: () => 30, getCell: () => null,
};

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [{ rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 }],
  firstRow: 0, lastRow: 0,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 62, bodyWidth: 250, bodyHeight: 30,
  contentWidth: 250, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 0,
};

function setup(opts: { rowCount?: number; cols?: string[]; initialFocus?: { row: number; col: string } } = {}) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 300, height: 200 }) });
  document.body.appendChild(canvas);
  const cgridCanvas = {
    canvas,
    requestRepaint: vi.fn(),
  } as unknown as CGridCanvas;
  const sel = new SelectionModel('multiple');
  if (opts.initialFocus) sel.setFocus(opts.initialFocus.row, opts.initialFocus.col);
  const hit = new HitTester(() => vs, () => 32, () => 4);

  const cols = opts.cols ?? ['a', 'b'];
  const rowCount = opts.rowCount ?? 1;
  const emitClicked = vi.fn();
  const emitDoubleClicked = vi.fn();
  const resizeColumn = vi.fn();
  const cycleSort = vi.fn();
  const scrollBy = vi.fn();

  const grid: CGridLike = {
    canvas: cgridCanvas,
    selection: sel,
    hitTester: hit,
    visibleRowIndices: () => [0],
    allColIds: () => cols,
    totalRowCount: () => rowCount,
    resizeColumn,
    cycleSort,
    scrollBy,
    emitCellClicked: emitClicked,
    emitCellDoubleClicked: emitDoubleClicked,
  };
  const chain = new FeatureChain(grid);
  return { canvas, sel, chain, emitClicked, emitDoubleClicked, resizeColumn, cycleSort, scrollBy };
}

describe('FeatureChain — mouse', () => {
  it('cell mousedown updates focus and selection', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 45, bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: 45, bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(0);
    expect(sel.state.focusedColId).toBe('b');
  });

  it('cell click emits cellClicked', () => {
    const { canvas, emitClicked } = setup();
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 150, clientY: 45, bubbles: true }));
    expect(emitClicked).toHaveBeenCalled();
  });

  it('cell double-click emits cellDoubleClicked', () => {
    const { canvas, emitDoubleClicked } = setup();
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 50, clientY: 45, bubbles: true }));
    expect(emitDoubleClicked).toHaveBeenCalled();
  });

  it('header click cycles sort', () => {
    const { canvas, cycleSort } = setup();
    // Header band is y < 32; pick a header cell well inside column 'a'.
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 30, clientY: 10, bubbles: true }));
    expect(cycleSort).toHaveBeenCalledWith('a');
  });

  it('column resize drag updates column width via resizeColumn', () => {
    const { canvas, resizeColumn } = setup();
    // Drag the right edge of column 'a' (right=100). Hot zone = 4 → 96..100.
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 98, clientY: 10, bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 10, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 10, bubbles: true }));
    expect(resizeColumn).toHaveBeenCalledWith('a', 22);
  });

  it('wheel forwards delta to scrollBy', () => {
    const { canvas, scrollBy } = setup();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 10, deltaY: 20, bubbles: true, cancelable: true }));
    expect(scrollBy).toHaveBeenCalledWith(10, 20);
  });
});

describe('FeatureChain — keyboard', () => {
  it('ArrowDown moves focus to next row', () => {
    const { canvas, sel } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 2, col: 'b' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(3);
  });

  it('ArrowRight moves focus to next column', () => {
    const { canvas, sel } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 2, col: 'b' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(sel.state.focusedColId).toBe('c');
  });

  it('Tab moves to next column, wrapping to next row at the end', () => {
    const { canvas, sel } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 1, col: 'c' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(2);
    expect(sel.state.focusedColId).toBe('a');
  });

  it('Space toggles row selection in multi mode', () => {
    const { canvas, sel } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 2, col: 'b' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(sel.state.selectedRowIndices.has(2)).toBe(true);
  });

  it('F2 emits cellDoubleClicked (edit trigger)', () => {
    const { canvas, emitDoubleClicked } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 2, col: 'b' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(emitDoubleClicked).toHaveBeenCalled();
  });

  it('Escape clears selection', () => {
    const { canvas, sel } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 2, col: 'b' } });
    sel.selectSingle(2);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sel.state.selectedRowIndices.size).toBe(0);
  });

  it('Home / End jump to first / last column', () => {
    const { canvas, sel } = setup({ rowCount: 5, cols: ['a', 'b', 'c'], initialFocus: { row: 2, col: 'b' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(sel.state.focusedColId).toBe('c');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(sel.state.focusedColId).toBe('a');
  });

  it('PageDown advances by one visible page', () => {
    const { canvas, sel } = setup({ rowCount: 100, cols: ['a', 'b'], initialFocus: { row: 0, col: 'a' } });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    // visibleRowIndices() returns [0] (length 1), so PageDown advances by 1.
    expect(sel.state.focusedRowIndex).toBe(1);
  });
});
