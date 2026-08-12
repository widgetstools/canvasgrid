/**
 * Cycle 21e / Task 11 — `ViewportChunk.stringRowIds` plumbing.
 *
 * The paint path previously had no string rowId (only the hashed
 * numeric `rowIds`), so the rule-engine fold and Task 13's flash
 * overrides had no way to key into `rowDataById` from a chunk slot.
 * `stringRowIds` rides the structured-clone path in parallel with
 * `rowIds`, populated at the two `store.getNumericId` slice sites
 * (flat + grouped) with the string id that was already in hand.
 */
import { describe, it, expect } from 'vitest';
import { RowStore, ViewportSlicer, GroupPass } from '../src/worker/dataPipeline';
import {
  computeGroupVisibleOrder,
  sliceGroupedViewport,
} from '../src/worker/viewportSlicer';
import { normalizeViewportChunk } from '../src/worker/protocol';
import type { WorkerColumn, ViewportRequest, ViewportChunk } from '../src/worker/protocol';

interface Row { id: string; price: number; desk: string }

const cols: WorkerColumn[] = [
  { colId: 'price', field: 'price', type: 'number' },
  { colId: 'desk',  field: 'desk',  type: 'text' },
];

function fixtureStore(): RowStore<Row> {
  const store = new RowStore<Row>('id');
  store.setAll([
    { id: 'a', price: 100, desk: 'APAC' },
    { id: 'b', price: 200, desk: 'APAC' },
    { id: 'c', price: 300, desk: 'EMEA' },
  ]);
  return store;
}

describe('flat ViewportSlicer.slice — stringRowIds', () => {
  it('carries stringRowIds parallel to rowIds with the app getRowId values', () => {
    const store = fixtureStore();
    const slicer = new ViewportSlicer<Row>(store, cols);
    const req: ViewportRequest = { rowStart: 0, rowEnd: 3, columns: ['price', 'desk'] };
    const chunk = slicer.slice(['a', 'b', 'c'], req);
    expect(chunk.stringRowIds).toEqual(['a', 'b', 'c']);
    // Parallel to rowIds — round-trips through the store's numeric map.
    expect(chunk.rowIds.length).toBe(chunk.stringRowIds!.length);
    for (let i = 0; i < chunk.rowIds.length; i++) {
      expect(store.getStringId(chunk.rowIds[i]!)).toBe(chunk.stringRowIds![i]);
    }
  });

  it('windows correctly — stringRowIds reflects the sliced sub-range', () => {
    const store = fixtureStore();
    const slicer = new ViewportSlicer<Row>(store, cols);
    const req: ViewportRequest = { rowStart: 1, rowEnd: 3, columns: ['price'] };
    const chunk = slicer.slice(['a', 'b', 'c'], req);
    expect(chunk.stringRowIds).toEqual(['b', 'c']);
  });
});

describe('sliceGroupedViewport — stringRowIds', () => {
  it('group rows carry the empty-string sentinel; data rows carry the real id', () => {
    const store = fixtureStore();
    const p = new GroupPass(store, cols);
    p.setModel({ rowGroupCols: ['desk'] });
    const ids = ['a', 'b', 'c'];
    const out = p.apply(ids);
    const colIndex = new Map<string, WorkerColumn>();
    for (const c of cols) colIndex.set(c.colId, c);
    const order = computeGroupVisibleOrder(out.flatOrder, new Set(['desk:APAC', 'desk:EMEA']));
    // Visible order: [APAC, a, b, EMEA, c] — 5 entries.
    expect(order.length).toBe(5);
    const chunk = sliceGroupedViewport(
      store,
      colIndex,
      ids,
      order,
      { rowStart: 0, rowEnd: 5, columns: ['price'] },
    );
    expect(chunk.stringRowIds).toEqual(['', 'a', 'b', '', 'c']);
  });
});

describe('normalizeViewportChunk — stringRowIds v1→v2 upgrade', () => {
  function fastPathChunk(rowCount: number): ViewportChunk {
    return {
      rowStart: 0,
      rowCount,
      rowIds: new Uint32Array(rowCount),
      stringRowIds: new Array<string>(rowCount).fill('x'),
      rowKinds: new Uint8Array(rowCount),
      groupDepth: new Uint8Array(rowCount),
      numericCols: {},
      textCols: {},
      groupValue: new Array<string>(rowCount).fill(''),
      groupChildCount: new Uint32Array(rowCount),
      isExpanded: new Uint8Array(rowCount).fill(1),
      groupKey: new Array<string>(rowCount).fill(''),
    };
  }

  it('fills Array(rowCount).fill(\'\') when stringRowIds is absent', () => {
    const chunk = fastPathChunk(3);
    delete (chunk as any).stringRowIds;
    const normalized = normalizeViewportChunk(chunk);
    expect(normalized.stringRowIds).toEqual(['', '', '']);
  });

  it('returns the same object reference when every field (incl. stringRowIds) is present', () => {
    const chunk = fastPathChunk(2);
    const normalized = normalizeViewportChunk(chunk);
    expect(normalized).toBe(chunk);
  });
});
