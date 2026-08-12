import { describe, it, expect } from 'vitest';
import { FilterPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name',  field: 'name',  type: 'text', filter: 'text' },
  { colId: 'price', field: 'price', type: 'number', filter: 'number' },
];

function makeStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', name: 'apple',  price: 10 },
    { id: '2', name: 'banana', price: 20 },
    { id: '3', name: 'cherry', price: 30 },
    { id: '4', name: 'apricot', price: 25 },
  ]);
  return s;
}

describe('FilterPass', () => {
  it('empty model returns all rows in order', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({});
    expect(p.apply()).toEqual(['1', '2', '3', '4']);
  });

  it('text contains', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { type: 'text', op: 'contains', value: 'ap' } });
    expect(p.apply()).toEqual(['1', '4']);
  });

  it('text equals (case-insensitive)', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { type: 'text', op: 'equals', value: 'APPLE' } });
    expect(p.apply()).toEqual(['1']);
  });

  it('text startsWith', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { type: 'text', op: 'startsWith', value: 'ap' } });
    expect(p.apply()).toEqual(['1', '4']);
  });

  it('number gt', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { type: 'number', op: 'gt', value: 20 } });
    expect(p.apply()).toEqual(['3', '4']);
  });

  it('number between', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { type: 'number', op: 'between', value: 15, value2: 28 } });
    expect(p.apply()).toEqual(['2', '4']);
  });

  it('AND across multiple columns', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      name: { type: 'text', op: 'contains', value: 'ap' },
      price: { type: 'number', op: 'lt', value: 20 },
    });
    expect(p.apply()).toEqual(['1']);
  });
});
