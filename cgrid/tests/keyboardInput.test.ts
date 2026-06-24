import { describe, it, expect, vi } from 'vitest';
import { KeyboardInput } from '../src/interaction/keyboardInput';
import { HitTester } from '../src/interaction/hitTester';
import { SelectionModel } from '../src/interaction/selectionModel';

describe('KeyboardInput', () => {
  function setup() {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    document.body.appendChild(canvas);
    const sel = new SelectionModel('multiple');
    sel.setFocus(2, 'b');
    const hit = new HitTester(() => ({} as any), () => 32, () => 4, () => 10);
    const visibleCols = () => ['a', 'b', 'c'];
    const visibleRows = () => [0, 1, 2, 3, 4];
    const onDbl = vi.fn();
    const k = new KeyboardInput({
      canvas, hitTester: hit, selectionModel: sel,
      visibleColIds: visibleCols, visibleRowIndices: visibleRows,
      allColIds: visibleCols, totalRowCount: () => 5,
      onCellClicked: () => {}, onCellDoubleClicked: onDbl,
    });
    return { canvas, sel, onDbl };
  }

  it('ArrowDown moves focus to next row', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(sel.state.focusedRowIndex).toBe(3);
  });

  it('ArrowRight moves focus to next column', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(sel.state.focusedColId).toBe('c');
  });

  it('Space toggles row selection in multi', () => {
    const { canvas, sel } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(sel.state.selectedRowIndices.has(2)).toBe(true);
  });

  it('Enter / F2 emits cellDoubleClicked equivalent for editing', () => {
    const { canvas, onDbl } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(onDbl).toHaveBeenCalled();
  });
});
