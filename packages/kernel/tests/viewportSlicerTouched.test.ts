/**
 * Damage-region rendering (Task 3) — worker-side `touchedRows` packing.
 * Fixture setup copied from `tests/viewportSlicer.test.ts`. Covers both
 * slicer entry points that ship a `ViewportChunk`:
 *   - `ViewportSlicer.slice` (dataPipeline.ts) — the flat, ungrouped path.
 *   - `sliceGroupedViewport` (viewportSlicer.ts) — the grouped path, driven
 *     here with a manually-built flat `visibleOrder` (every entry
 *     `kind: 'row'`) so the fixture stays simple while still exercising the
 *     real window-walk code.
 */
import { describe, it, expect } from 'vitest';
import { RowStore, ViewportSlicer } from '../src/worker/dataPipeline';
import { sliceGroupedViewport, type VisibleRowEntry } from '../src/worker/viewportSlicer';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'pri',  field: 'pri',  type: 'number' },
];

function store() {
  const s = new RowStore('id');
  s.setAll([
    { id: 'a', name: 'apple',  pri: 1.5 },
    { id: 'b', name: 'banana', pri: 2.5 },
    { id: 'c', name: 'cherry', pri: 3.5 },
  ]);
  return s;
}

describe('ViewportSlicer.slice touchedRows (flat path)', () => {
  it('reports the window-relative index of a visible touched rowId', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    // Window is rows 0..2 (a, b) — 'a' is visible, 'z' is not (off-window /
    // unknown id entirely).
    const pendingTouched = new Set(['a', 'z']);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] }, undefined, pendingTouched);
    expect(chunk.touchedRows).toBeDefined();
    expect(Array.from(chunk.touchedRows!)).toEqual([0]);
  });

  it('reports an off-window touched rowId as absent from this chunk (no window-relative index)', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    // 'c' is touched but the window only covers rows 0..2 (a, b).
    const pendingTouched = new Set(['c']);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] }, undefined, pendingTouched);
    expect(chunk.touchedRows).toBeUndefined();
  });

  it('touchedRows is undefined when pendingTouched is empty', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 3, columns: ['name'] }, undefined, new Set());
    expect(chunk.touchedRows).toBeUndefined();
  });

  it('touchedRows is undefined when pendingTouched is not supplied', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 3, columns: ['name'] });
    expect(chunk.touchedRows).toBeUndefined();
  });
});

describe('sliceGroupedViewport touchedRows (grouped path, flat visibleOrder)', () => {
  const postFilterIds = ['a', 'b', 'c'];
  const visibleOrder: VisibleRowEntry[] = [
    { kind: 'row', rowIndex: 0, depth: 0 },
    { kind: 'row', rowIndex: 1, depth: 0 },
    { kind: 'row', rowIndex: 2, depth: 0 },
  ];

  function colIndex() {
    const m = new Map<string, WorkerColumn>();
    for (const c of cols) m.set(c.colId, c);
    return m;
  }

  it('reports the window-relative index of a visible touched rowId', () => {
    const s = store();
    const pendingTouched = new Set(['a', 'z']);
    const chunk = sliceGroupedViewport(
      s, colIndex(), postFilterIds, visibleOrder,
      { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] },
      undefined, undefined, undefined, undefined,
      pendingTouched,
    );
    expect(chunk.touchedRows).toBeDefined();
    expect(Array.from(chunk.touchedRows!)).toEqual([0]);
  });

  it('touchedRows is undefined when pendingTouched is empty', () => {
    const s = store();
    const chunk = sliceGroupedViewport(
      s, colIndex(), postFilterIds, visibleOrder,
      { rowStart: 0, rowEnd: 3, columns: ['name'] },
      undefined, undefined, undefined, undefined,
      new Set(),
    );
    expect(chunk.touchedRows).toBeUndefined();
  });

  it('touchedRows is undefined when pendingTouched is not supplied', () => {
    const s = store();
    const chunk = sliceGroupedViewport(
      s, colIndex(), postFilterIds, visibleOrder,
      { rowStart: 0, rowEnd: 3, columns: ['name'] },
    );
    expect(chunk.touchedRows).toBeUndefined();
  });
});
