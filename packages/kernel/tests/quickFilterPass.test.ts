import { describe, it, expect } from 'vitest';
import { QuickFilterPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

interface Row {
  id: string;
  name: string;
  cusip: string;
  price: number;
}

function setup() {
  const store = new RowStore<Row>('id');
  store.setAll([
    { id: '1', name: 'POSITION-A', cusip: 'POS-100', price: 50 },
    { id: '2', name: 'Alpha',      cusip: 'POS-200', price: 75 },
    { id: '3', name: 'Beta',       cusip: 'ABC-300', price: 100 },
    { id: '4', name: 'Gamma',      cusip: 'XYZ-400', price: 25 },
  ]);
  const cols: WorkerColumn[] = [
    { colId: 'name',  field: 'name',  type: 'text' },
    { colId: 'cusip', field: 'cusip', type: 'text' },
    { colId: 'price', field: 'price', type: 'number' },
  ];
  return { store, cols };
}

describe('QuickFilterPass', () => {
  it('returns null when terms is null (caller treats null as pass-through)', () => {
    const { store, cols } = setup();
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setTerms(null);
    expect(qf.apply()).toBeNull();
  });

  it('treats an empty terms array as null (pass-through)', () => {
    const { store, cols } = setup();
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setTerms([]);
    expect(qf.apply()).toBeNull();
  });

  it('single term matches across multiple columns, case-insensitive', () => {
    const { store, cols } = setup();
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setTerms(['pos']);
    const ids = qf.apply();
    expect(ids).not.toBeNull();
    // row 1 matches via name (POSITION-A) AND cusip (POS-100)
    // row 2 matches via cusip (POS-200)
    expect(new Set(ids!)).toEqual(new Set(['1', '2']));
  });

  it('multi-term AND semantics — every term must hit the aggregate', () => {
    const { store, cols } = setup();
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setTerms(['POS', 'Alpha']);
    const ids = qf.apply();
    // Only row 2 has both 'POS' (in cusip) and 'Alpha' (in name)
    expect(ids).toEqual(['2']);
  });

  it('matches against numeric values via String coercion', () => {
    const { store, cols } = setup();
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setTerms(['75']);
    const ids = qf.apply();
    expect(ids).toEqual(['2']);
  });

  it('honors the colIds whitelist when supplied (drops hidden columns)', () => {
    const { store, cols } = setup();
    const qf = new QuickFilterPass<Row>(store, cols);
    // Only 'cusip' contributes to the aggregate — `name` matches for POS
    // should disappear when the column is excluded.
    qf.setColIds(['cusip']);
    qf.setTerms(['POSITION']);
    const ids = qf.apply();
    expect(ids).toEqual([]);
  });

  it('cacheQuickFilter=true reads the aggregate once per row across applies', () => {
    const store = new RowStore<Row>('id');
    let nameReads = 0;
    const row = {
      id: '1',
      cusip: 'POS-100',
      price: 50,
      get name(): string {
        nameReads++;
        return 'Alpha';
      },
    } as unknown as Row;
    store.setAll([row]);
    const cols: WorkerColumn[] = [
      { colId: 'name',  field: 'name',  type: 'text' },
      { colId: 'cusip', field: 'cusip', type: 'text' },
    ];
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setCacheEnabled(true);
    qf.setTerms(['Alpha']);

    qf.apply();
    const afterFirst = nameReads;
    expect(afterFirst).toBeGreaterThan(0);

    // Second + third apply with the same terms should hit the cache and
    // never re-invoke the getter.
    qf.apply();
    qf.apply();
    expect(nameReads).toBe(afterFirst);
  });

  it('cacheQuickFilter=false rebuilds the aggregate on every apply', () => {
    const store = new RowStore<Row>('id');
    let nameReads = 0;
    const row = {
      id: '1',
      cusip: 'POS-100',
      price: 50,
      get name(): string {
        nameReads++;
        return 'Alpha';
      },
    } as unknown as Row;
    store.setAll([row]);
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text' },
    ];
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setCacheEnabled(false);
    qf.setTerms(['Alpha']);

    qf.apply();
    const afterFirst = nameReads;
    qf.apply();
    // Without the cache, every apply walks the columns again — so the
    // getter fires once more per pass.
    expect(nameReads).toBeGreaterThan(afterFirst);
  });

  it('invalidates the cache when the column set changes', () => {
    const store = new RowStore<Row>('id');
    let nameReads = 0;
    const row = {
      id: '1',
      cusip: 'POS-100',
      price: 50,
      get name(): string {
        nameReads++;
        return 'Alpha';
      },
    } as unknown as Row;
    store.setAll([row]);
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text' },
    ];
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setCacheEnabled(true);
    qf.setTerms(['Alpha']);
    qf.apply();
    const afterFirst = nameReads;

    // Same column set, different colIds whitelist counts as a column change.
    qf.setColIds(['name', 'cusip']);
    qf.apply();
    // Cache invalidated → getter fires again.
    expect(nameReads).toBeGreaterThan(afterFirst);
  });

  it('invalidateRows drops cached aggregates for the given rowIds', () => {
    const store = new RowStore<Row>('id');
    let nameReads = 0;
    const row = {
      id: '1',
      cusip: 'POS-100',
      price: 50,
      get name(): string {
        nameReads++;
        return 'Alpha';
      },
    } as unknown as Row;
    store.setAll([row]);
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text' },
    ];
    const qf = new QuickFilterPass<Row>(store, cols);
    qf.setCacheEnabled(true);
    qf.setTerms(['Alpha']);
    qf.apply();
    const afterFirst = nameReads;

    qf.invalidateRows(['1']);
    qf.apply();
    // Invalidated row must be re-read on the next apply.
    expect(nameReads).toBeGreaterThan(afterFirst);
  });
});
