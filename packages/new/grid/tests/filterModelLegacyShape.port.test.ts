/**
 * PORT-NOTE: NOT a copied legacy test — added by the worker port for
 * required refactor #1 (SPEC collapse target #5).
 *
 * The legacy worker ran two matchers side by side: `matches()` for the
 * `{ type, op, value }` entry shape and `matchesV2()` for the ag-grid
 * `filterType` union, chosen per row per entry. The port collapses them into
 * one matcher by normalizing a legacy entry into its v2 equivalent
 * (`resolveFilterEntry`) before matching.
 *
 * The copied parity tests barely exercise the legacy shape — exactly one
 * assertion in `workerClient.test.ts` (text `contains`) — so the collapse
 * would otherwise be nearly unguarded. These tests pin the legacy shape's
 * observable behaviour operator by operator, including the three quirks
 * normalization has to reproduce rather than "fix":
 *
 *   1. a legacy entry ignores the column's `textFormatter`
 *   2. legacy text is always case-insensitive (no `caseSensitive` opt-in)
 *   3. an unknown operator matches nothing, and does NOT fall through to
 *      blank/notBlank behaviour
 *
 * Expected values below were read off the legacy implementation
 * (`packages/kernel/src/worker/dataPipeline.ts::matches`), not off the new
 * one — including its coercion edges (`Number(null) === 0`).
 */
import { describe, it, expect } from 'vitest';
import { FilterPass, RowStore, resolveFilterEntry } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';
import type { FilterModel } from '../src/types';

interface Row { id: string; name: string; qty: number | null | string }

const ROWS: Row[] = [
  { id: '1', name: 'POS-100', qty: 10 },
  { id: '2', name: 'pos-200', qty: 20 },
  { id: '3', name: 'XYZ-300', qty: 30 },
];

const COLS: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'qty', field: 'qty', type: 'number' },
];

function run(rows: Row[], model: FilterModel, cols: WorkerColumn[] = COLS): string[] {
  const store = new RowStore<Row>('id');
  store.setAll(rows);
  const pass = new FilterPass<Row>(store, cols);
  pass.setModel(model);
  return pass.apply().sort();
}

describe('legacy filter shape — text operators', () => {
  it('contains', () => {
    expect(run(ROWS, { name: { type: 'text', op: 'contains', value: 'pos' } }))
      .toEqual(['1', '2']);
  });

  it('equals', () => {
    expect(run(ROWS, { name: { type: 'text', op: 'equals', value: 'pos-200' } }))
      .toEqual(['2']);
  });

  it('startsWith', () => {
    expect(run(ROWS, { name: { type: 'text', op: 'startsWith', value: 'xyz' } }))
      .toEqual(['3']);
  });

  it('is case-insensitive on both sides, always', () => {
    // Legacy lowercased haystack and needle unconditionally; there is no
    // legacy way to ask for a case-sensitive compare.
    expect(run(ROWS, { name: { type: 'text', op: 'contains', value: 'POS' } }))
      .toEqual(['1', '2']);
  });

  it('coerces a null cell value to the empty string', () => {
    const rows = [{ id: '1', name: null as unknown as string, qty: 1 }];
    expect(run(rows, { name: { type: 'text', op: 'equals', value: '' } })).toEqual(['1']);
    expect(run(rows, { name: { type: 'text', op: 'contains', value: 'a' } })).toEqual([]);
  });

  it('ignores the column textFormatter (legacy predates it)', () => {
    // The v2 shape WOULD trim both sides here (see
    // filterPass.text.params.test.ts); the legacy shape must not, or an old
    // model silently changes meaning on a formatted column.
    const rows = [{ id: '1', name: '  hello  ', qty: 1 }];
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', textFormatter: 'trim' },
    ];
    expect(run(rows, { name: { type: 'text', op: 'equals', value: 'hello' } }, cols))
      .toEqual([]);
    expect(run(rows, { name: { type: 'text', op: 'equals', value: '  hello  ' } }, cols))
      .toEqual(['1']);
  });

  it('an unrecognised text operator matches nothing', () => {
    expect(run(ROWS, {
      name: { type: 'text', op: 'endsWith' as 'contains', value: '100' },
    })).toEqual([]);
  });
});

