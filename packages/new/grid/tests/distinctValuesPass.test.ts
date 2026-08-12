/**
 * Cycle 7 / Task 9 — DistinctValuesPass.
 *
 * One-pass hash over `store.rows()` per colId. Cached; `invalidateRows`
 * drops the cache so a transaction landing on the column re-derives.
 */
import { describe, it, expect } from 'vitest';
import { DistinctValuesPass, RowStore } from '../src/worker/dataPipeline';
import { CalcProgramStore } from '../src/worker/passes/calcPass';
import type { WorkerColumn, WorkerCalcProgram } from '../src/worker/protocol';

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

// ─── Cycle 21d / Task 13 review — calc value source seam ──────────────────
//
// DistinctValuesPass never got Task 11's CalcValueSource seam: a calc
// column is fieldless, so `getValues` hit the `!col.field` early-return
// and always answered `[]`. Mirrors the FilterPass/SortPass/GroupPass/
// ViewportSlicer seam tests in tests/calcPassStageA.test.ts.

/** `double` — row-local numeric calc column: `price * 2`. */
const DOUBLE_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  if (ast.kind === 'field') return row[ast.name] * 2;
  return null;
})`;

function doubleProgram(): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'double',
        ast: { kind: 'field', name: 'price' },
        prePass: [],
        cellDataType: 'number',
        usesPrev: false,
      },
    ],
    interpreterSource: DOUBLE_INTERP,
    aggregateSources: [],
  };
}

const fieldOfPrice = (colId: string): string | undefined => (colId === 'price' ? 'price' : undefined);

interface PriceRow { id: string; price: number }

function priceStore(): RowStore<PriceRow> {
  const store = new RowStore<PriceRow>('id');
  store.setAll([
    { id: '1', price: 100 },
    { id: '2', price: 200 },
    { id: '3', price: 50 },
  ]);
  return store;
}

describe('DistinctValuesPass — calc column seam', () => {
  it('with no calc source installed, a fieldless calc column returns [] (pre-21d behavior preserved)', () => {
    const store = priceStore();
    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const pass = new DistinctValuesPass(store, cols);
    expect(pass.getValues('double')).toEqual([]);
  });

  it('returns the distinct set of a calc column value once a calc source is installed', () => {
    const store = priceStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const pass = new DistinctValuesPass(store, cols);
    pass.setCalcSource(calc);
    const values = pass.getValues('double');
    // price 100/200/50 → double 200/400/100.
    expect(new Set(values)).toEqual(new Set(['200', '400', '100']));
  });

  it('respects limit-agnostic full derivation — a data column alongside a calc column both resolve', () => {
    const store = priceStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [
      { colId: 'price', field: 'price', type: 'number' },
      { colId: 'double', type: 'number' },
    ];
    const pass = new DistinctValuesPass(store, cols);
    pass.setCalcSource(calc);
    expect(new Set(pass.getValues('price'))).toEqual(new Set(['100', '200', '50']));
    expect(new Set(pass.getValues('double'))).toEqual(new Set(['200', '400', '100']));
  });

  it('cache invalidation after a transaction changes a calc input re-derives the distinct set', () => {
    const store = priceStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const pass = new DistinctValuesPass(store, cols);
    pass.setCalcSource(calc);
    expect(new Set(pass.getValues('double'))).toEqual(new Set(['200', '400', '100']));

    // Mutate row 3's price via a transaction (mirrors the worker's
    // flush handler: apply → calc.onTransaction → calc.ensureStageA →
    // distinct.invalidateRows(touched)).
    const result = store.apply({ update: [{ id: '3', price: 300 }] });
    calc.onTransaction(result);
    calc.ensureStageA(store, fieldOfPrice);
    pass.invalidateRows(result.update.map((u) => u.rowId));

    const values = pass.getValues('double');
    expect(new Set(values)).toEqual(new Set(['200', '400', '600']));
    expect(values).not.toContain('100');
  });
});
