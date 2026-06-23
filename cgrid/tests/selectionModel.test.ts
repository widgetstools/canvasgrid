import { describe, it, expect, vi } from 'vitest';
import { SelectionModel } from '../src/interaction/selectionModel';

describe('SelectionModel', () => {
  it('single mode selects exactly one', () => {
    const m = new SelectionModel('single');
    m.selectSingle(3);
    m.selectSingle(5);
    expect(Array.from(m.state.selectedRowIndices)).toEqual([5]);
  });

  it('multiple mode toggles', () => {
    const m = new SelectionModel('multiple');
    m.toggleMulti(1); m.toggleMulti(2); m.toggleMulti(1);
    expect(Array.from(m.state.selectedRowIndices)).toEqual([2]);
  });

  it('range adds a contiguous span', () => {
    const m = new SelectionModel('multiple');
    m.range(2, 5);
    expect(Array.from(m.state.selectedRowIndices).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('range handles reverse order', () => {
    const m = new SelectionModel('multiple');
    m.range(5, 2);
    expect(Array.from(m.state.selectedRowIndices).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('mode=none ignores all selection ops but still tracks focus', () => {
    const m = new SelectionModel('none');
    m.selectSingle(3);
    expect(m.state.selectedRowIndices.size).toBe(0);
    m.setFocus(2, 'b');
    expect(m.state.focusedRowIndex).toBe(2);
  });

  it('onChange fires on each mutation', () => {
    const m = new SelectionModel('multiple');
    const fn = vi.fn();
    m.onChange(fn);
    m.selectSingle(3);
    m.setFocus(3, 'a');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clear empties and fires onChange', () => {
    const m = new SelectionModel('multiple');
    m.toggleMulti(1);
    const fn = vi.fn();
    m.onChange(fn);
    m.clear();
    expect(m.state.selectedRowIndices.size).toBe(0);
    expect(fn).toHaveBeenCalledOnce();
  });
});
