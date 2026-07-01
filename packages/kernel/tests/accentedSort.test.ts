import { describe, it, expect } from 'vitest';
import { SortPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

/** Cycle 8 / Task 5 — `accentedSort` routes a text column's
 *  comparisons through `Intl.Collator(undefined, { sensitivity:
 *  'variant' })` so diacritics slot into their natural alphabetic
 *  position instead of trailing the entire ASCII alphabet. */
describe('SortPass — accentedSort', () => {
  const rows = [
    { id: '1', name: 'Em'    },
    { id: '2', name: 'Élise' },
    { id: '3', name: 'Ele'   },
    { id: '4', name: 'Zoe'   },
  ];
  const inputIds = ['1', '2', '3', '4'];

  function makeStore() {
    const s = new RowStore('id');
    s.setAll(rows);
    return s;
  }

  it('default lexicographic sort pushes accented characters to the tail', () => {
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text' },
    ];
    const p = new SortPass(makeStore(), cols);
    p.setModel([{ colId: 'name', direction: 'asc' }]);
    const out = p.apply(inputIds);
    // 'Élise' has codepoint U+00C9 which is > 'Z' (U+005A) in raw
    // lexicographic order, so without accentedSort it lands LAST.
    expect(out).toEqual(['3', '1', '4', '2']);
  });

  it('accentedSort: true slots `Élise` between `Ele` and `Em`', () => {
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', accentedSort: true },
    ];
    const p = new SortPass(makeStore(), cols);
    p.setModel([{ colId: 'name', direction: 'asc' }]);
    const out = p.apply(inputIds);
    // Ele < Élise < Em < Zoe — Intl.Collator treats É as a variant of E
    // and orders by the underlying base letter.
    expect(out).toEqual(['3', '2', '1', '4']);
  });

  it('accentedSort honours descending direction without re-constructing the collator', () => {
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', accentedSort: true },
    ];
    const p = new SortPass(makeStore(), cols);
    p.setModel([{ colId: 'name', direction: 'desc' }]);
    const out = p.apply(inputIds);
    // Reverse of asc: Zoe > Em > Élise > Ele.
    expect(out).toEqual(['4', '1', '2', '3']);
  });

  it('numeric columns ignore accentedSort (no-op)', () => {
    const cols: WorkerColumn[] = [
      { colId: 'pri', field: 'pri', type: 'number', accentedSort: true },
    ];
    const s = new RowStore('id');
    s.setAll([
      { id: '1', pri: 3 },
      { id: '2', pri: 1 },
      { id: '3', pri: 2 },
    ]);
    const p = new SortPass(s, cols);
    p.setModel([{ colId: 'pri', direction: 'asc' }]);
    expect(p.apply(['1', '2', '3'])).toEqual(['2', '3', '1']);
  });

  it('nullish values are stringified before collation (matches default compare semantics)', () => {
    const cols: WorkerColumn[] = [
      { colId: 'name', field: 'name', type: 'text', accentedSort: true },
    ];
    const s = new RowStore('id');
    s.setAll([
      { id: '1', name: 'Ada' },
      { id: '2', name: null },
      { id: '3', name: 'Bea' },
    ]);
    const p = new SortPass(s, cols);
    p.setModel([{ colId: 'name', direction: 'asc' }]);
    // null → '' → sorts first.
    expect(p.apply(['1', '2', '3'])).toEqual(['2', '1', '3']);
  });
});
