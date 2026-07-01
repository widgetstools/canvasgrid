/**
 * Cycle 4 / Task 11 (cell-flash patch) — worker-side diff + flashMask
 * packing tests.
 *
 * `diffRowFields(old, new)` is the building block for the cell-flash
 * pipeline: the worker's `applyTransaction.update` hook calls it
 * before applying, then stuffs the result into `pendingFlashes` so the
 * next `ViewportSlicer.slice` can pack the matching `flashMask` bits.
 */
import { describe, it, expect } from 'vitest';
import { diffRowFields, RowStore, ViewportSlicer } from '../src/worker/dataPipeline';
import type { WorkerColumn, ViewportRequest } from '../src/worker/protocol';

interface Row { id: string; price: number; ticker: string }

describe('diffRowFields', () => {
  it('returns an empty set when both rows are the same reference', () => {
    const row = { id: '1', price: 100, ticker: 'AAPL' };
    expect(diffRowFields(row, row).size).toBe(0);
  });

  it('captures every top-level field that changed', () => {
    const a = { id: '1', price: 100, ticker: 'AAPL' };
    const b = { id: '1', price: 110, ticker: 'AAPL' };
    expect([...diffRowFields(a, b)]).toEqual(['price']);
  });

  it('captures multiple-field updates', () => {
    const a = { id: '1', price: 100, ticker: 'AAPL', name: 'Apple' };
    const b = { id: '1', price: 110, ticker: 'AAPL', name: 'Apple Inc.' };
    expect(new Set(diffRowFields(a, b))).toEqual(new Set(['price', 'name']));
  });

  it('returns an empty set when nothing changed', () => {
    const a = { id: '1', price: 100 };
    const b = { id: '1', price: 100 };
    expect(diffRowFields(a, b).size).toBe(0);
  });

  it('handles null / undefined inputs safely', () => {
    expect(diffRowFields(null, null).size).toBe(0);
    expect(diffRowFields(null, { id: '1' }).size).toBe(0);
    expect(diffRowFields({ id: '1' }, null).size).toBe(0);
  });

  it('flags keys removed in the new row', () => {
    const a = { id: '1', price: 100, oldOnly: 'gone' };
    const b = { id: '1', price: 100 };
    expect([...diffRowFields(a, b)]).toEqual(['oldOnly']);
  });
});

describe('ViewportSlicer flashMask packing', () => {
  function setup(): {
    store: RowStore<Row>;
    cols: WorkerColumn[];
    slicer: ViewportSlicer<Row>;
    req: ViewportRequest;
  } {
    const store = new RowStore<Row>('id');
    store.setAll([
      { id: 'a', price: 100, ticker: 'AAPL' },
      { id: 'b', price: 200, ticker: 'MSFT' },
      { id: 'c', price: 300, ticker: 'GOOG' },
    ]);
    const cols: WorkerColumn[] = [
      { colId: 'price',  field: 'price',  type: 'number' },
      { colId: 'ticker', field: 'ticker', type: 'text' },
    ];
    const slicer = new ViewportSlicer<Row>(store, cols);
    const req: ViewportRequest = {
      rowStart: 0,
      rowEnd: 3,
      columns: ['price', 'ticker'],
      includeFlashMask: true,
    };
    return { store, cols, slicer, req };
  }

  it('omits flashMask when no pendingFlashes are supplied', () => {
    const { slicer, req } = setup();
    const chunk = slicer.slice(['a', 'b', 'c'], req);
    expect(chunk.flashMask).toBeUndefined();
  });

  it('omits flashMask when the pendingFlashes map is empty', () => {
    const { slicer, req } = setup();
    const chunk = slicer.slice(['a', 'b', 'c'], req, new Map());
    expect(chunk.flashMask).toBeUndefined();
  });

  it('omits flashMask when the request opts out via includeFlashMask: false', () => {
    const { slicer, req } = setup();
    const pending = new Map<string, Set<string>>([
      ['a', new Set(['price'])],
    ]);
    const chunk = slicer.slice(['a', 'b', 'c'], { ...req, includeFlashMask: false }, pending);
    expect(chunk.flashMask).toBeUndefined();
  });

  it('packs one bit per (row, col) for cells whose field is in the pending set', () => {
    const { slicer, req } = setup();
    const pending = new Map<string, Set<string>>([
      ['a', new Set(['price'])],   // row 0 → price col → bit 0
      ['b', new Set(['ticker'])],  // row 1 → ticker col → bit 3 (1 * 2 + 1)
      ['c', new Set(['price', 'ticker'])], // row 2 → both → bits 4, 5
    ]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending);
    expect(chunk.flashMask).toBeDefined();
    const m = chunk.flashMask!;
    // Bits 0, 3, 4, 5 set.
    expect(m[0]! & 0b00000001).toBe(0b00000001); // bit 0
    expect(m[0]! & 0b00000010).toBe(0);           // bit 1 NOT set
    expect(m[0]! & 0b00000100).toBe(0);           // bit 2 NOT set
    expect(m[0]! & 0b00001000).toBe(0b00001000); // bit 3
    expect(m[0]! & 0b00010000).toBe(0b00010000); // bit 4
    expect(m[0]! & 0b00100000).toBe(0b00100000); // bit 5
  });

  it('omits bits for rows that have an empty pending set', () => {
    const { slicer, req } = setup();
    const pending = new Map<string, Set<string>>([
      ['a', new Set<string>()], // empty set → no bits
      ['b', new Set(['price'])], // row 1, col 0 → bit 2
    ]);
    const chunk = slicer.slice(['a', 'b', 'c'], req, pending);
    expect(chunk.flashMask).toBeDefined();
    const m = chunk.flashMask!;
    // Only bit 2 set.
    expect(m[0]! & 0b00000001).toBe(0); // bit 0 (a, price) NOT set
    expect(m[0]! & 0b00000010).toBe(0); // bit 1 (a, ticker) NOT set
    expect(m[0]! & 0b00000100).toBe(0b00000100); // bit 2 (b, price) set
    expect(m[0]! & 0b00001000).toBe(0); // bit 3 (b, ticker) NOT set
  });
});
