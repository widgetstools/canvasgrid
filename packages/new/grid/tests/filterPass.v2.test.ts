import { describe, it, expect } from 'vitest';
import { FilterPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

interface Row {
  id: string;
  name: string;
  price: number;
  asOf: string; // ISO date
}

const cols: WorkerColumn[] = [
  { colId: 'name',  field: 'name',  type: 'text',   filter: 'text' },
  { colId: 'price', field: 'price', type: 'number', filter: 'number' },
  { colId: 'asOf',  field: 'asOf',  type: 'text',   filter: 'text' },
];

function makeStore(): RowStore<Row> {
  const s = new RowStore<Row>('id');
  s.setAll([
    { id: '1', name: 'apple',  price: 10,  asOf: '2026-01-01' },
    { id: '2', name: 'banana', price: 20,  asOf: '2026-02-15' },
    { id: '3', name: 'cherry', price: 30,  asOf: '2026-03-20' },
    { id: '4', name: 'apricot', price: 25, asOf: '2026-04-05' },
    { id: '5', name: 'orange', price: 100, asOf: '2026-06-30' },
  ]);
  return s;
}

describe('FilterPass — v2 text entries', () => {
  it('contains', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { filterType: 'text', type: 'contains', filter: 'ap' } });
    expect(p.apply().sort()).toEqual(['1', '4']);
  });

  it('equals (case-insensitive)', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { filterType: 'text', type: 'equals', filter: 'APPLE' } });
    expect(p.apply()).toEqual(['1']);
  });

  it('endsWith', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ name: { filterType: 'text', type: 'endsWith', filter: 'ot' } });
    expect(p.apply()).toEqual(['4']);
  });
});

describe('FilterPass — v2 number entries', () => {
  it('equals', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { filterType: 'number', type: 'equals', filter: 20 } });
    expect(p.apply()).toEqual(['2']);
  });

  it('greaterThan', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { filterType: 'number', type: 'greaterThan', filter: 25 } });
    expect(p.apply().sort()).toEqual(['3', '5']);
  });

  it('greaterThanOrEqual', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { filterType: 'number', type: 'greaterThanOrEqual', filter: 25 } });
    expect(p.apply().sort()).toEqual(['3', '4', '5']);
  });

  it('lessThanOrEqual', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { filterType: 'number', type: 'lessThanOrEqual', filter: 20 } });
    expect(p.apply().sort()).toEqual(['1', '2']);
  });

  it('notEqual', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { filterType: 'number', type: 'notEqual', filter: 100 } });
    expect(p.apply().sort()).toEqual(['1', '2', '3', '4']);
  });

  it('inRange', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ price: { filterType: 'number', type: 'inRange', filter: 20, filterTo: 30 } });
    expect(p.apply().sort()).toEqual(['2', '3', '4']);
  });
});

describe('FilterPass — v2 date entries', () => {
  it('equals', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ asOf: { filterType: 'date', type: 'equals', filter: '2026-02-15' } });
    expect(p.apply()).toEqual(['2']);
  });

  it('greaterThan', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ asOf: { filterType: 'date', type: 'greaterThan', filter: '2026-03-01' } });
    expect(p.apply().sort()).toEqual(['3', '4', '5']);
  });

  it('inRange', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({ asOf: { filterType: 'date', type: 'inRange', filter: '2026-02-01', filterTo: '2026-04-30' } });
    expect(p.apply().sort()).toEqual(['2', '3', '4']);
  });
});

describe('FilterPass — v2 multi-condition entries', () => {
  it('OR of three equals (CSV-style)', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      price: {
        filterType: 'multi', operator: 'OR',
        conditions: [
          { filterType: 'number', type: 'equals', filter: 10 },
          { filterType: 'number', type: 'equals', filter: 25 },
          { filterType: 'number', type: 'equals', filter: 100 },
        ],
      },
    });
    expect(p.apply().sort()).toEqual(['1', '4', '5']);
  });

  it('AND of two comparisons (>100 AND <500 → inRange equivalent)', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      price: {
        filterType: 'multi', operator: 'AND',
        conditions: [
          { filterType: 'number', type: 'greaterThan', filter: 15 },
          { filterType: 'number', type: 'lessThan', filter: 28 },
        ],
      },
    });
    expect(p.apply().sort()).toEqual(['2', '4']);
  });

  it('text OR of contains (CSV-style)', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      name: {
        filterType: 'multi', operator: 'OR',
        conditions: [
          { filterType: 'text', type: 'contains', filter: 'app' },
          { filterType: 'text', type: 'contains', filter: 'orange' },
        ],
      },
    });
    expect(p.apply().sort()).toEqual(['1', '5']);
  });

  it('nested AND inside OR (a AND b) OR c', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      price: {
        filterType: 'multi', operator: 'OR',
        conditions: [
          {
            filterType: 'multi', operator: 'AND',
            conditions: [
              { filterType: 'number', type: 'greaterThan', filter: 15 },
              { filterType: 'number', type: 'lessThan', filter: 22 },
            ],
          } as any,
          { filterType: 'number', type: 'equals', filter: 100 },
        ],
      },
    });
    expect(p.apply().sort()).toEqual(['2', '5']);
  });
});

describe('FilterPass — legacy + v2 mix on different columns', () => {
  it('legacy text contains + v2 number greaterThan compose with AND', () => {
    const p = new FilterPass(makeStore(), cols);
    p.setModel({
      name:  { type: 'text', op: 'contains', value: 'ap' },
      price: { filterType: 'number', type: 'greaterThan', filter: 15 },
    });
    expect(p.apply()).toEqual(['4']);
  });
});
