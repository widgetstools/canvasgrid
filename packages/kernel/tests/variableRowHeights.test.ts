import { describe, it, expect } from 'vitest';
import { RowStore, ViewportSlicer } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'pri',  field: 'pri',  type: 'number' },
];

function seed(): RowStore {
  const s = new RowStore('id');
  s.setAll([
    { id: 'a', name: 'alpha', pri: 1 },
    { id: 'b', name: 'beta',  pri: 2 },
    { id: 'c', name: 'gamma', pri: 3 },
  ]);
  return s;
}

describe('RowStore — per-row heights', () => {
  it('starts with no per-row heights', () => {
    const s = seed();
    expect(s.getHeight('a')).toBeUndefined();
  });

  it('applyTransaction(update) with heightsByRowId merges in by rowId', () => {
    const s = seed();
    s.apply({ heightsByRowId: new Map<string, number>([['a', 48], ['c', 60]]) });
    expect(s.getHeight('a')).toBe(48);
    expect(s.getHeight('b')).toBeUndefined();
    expect(s.getHeight('c')).toBe(60);
  });

  it('add + heightsByRowId in the same transaction stores both', () => {
    const s = seed();
    s.apply({
      add: [{ id: 'd', name: 'delta', pri: 4 }],
      heightsByRowId: new Map<string, number>([['d', 80]]),
    });
    expect(s.getById('d')).toEqual({ id: 'd', name: 'delta', pri: 4 });
    expect(s.getHeight('d')).toBe(80);
  });

  it('remove also clears the per-row height entry for that rowId', () => {
    const s = seed();
    s.apply({ heightsByRowId: new Map<string, number>([['a', 48]]) });
    s.apply({ remove: ['a'] });
    expect(s.getHeight('a')).toBeUndefined();
  });

  it('setAll wipes prior heights so a full-replace doesn\'t leak ghost heights', () => {
    const s = seed();
    s.apply({ heightsByRowId: new Map<string, number>([['a', 48]]) });
    s.setAll([{ id: 'z', name: 'zeta', pri: 9 }]);
    expect(s.getHeight('a')).toBeUndefined();
  });

  it('setAll accepts an initial heightsByRowId map', () => {
    const s = new RowStore('id');
    s.setAll(
      [{ id: 'a' }, { id: 'b' }],
      new Map<string, number>([['a', 48]]),
    );
    expect(s.getHeight('a')).toBe(48);
    expect(s.getHeight('b')).toBeUndefined();
  });
});

describe('ViewportSlicer — heights Float32Array per chunk', () => {
  it('emits a heights Float32Array sized to the visible row range', () => {
    const s = seed();
    s.apply({ heightsByRowId: new Map<string, number>([['a', 48], ['c', 60]]) });
    const v = new ViewportSlicer(s, cols);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 3, columns: ['name'] });
    expect(chunk.heights).toBeInstanceOf(Float32Array);
    expect(chunk.heights.length).toBe(3);
    // 'b' has no per-row height — slicer leaves it 0 so the main thread
    // can substitute the global rowHeight fallback. 'a' + 'c' carry their
    // resolved heights.
    expect(chunk.heights[0]).toBe(48);
    expect(chunk.heights[1]).toBe(0);
    expect(chunk.heights[2]).toBe(60);
  });

  it('heights are ordered by visible-row index, not insertion order', () => {
    const s = seed();
    s.apply({ heightsByRowId: new Map<string, number>([['a', 48], ['b', 36], ['c', 60]]) });
    const v = new ViewportSlicer(s, cols);
    // Visible order is c, a, b (e.g. after a sort).
    const chunk = v.slice(['c', 'a', 'b'], { rowStart: 0, rowEnd: 3, columns: ['name'] });
    expect(Array.from(chunk.heights)).toEqual([60, 48, 36]);
  });

  it('slicing a sub-range emits the heights for just that range', () => {
    const s = seed();
    s.apply({ heightsByRowId: new Map<string, number>([['a', 10], ['b', 20], ['c', 30]]) });
    const v = new ViewportSlicer(s, cols);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 1, rowEnd: 3, columns: ['name'] });
    expect(chunk.rowCount).toBe(2);
    expect(Array.from(chunk.heights)).toEqual([20, 30]);
  });
});