describe('legacy filter shape — number operators', () => {
  it('eq / gt / lt', () => {
    expect(run(ROWS, { qty: { type: 'number', op: 'eq', value: 20 } })).toEqual(['2']);
    expect(run(ROWS, { qty: { type: 'number', op: 'gt', value: 20 } })).toEqual(['3']);
    expect(run(ROWS, { qty: { type: 'number', op: 'lt', value: 20 } })).toEqual(['1']);
  });

  it('between is inclusive of both bounds', () => {
    expect(run(ROWS, { qty: { type: 'number', op: 'between', value: 10, value2: 20 } }))
      .toEqual(['1', '2']);
  });

  it('between with no value2 degenerates to equality', () => {
    // Legacy: `n >= value && n <= (value2 ?? value)`.
    expect(run(ROWS, { qty: { type: 'number', op: 'between', value: 20 } })).toEqual(['2']);
  });

  it('coerces string cell values, rejects non-numeric ones', () => {
    const rows: Row[] = [
      { id: '1', name: 'a', qty: '20' },
      { id: '2', name: 'b', qty: 'not a number' },
    ];
    expect(run(rows, { qty: { type: 'number', op: 'eq', value: 20 } })).toEqual(['1']);
  });

  it('a null cell value coerces to 0 (Number(null)), not to "no match"', () => {
    // An edge worth pinning precisely because it looks like a bug: legacy ran
    // `Number(raw)` with no null guard, so a null cell equals 0 and is < 1.
    const rows: Row[] = [{ id: '1', name: 'a', qty: null }];
    expect(run(rows, { qty: { type: 'number', op: 'eq', value: 0 } })).toEqual(['1']);
    expect(run(rows, { qty: { type: 'number', op: 'lt', value: 1 } })).toEqual(['1']);
    expect(run(rows, { qty: { type: 'number', op: 'gt', value: 0 } })).toEqual([]);
  });

  it('an unrecognised numeric operator matches nothing', () => {
    expect(run(ROWS, {
      qty: { type: 'number', op: 'gte' as 'gt', value: 10 },
    })).toEqual([]);
  });

  it('an unrecognised entry type is treated as numeric (legacy fall-through)', () => {
    // Legacy's `matches` branched on `type === 'text'` and sent EVERYTHING
    // else down the numeric path.
    expect(run(ROWS, {
      qty: { type: 'currency' as 'number', op: 'gt', value: 20 },
    })).toEqual(['3']);
  });
});

describe('resolveFilterEntry — normalization shape', () => {
  const col: WorkerColumn = {
    colId: 'name', field: 'name', type: 'text', textFormatter: 'trim',
  };

  it('passes a v2 entry through untouched, WITH its column', () => {
    const entry = { filterType: 'text', type: 'contains', filter: 'x' } as const;
    const resolved = resolveFilterEntry(entry, col);
    expect(resolved.model).toBe(entry);
    expect(resolved.column).toBe(col);
  });

  it('rewrites a legacy text entry and withholds the column', () => {
    const resolved = resolveFilterEntry({ type: 'text', op: 'contains', value: 'x' }, col);
    expect(resolved.model).toEqual({ filterType: 'text', type: 'contains', filter: 'x' });
    // No `caseSensitive` key: unset means "lowercase both sides".
    expect('caseSensitive' in resolved.model).toBe(false);
    expect(resolved.column).toBeUndefined();
  });

  it('rewrites legacy numeric operators onto their v2 names', () => {
    expect(resolveFilterEntry({ type: 'number', op: 'eq', value: 1 }, undefined).model)
      .toEqual({ filterType: 'number', type: 'equals', filter: 1, filterTo: 1 });
    expect(resolveFilterEntry({ type: 'number', op: 'gt', value: 1 }, undefined).model)
      .toEqual({ filterType: 'number', type: 'greaterThan', filter: 1, filterTo: 1 });
    expect(resolveFilterEntry({ type: 'number', op: 'lt', value: 1 }, undefined).model)
      .toEqual({ filterType: 'number', type: 'lessThan', filter: 1, filterTo: 1 });
    expect(resolveFilterEntry(
      { type: 'number', op: 'between', value: 1, value2: 5 }, undefined,
    ).model).toEqual({ filterType: 'number', type: 'inRange', filter: 1, filterTo: 5 });
  });

  it('normalizes an unknown operator to a never-matching numeric entry, NOT to blank', () => {
    // A `blank` stand-in would have matched every empty cell instead of
    // nothing — the reason the sentinel is an `equals` with no `filter`.
    const model = resolveFilterEntry(
      { type: 'number', op: 'nope' as 'gt', value: 1 }, undefined,
    ).model;
    expect(model.filterType).toBe('number');
    expect(model).toEqual({ filterType: 'number', type: 'equals' });
  });
});
