import { describe, it, expect } from 'vitest';
import { RowStore, ViewportSlicer } from '../src/worker/dataPipeline';
import { decodeText } from '../src/worker/chunkFormat';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'pri',  field: 'pri',  type: 'number' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: 'a', name: 'apple',  pri: 1.5 },
    { id: 'b', name: 'banana', pri: 2.5 },
    { id: 'c', name: 'cherry', pri: 3.5 },
  ]);
  return s;
}

describe('ViewportSlicer', () => {
  it('returns the requested row range as packed arrays', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] });
    expect(chunk.rowCount).toBe(2);
    expect(chunk.rowIds.length).toBe(2);
    // numeric ID for 'a' must round-trip
    expect(s.getStringId(chunk.rowIds[0]!)).toBe('a');
    expect(s.getStringId(chunk.rowIds[1]!)).toBe('b');
    expect(Array.from(chunk.numericCols.pri!)).toEqual([1.5, 2.5]);
    expect(decodeText(chunk.textCols.name!.offsets, chunk.textCols.name!.bytes)).toEqual(['apple', 'banana']);
  });

  it('handles end past visibleIds length', () => {
    const v = new ViewportSlicer(store(), cols);
    const chunk = v.slice(['a', 'b'], { rowStart: 1, rowEnd: 10, columns: ['name'] });
    expect(chunk.rowCount).toBe(1);
  });
});
