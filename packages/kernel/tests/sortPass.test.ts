import { describe, it, expect } from 'vitest';
import { SortPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'pri',  field: 'pri',  type: 'number' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', name: 'b', pri: 2 },
    { id: '2', name: 'a', pri: 2 },
    { id: '3', name: 'c', pri: 1 },
  ]);
  return s;
}

describe('SortPass', () => {
  it('asc text', () => {
    const p = new SortPass(store(), cols);
    p.setModel([{ colId: 'name', direction: 'asc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['2', '1', '3']);
  });

  it('desc number', () => {
    const p = new SortPass(store(), cols);
    p.setModel([{ colId: 'pri', direction: 'desc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });

  it('multi-sort: primary then secondary', () => {
    const p = new SortPass(store(), cols);
    p.setModel([
      { colId: 'pri',  direction: 'asc' },
      { colId: 'name', direction: 'asc' },
    ]);
    expect(p.apply(['1', '2', '3'])).toEqual(['3', '2', '1']);
  });

  it('empty model returns input unchanged', () => {
    const p = new SortPass(store(), cols);
    p.setModel([]);
    expect(p.apply(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });
});
