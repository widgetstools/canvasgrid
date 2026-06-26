import { describe, it, expect, vi } from 'vitest';
import { SelectionModel } from '../src/interaction/selectionModel';
import type { SelectionRange } from '../src/types';

const range = (rowStart: number, rowEnd: number, colIds: string[]): SelectionRange => ({
  rowStart, rowEnd, colIds,
});

describe('SelectionModel ranges (Cycle 9 / Task 1)', () => {
  it('starts with an empty ranges list', () => {
    const m = new SelectionModel('multiple');
    expect(m.getRanges()).toEqual([]);
    expect(m.state.ranges).toEqual([]);
  });

  it('setRanges replaces the list and fires onChange once', () => {
    const m = new SelectionModel('multiple');
    const fn = vi.fn();
    m.onChange(fn);
    m.setRanges([range(0, 2, ['a'])]);
    expect(m.getRanges()).toEqual([range(0, 2, ['a'])]);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('setRanges([]) clears existing ranges', () => {
    const m = new SelectionModel('multiple');
    m.addRange(range(0, 0, ['a']));
    const fn = vi.fn();
    m.onChange(fn);
    m.setRanges([]);
    expect(m.getRanges()).toEqual([]);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('addRange appends and fires onChange once', () => {
    const m = new SelectionModel('multiple');
    const fn = vi.fn();
    m.onChange(fn);
    m.addRange(range(0, 0, ['a']));
    m.addRange(range(2, 3, ['b', 'c']));
    expect(m.getRanges()).toEqual([
      range(0, 0, ['a']),
      range(2, 3, ['b', 'c']),
    ]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('extendRange widens the LAST range to cover the new anchor (rowStart..max(rowEnd, rowIndex), union of colIds)', () => {
    const m = new SelectionModel('multiple');
    m.addRange(range(2, 2, ['cusip']));
    const fn = vi.fn();
    m.onChange(fn);
    m.extendRange(5, 'ticker');
    expect(m.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 5, colIds: ['cusip', 'ticker'] },
    ]);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('extendRange leaves rowEnd untouched when rowIndex <= rowEnd and skips colId already present', () => {
    const m = new SelectionModel('multiple');
    m.addRange(range(2, 5, ['cusip', 'ticker']));
    m.extendRange(4, 'cusip');
    expect(m.getRanges()).toEqual([
      { rowStart: 2, rowEnd: 5, colIds: ['cusip', 'ticker'] },
    ]);
  });

  it('extendRange only mutates the LAST range when multiple ranges exist', () => {
    const m = new SelectionModel('multiple');
    m.addRange(range(0, 0, ['a']));
    m.addRange(range(2, 2, ['b']));
    m.extendRange(4, 'c');
    expect(m.getRanges()).toEqual([
      range(0, 0, ['a']),
      { rowStart: 2, rowEnd: 4, colIds: ['b', 'c'] },
    ]);
  });

  it('extendRange is a no-op (no emit) when no ranges exist', () => {
    const m = new SelectionModel('multiple');
    const fn = vi.fn();
    m.onChange(fn);
    m.extendRange(3, 'x');
    expect(m.getRanges()).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clearRanges empties and fires onChange once', () => {
    const m = new SelectionModel('multiple');
    m.addRange(range(0, 0, ['a']));
    m.addRange(range(2, 2, ['b']));
    const fn = vi.fn();
    m.onChange(fn);
    m.clearRanges();
    expect(m.getRanges()).toEqual([]);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('clearRanges is a no-op (no emit) when already empty', () => {
    const m = new SelectionModel('multiple');
    const fn = vi.fn();
    m.onChange(fn);
    m.clearRanges();
    expect(fn).not.toHaveBeenCalled();
  });

  it('getRanges returns a fresh array — mutating it does not affect state', () => {
    const m = new SelectionModel('multiple');
    m.addRange(range(0, 0, ['a']));
    const snapshot = m.getRanges();
    snapshot.push(range(99, 99, ['z']));
    expect(m.getRanges()).toEqual([range(0, 0, ['a'])]);
  });

  it('range mutations are independent of row-selection state', () => {
    const m = new SelectionModel('multiple');
    m.selectSingle(7);
    m.addRange(range(0, 2, ['a']));
    expect(Array.from(m.state.selectedRowIndices)).toEqual([7]);
    expect(m.getRanges()).toEqual([range(0, 2, ['a'])]);
    m.clearRanges();
    expect(Array.from(m.state.selectedRowIndices)).toEqual([7]);
  });

  describe('setFocusAndCollapseRanges (keyboard-nav helper)', () => {
    it('moves focus AND collapses an existing wide range to a 1×1 at the new cell in a single emit', () => {
      const m = new SelectionModel('multiple');
      m.setRanges([range(2, 5, ['cusip', 'ticker', 'price'])]);
      m.setFocus(2, 'cusip');
      const fn = vi.fn();
      m.onChange(fn);
      m.setFocusAndCollapseRanges(7, 'qty');
      expect(m.state.focusedRowIndex).toBe(7);
      expect(m.state.focusedColId).toBe('qty');
      expect(m.getRanges()).toEqual([range(7, 7, ['qty'])]);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('is a no-op (no emit) when focus + ranges are already aligned to the target', () => {
      const m = new SelectionModel('multiple');
      m.setFocus(3, 'b');
      m.setRanges([range(3, 3, ['b'])]);
      const fn = vi.fn();
      m.onChange(fn);
      m.setFocusAndCollapseRanges(3, 'b');
      expect(fn).not.toHaveBeenCalled();
    });

    it('collapses ranges even when only focus is already on the target cell', () => {
      const m = new SelectionModel('multiple');
      m.setFocus(3, 'b');
      m.setRanges([range(0, 5, ['a', 'b', 'c'])]);
      const fn = vi.fn();
      m.onChange(fn);
      m.setFocusAndCollapseRanges(3, 'b');
      expect(m.getRanges()).toEqual([range(3, 3, ['b'])]);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('moves focus and creates a fresh 1×1 range when ranges started empty', () => {
      const m = new SelectionModel('multiple');
      m.setFocusAndCollapseRanges(0, 'a');
      expect(m.state.focusedRowIndex).toBe(0);
      expect(m.state.focusedColId).toBe('a');
      expect(m.getRanges()).toEqual([range(0, 0, ['a'])]);
    });
  });
});
