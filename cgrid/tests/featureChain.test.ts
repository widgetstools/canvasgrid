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

function setup(opts: { rowCount?: number; cols?: string[]; initialFocus?: { row: number; col: string }; editable?: boolean } = {}) {
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
  const editable = opts.editable ?? false;
  const emitClicked = vi.fn();
  const emitDoubleClicked = vi.fn();
  const resizeColumn = vi.fn();
  const finishColumnResize = vi.fn();
  const cycleSort = vi.fn();
  const selectColumn = vi.fn();
  const scrollBy = vi.fn();
  const toggleColumnGroup = vi.fn();
  const openEditor = vi.fn();
  const stopEditing = vi.fn();

  const grid = {
    canvas: cgridCanvas,
    selection: sel,
    hitTester: hit,
    visibleRowIndices: () => [0],
    allColIds: () => cols,
    totalRowCount: () => rowCount,
    resizeColumn,
    finishColumnResize,
    cycleSort,
    selectColumn,
    getMultiSortKey: () => 'Shift' as const,
    toggleColumnGroup,
    scrollBy,
    emitCellClicked: emitClicked,
    emitCellDoubleClicked: emitDoubleClicked,
    getEditingFlags: () => ({
      singleClickEdit: false,
      suppressClickEdit: false,
      enterNavigatesVertically: false,
      enterNavigatesVerticallyAfterEdit: false,
      suppressStartEditOnTab: false,
      enableCellEditingOnBackspace: false,
      enableExcelEditing: false,
    }),
    isCellEditable: () => editable,
    isColSingleClickEdit: () => undefined,
    getColSuppressKeyboardEvent: () => undefined,
    getRowDataAt: () => ({}),
    isEditing: () => false,
    openEditor,
    stopEditing,
    nextEditableCell: () => null,
    // Cycle 9 / Task 5 — fill-handle hooks. Off by default so the existing
    // featureChain tests (which assert plain range-select / cell-select
    // semantics) aren't disturbed by a fill claim.
    getEnableFillHandle: () => false,
    getFillHandleDirection: () => 'y' as const,
    getRangeBottomRight: () => null,
    commitFill: () => {},
    // Cycle 9 / Task 6 — `cellSelection` bundle. Undefined so the
    // existing chain tests behave with Cycle 9 defaults (drag enabled,
    // header click selects column band).
    getCellSelectionOptions: () => undefined,
    // Cycle 9 / Task 7 — features emit `rangeSelectionChanged` via this
    // hook. No-op here so the chain tests don't depend on the event
    // surface; event semantics are covered in rangeSelectionEvents.test.ts.
    emitRangeSelectionChanged: () => {},
    // Cycle 10 / Task 6 — suppression flags default to `false` so the
    // existing chain tests behave with the open clipboard / context-menu
    // surface. Suppress-specific behaviour is exercised in
    // clipboardSuppress.test.ts.
    isContextMenuSuppressed: () => false,
    isClipboardApiSuppressed: () => false,
    isClipboardPasteSuppressed: () => false,
    // Cycle 15 / Task 6 — row-group panel hooks default to "no panel"
    // so existing chain tests behave identically (drag never sees a
    // drop target).
    isPointInRowGroupPanel: () => false,
    setRowGroupPanelDragHover: () => {},
    commitRowGroupPanelDrop: () => false,
    // Cycle 15 / Task 7 — chevron hit-test defaults to "no group
    // anywhere" so existing chain tests' mousedown / click flow is
    // never intercepted by GroupExpandFeature.
    hitTestGroupChevron: () => null,
    toggleGroupExpanded: () => {},
  } as unknown as CGridLike;
  const chain = new FeatureChain(grid);
  return { canvas, sel, chain, emitClicked, emitDoubleClicked, resizeColumn, cycleSort, scrollBy, openEditor, stopEditing };
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
    expect(cycleSort).toHaveBeenCalledWith('a', { append: false });
  });

  it('header Shift+click cycles sort with append (multi-column)', () => {
    const { canvas, cycleSort } = setup();
    canvas.dispatchEvent(
      new MouseEvent('click', { clientX: 30, clientY: 10, bubbles: true, shiftKey: true }),
    );
    expect(cycleSort).toHaveBeenCalledWith('a', { append: true });
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
    // First event in a gesture: |dy| > |dx| → axis locks to 'y', dx zeroed.
    expect(scrollBy).toHaveBeenCalledWith(0, 20);
  });

  it('axis-lock: dominant-y gesture zeroes dx for the rest of the gesture', () => {
    const { canvas, scrollBy } = setup();
    // First event picks 'y' (|dy|>|dx|).
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 2, deltaY: 30, bubbles: true, cancelable: true }));
    // Subsequent events in the same gesture: even a large dx is suppressed.
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 50, deltaY: 5, bubbles: true, cancelable: true }));
    expect(scrollBy).toHaveBeenNthCalledWith(1, 0, 30);
    expect(scrollBy).toHaveBeenNthCalledWith(2, 0, 5);
  });

  it('axis-lock: dominant-x gesture zeroes dy for the rest of the gesture', () => {
    const { canvas, scrollBy } = setup();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 3, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 5, deltaY: 60, bubbles: true, cancelable: true }));
    expect(scrollBy).toHaveBeenNthCalledWith(1, 40, 0);
    expect(scrollBy).toHaveBeenNthCalledWith(2, 5, 0);
  });

  it('axis-lock releases after the idle window, next gesture re-detects', async () => {
    const { canvas, scrollBy } = setup();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 1, deltaY: 30, bubbles: true, cancelable: true }));
    // Wait past WHEEL_LOCK_IDLE_MS (150ms) so the lock releases.
    await new Promise((r) => setTimeout(r, 200));
    // New gesture: dominant-x this time.
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 2, bubbles: true, cancelable: true }));
    expect(scrollBy).toHaveBeenNthCalledWith(1, 0, 30);
    expect(scrollBy).toHaveBeenNthCalledWith(2, 40, 0);
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

  it("F2 opens the editor on the focused cell in 'edit' mode", () => {
    const { canvas, openEditor } = setup({
      rowCount: 5, cols: ['a', 'b', 'c'],
      initialFocus: { row: 2, col: 'b' }, editable: true,
    });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(openEditor).toHaveBeenCalledWith(2, 'b', undefined, 'edit');
  });

  it('F2 is a no-op on a non-editable cell', () => {
    const { canvas, openEditor } = setup({
      rowCount: 5, cols: ['a', 'b', 'c'],
      initialFocus: { row: 2, col: 'b' }, editable: false,
    });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it("Enter opens the editor on an editable focused cell in 'edit' mode", () => {
    const { canvas, openEditor } = setup({
      rowCount: 5, cols: ['a', 'b', 'c'],
      initialFocus: { row: 2, col: 'b' }, editable: true,
    });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(openEditor).toHaveBeenCalledWith(2, 'b', undefined, 'edit');
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

  it("type-to-edit: printable char opens editor with charPress in 'enter' mode", () => {
    const { canvas, openEditor } = setup({
      rowCount: 5, cols: ['a', 'b', 'c'],
      initialFocus: { row: 2, col: 'b' }, editable: true,
    });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', bubbles: true }));
    expect(openEditor).toHaveBeenCalledWith(2, 'b', 'X', 'enter');
  });

  it('type-to-edit: ignores modifier-key combinations (Ctrl+A)', () => {
    const { canvas, openEditor } = setup({
      rowCount: 5, cols: ['a', 'b', 'c'],
      initialFocus: { row: 2, col: 'b' }, editable: true,
    });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('type-to-edit: skips when the focused column is not editable', () => {
    const { canvas, openEditor } = setup({
      rowCount: 5, cols: ['a', 'b', 'c'],
      initialFocus: { row: 2, col: 'b' }, editable: false,
    });
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
  });
});
