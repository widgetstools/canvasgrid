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

  describe('UI-selection ID persistence via resolver (Cycle 21i)', () => {
    // Regression: UI selection (selectSingle/toggleMulti/range) used to clear
    // the id shadow, so the next modelUpdated → rebuildIndices wiped the
    // highlight. Under a live feed (constant modelUpdated) selection flashed
    // then reverted. With a resolver wired, UI selection records ids.
    const idOf = (i: number) => `r${i}`;

    it('selectSingle records the row id and survives rebuildIndices', () => {
      const m = new SelectionModel('multiple');
      m.setRowIdResolver(idOf);
      m.selectSingle(3);
      expect(m.getPersistentSelectedRowIds()).toEqual(['r3']);
      // A modelUpdated where r3 is now at index 7 → highlight follows the id.
      m.rebuildIndices(new Map([['r3', 7]]));
      expect(Array.from(m.state.selectedRowIndices)).toEqual([7]);
    });

    it('without a resolver, selectSingle stays legacy (id shadow empty)', () => {
      const m = new SelectionModel('multiple');
      m.selectSingle(3);
      expect(m.getPersistentSelectedRowIds()).toEqual([]);
    });

    it('toggleMulti keeps the id set in sync with the indices', () => {
      const m = new SelectionModel('multiple');
      m.setRowIdResolver(idOf);
      m.toggleMulti(1);
      m.toggleMulti(2);
      expect(m.getPersistentSelectedRowIds().sort()).toEqual(['r1', 'r2']);
      m.toggleMulti(1); // deselect
      expect(m.getPersistentSelectedRowIds()).toEqual(['r2']);
    });

    it('range records every id in the span', () => {
      const m = new SelectionModel('multiple');
      m.setRowIdResolver(idOf);
      m.range(2, 4);
      expect(m.getPersistentSelectedRowIds().sort()).toEqual(['r2', 'r3', 'r4']);
    });
  });

  describe('ID-keyed persistence (Task 7)', () => {
    it('setSelectedRowIds stores ids + paint indices and fires onChange', () => {
      const m = new SelectionModel('multiple');
      const fn = vi.fn();
      m.onChange(fn);
      m.setSelectedRowIds(['r1', 'r2', 'r3'], [0, 1, 2]);
      expect(m.getPersistentSelectedRowIds()).toEqual(['r1', 'r2', 'r3']);
      expect(Array.from(m.state.selectedRowIndices).sort((a, b) => a - b)).toEqual([0, 1, 2]);
      expect(fn).toHaveBeenCalledOnce();
    });

    it('setSelectedRowIds skips ids with index -1 (filtered/unknown rows) but keeps them in the persistent set', () => {
      const m = new SelectionModel('multiple');
      m.setSelectedRowIds(['present', 'missing'], [4, -1]);
      expect(Array.from(m.state.selectedRowIndices)).toEqual([4]);
      // missing rowId survives — a later modelUpdated may re-resolve it.
      expect(m.getPersistentSelectedRowIds()).toEqual(['present', 'missing']);
    });

    it('setSelectedRowIds is a no-op when mode=none', () => {
      const m = new SelectionModel('none');
      m.setSelectedRowIds(['r1'], [0]);
      expect(m.state.selectedRowIndices.size).toBe(0);
      expect(m.getPersistentSelectedRowIds()).toEqual([]);
    });

    it('setSelectedRowIds with mode=single keeps only the first id', () => {
      const m = new SelectionModel('single');
      m.setSelectedRowIds(['r1', 'r2'], [0, 1]);
      expect(m.getPersistentSelectedRowIds()).toEqual(['r1']);
      expect(Array.from(m.state.selectedRowIndices)).toEqual([0]);
    });

    it('setFocusByRowId stores id + index + colId and fires onChange', () => {
      const m = new SelectionModel('single');
      const fn = vi.fn();
      m.onChange(fn);
      m.setFocusByRowId('r9', 'price', 9);
      expect(m.getPersistentFocusedRowId()).toBe('r9');
      expect(m.state.focusedRowIndex).toBe(9);
      expect(m.state.focusedColId).toBe('price');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('setFocusByRowId with index=-1 keeps the id but clears the paint index', () => {
      const m = new SelectionModel('single');
      m.setFocusByRowId('r9', 'price', -1);
      expect(m.getPersistentFocusedRowId()).toBe('r9');
      expect(m.state.focusedRowIndex).toBeNull();
    });

    it('rebuildIndices re-resolves indices for the persistent id set', () => {
      const m = new SelectionModel('multiple');
      m.setSelectedRowIds(['a', 'b', 'c'], [0, 1, 2]);
      m.setFocusByRowId('b', 'x', 1);
      // Simulate a re-sort: a→2, b→0, c→1
      const fn = vi.fn();
      m.onChange(fn);
      m.rebuildIndices(new Map([['a', 2], ['b', 0], ['c', 1]]));
      expect(Array.from(m.state.selectedRowIndices).sort((a, b) => a - b)).toEqual([0, 1, 2]);
      expect(m.state.focusedRowIndex).toBe(0);
      // Persistent ids are unchanged.
      expect(m.getPersistentSelectedRowIds()).toEqual(['a', 'b', 'c']);
      expect(m.getPersistentFocusedRowId()).toBe('b');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('rebuildIndices drops indices for ids that are now missing (e.g. filtered)', () => {
      const m = new SelectionModel('multiple');
      m.setSelectedRowIds(['a', 'b'], [0, 1]);
      m.rebuildIndices(new Map([['a', 0]])); // b filtered out
      expect(Array.from(m.state.selectedRowIndices)).toEqual([0]);
      // 'b' kept in the persistent set so re-adding it later restores it.
      expect(m.getPersistentSelectedRowIds()).toEqual(['a', 'b']);
    });

    it('rebuildIndices drops the focused index when its id is missing', () => {
      const m = new SelectionModel('single');
      m.setFocusByRowId('a', 'col', 0);
      m.rebuildIndices(new Map()); // a missing
      expect(m.state.focusedRowIndex).toBeNull();
      expect(m.getPersistentFocusedRowId()).toBe('a');
    });

    it('rebuildIndices does not fire onChange when nothing actually changed', () => {
      const m = new SelectionModel('multiple');
      m.setSelectedRowIds(['a'], [0]);
      const fn = vi.fn();
      m.onChange(fn);
      m.rebuildIndices(new Map([['a', 0]]));
      expect(fn).not.toHaveBeenCalled();
    });

    it('rebuildIndices collapses a stale 1×1 range onto the remapped focused cell', () => {
      // Plain click seeds focus + a companion 1×1 range at the same index.
      // After a re-sort the focus follows the rowId but the range would
      // otherwise stay on the previous physical cell — two blue rings.
      const m = new SelectionModel('multiple');
      m.setFocusByRowId('b', 'region', 1);
      m.setRanges([{ rowStart: 1, rowEnd: 1, colIds: ['region'] }]);
      m.rebuildIndices(new Map([['a', 1], ['b', 0], ['c', 2]]));
      expect(m.state.focusedRowIndex).toBe(0);
      expect(m.state.ranges).toEqual([{ rowStart: 0, rowEnd: 0, colIds: ['region'] }]);
    });

    it('rebuildIndices collapses a multi-cell range when the focused index moves', () => {
      const m = new SelectionModel('multiple');
      m.setFocusByRowId('b', 'region', 2);
      m.setRanges([{ rowStart: 1, rowEnd: 4, colIds: ['region', 'desk'] }]);
      m.rebuildIndices(new Map([['b', 5]]));
      expect(m.state.focusedRowIndex).toBe(5);
      expect(m.state.ranges).toEqual([{ rowStart: 5, rowEnd: 5, colIds: ['region'] }]);
    });

    it('rebuildIndices preserves ranges when the focused index does not move', () => {
      const m = new SelectionModel('multiple');
      m.setFocusByRowId('b', 'region', 2);
      m.setRanges([{ rowStart: 1, rowEnd: 4, colIds: ['region', 'desk'] }]);
      m.rebuildIndices(new Map([['b', 2]]));
      expect(m.state.focusedRowIndex).toBe(2);
      expect(m.state.ranges).toEqual([{ rowStart: 1, rowEnd: 4, colIds: ['region', 'desk'] }]);
    });

    it('rebuildIndices clears ranges when the focused row is filtered out', () => {
      const m = new SelectionModel('multiple');
      m.setFocusByRowId('b', 'region', 1);
      m.setRanges([{ rowStart: 1, rowEnd: 1, colIds: ['region'] }]);
      m.rebuildIndices(new Map()); // b missing
      expect(m.state.focusedRowIndex).toBeNull();
      expect(m.state.ranges).toEqual([]);
    });
  });
});
