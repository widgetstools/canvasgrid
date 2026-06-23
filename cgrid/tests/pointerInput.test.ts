import { describe, it, expect, vi } from 'vitest';
import { PointerInput } from '../src/interaction/pointerInput';
import { HitTester } from '../src/interaction/hitTester';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { ViewportState } from '../src/core/viewport';

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [{ rowIndex: 0, top: 32, bottom: 62, height: 30 }],
  firstRow: 0, lastRow: 0,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 62, bodyWidth: 250, bodyHeight: 30,
};

function setup() {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 300, height: 200 }) });
  document.body.appendChild(canvas);
  const hit = new HitTester(() => vs, () => 32, () => 4);
  const sel = new SelectionModel('multiple');
  const onClick = vi.fn();
  const onDbl = vi.fn();
  const input = new PointerInput({
    canvas, hitTester: hit, selectionModel: sel,
    visibleColIds: () => ['a', 'b'],
    visibleRowIndices: () => [0],
    onCellClicked: onClick, onCellDoubleClicked: onDbl,
  });
  return { canvas, sel, onClick, onDbl, input };
}

describe('PointerInput', () => {
  it('cell click updates focus and fires onCellClicked', () => {
    const { canvas, sel, onClick } = setup();
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 45, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup',   { clientX: 150, clientY: 45, bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(0);
    expect(sel.state.focusedColId).toBe('b');
    expect(onClick).toHaveBeenCalled();
  });

  it('double-click fires onCellDoubleClicked', () => {
    const { canvas, onDbl } = setup();
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 50, clientY: 45, bubbles: true }));
    expect(onDbl).toHaveBeenCalled();
  });
});
