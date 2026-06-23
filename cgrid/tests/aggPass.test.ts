import { describe, it, expect } from 'vitest';
import { AggPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'x', field: 'x', type: 'number', aggFunc: 'sum' },
  { colId: 'y', field: 'y', type: 'number', aggFunc: 'avg' },
  { colId: 'z', field: 'z', type: 'number', aggFunc: 'min' },
  { colId: 'q', field: 'q', type: 'number', aggFunc: 'max' },
  { colId: 'c', field: 'c', type: 'text',   aggFunc: 'count' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', x: 10, y: 2, z: 5, q: 7, c: 'a' },
    { id: '2', x: 20, y: 4, z: 1, q: 9, c: 'b' },
    { id: '3', x: 30, y: 6, z: 3, q: 8, c: 'c' },
  ]);
  return s;
}

describe('AggPass', () => {
  it('grand-total computes per aggFunc', () => {
    const p = new AggPass(store(), cols);
    const { totals } = p.apply(['1', '2', '3']);
    expect(totals.x).toBe(60);
    expect(totals.y).toBe(4);
    expect(totals.z).toBe(1);
    expect(totals.q).toBe(9);
    expect(totals.c).toBe(3);
  });

  it('empty input → null totals (avg/min/max) or 0 (sum/count)', () => {
    const p = new AggPass(store(), cols);
    const { totals } = p.apply([]);
    expect(totals.x).toBe(0);
    expect(totals.c).toBe(0);
    expect(totals.y).toBeNull();
  });
});
