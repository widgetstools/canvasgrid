/**
 * Cycle 7 / Task 9 — DistinctValuesPass.
 *
 * One-pass hash over `store.rows()` per colId. Cached; `invalidateRows`
 * drops the cache so a transaction landing on the column re-derives.
 */
import { describe, it, expect } from 'vitest';
import { DistinctValuesPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

interface Row { id: string; ticker: string; price: number }

function setup() {
  const store = new RowStore<Row>('id');
  store.setAll([
    { id: '1', ticker: 'AAPL', price: 150 },
    { id: '2', ticker: 'MSFT', price: 200 },
    { id: '3', ticker: 'AAPL', price: 160 },
    { id: '4', ticker: 'GOOG', price: 100 },
    { id: '5', ticker: 'MSFT', price: 210 },
  ]);
  const cols: WorkerColumn[] = [
    { colId: 'ticker', field: 'ticker', type: 'text' },
    { colId: 'price',  field: 'price',  type: 'number' },
  ];
  return { store, cols };
}

describe('DistinctValuesPass', () => {
  it('returns the unique set of column values for a text column', () => {
    const { store, cols } = setup();
    const pass = new DistinctValuesPass<Row>(store, cols);
    const values = pass.getValues('ticker');
    expect(new Set(values)).toEqual(new Set(['AAPL', 'MSFT', 'GOOG']));
    expect(values.length).toBe(3);
  });

  it('coerces numeric values into the distinct string set', () => {
    const { store, cols } = setup();
    const pass = new DistinctValuesPass<Row>(store, cols);
    const values = pass.getValues('price');
    expect(new Set(values)).toEqual(new Set(['150', '200', '160', '100', '210']));
  });

  it('returns an empty array for an unknown colId', () => {
    const { store, cols } = setup();
    const pass = new DistinctValuesPass<Row>(store, cols);
    expect(pass.getValues('missing')).toEqual([]);
  });

  it('caches results per colId — second call does not re-walk the store', () => {
    // Spy on the row getter so we can count store walks.
    const store = new RowStore<Row>('id');
    let getterReads = 0;
    const rows: Row[] = Array.from({ length: 100 }, (_, i) => {
      const base = { id: String(i), price: i } as Row;
      Object.defineProperty(base, 'ticker', {
        get() { getterReads++; return `T${i % 5}`; },
        enumerable: true,
      });
      return base;
    });
    store.setAll(rows);
    const cols: WorkerColumn[] = [
      { colId: 'ticker', field: 'ticker', type: 'text' },
    ];
    const pass = new DistinctValuesPass<Row>(store, cols);
    pass.getValues('ticker');
    const afterFirst = getterReads;
    expect(afterFirst).toBeGreaterThan(0);
    pass.getValues('ticker');
    pass.getValues('ticker');
    // Cached — no further getter calls across subsequent reads.
    expect(getterReads).toBe(afterFirst);
  });

  it('invalidateRows drops the cache and re-derives on the next call', () => {
    const store = new RowStore<Row>('id');
    let getterReads = 0;
    const rows: Row[] = Array.from({ length: 10 }, (_, i) => {
      const base = { id: String(i), price: i } as Row;
      Object.defineProperty(base, 'ticker', {
        get() { getterReads++; return `T${i % 3}`; },
        enumerable: true,
      });
      return base;
    });
    store.setAll(rows);
    const cols: WorkerColumn[] = [
      { colId: 'ticker', field: 'ticker', type: 'text' },
    ];
    const pass = new DistinctValuesPass<Row>(store, cols);
    pass.getValues('ticker');
    const afterFirst = getterReads;
    pass.invalidateRows(['0', '1']);
    pass.getValues('ticker');
    expect(getterReads).toBeGreaterThan(afterFirst);
  });

  it('setColumns swap invalidates the cache so the new field is re-derived', () => {
    const { store, cols } = setup();
    const pass = new DistinctValuesPass<Row>(store, cols);
    pass.getValues('ticker');
    // Replace ticker's field with price — the distinct set must change
    // even though the colId is the same.
    const newCols: WorkerColumn[] = [
      { colId: 'ticker', field: 'price', type: 'number' },
    ];
    pass.setColumns(newCols);
    const values = pass.getValues('ticker');
    expect(new Set(values)).toEqual(new Set(['150', '200', '160', '100', '210']));
  });

  it('null and undefined values are dropped from the distinct set', () => {
    const store = new RowStore<{ id: string; v: string | null }>('id');
    store.setAll([
      { id: '1', v: 'a' },
      { id: '2', v: null },
      { id: '3', v: 'b' },
      { id: '4', v: null },
    ]);
    const cols: WorkerColumn[] = [
      { colId: 'v', field: 'v', type: 'text' },
    ];
    const pass = new DistinctValuesPass(store, cols);
    expect(new Set(pass.getValues('v'))).toEqual(new Set(['a', 'b']));
  });
});
