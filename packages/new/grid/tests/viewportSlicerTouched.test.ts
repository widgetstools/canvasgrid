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

  it('reports an EMPTY (but defined) touchedRows when the touched rowId is off-window — distinct from the true "unknown" case', () => {
    const s = store();
    const v = new ViewportSlicer(s, cols);
    // 'c' is touched but the window only covers rows 0..2 (a, b). A
    // transaction landed (pendingTouched is non-empty) and we DID check
    // this window — we just found nothing in it, which is a meaningfully
    // different signal from "no diff info at all" (`undefined`, covered by
    // the two tests below). Conflating the two used to force a full
    // repaint on every chunk arrival whose transaction happened not to
    // touch the visible window — the common case for a sparse live feed
    // ticking a small fraction of a large row set per batch.
    const pendingTouched = new Set(['c']);
    const chunk = v.slice(['a', 'b', 'c'], { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] }, undefined, pendingTouched);
    expect(chunk.touchedRows).toBeDefined();
    expect(Array.from(chunk.touchedRows!)).toEqual([]);
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

  it('reports an EMPTY (but defined) touchedRows when the touched rowId is off-window', () => {
    const s = store();
    // 'c' is touched but the window only covers rows 0..2 (a, b) — same
    // distinction as the flat-path test above.
    const pendingTouched = new Set(['c']);
    const chunk = sliceGroupedViewport(
      s, colIndex(), postFilterIds, visibleOrder,
      { rowStart: 0, rowEnd: 2, columns: ['name', 'pri'] },
      undefined, undefined, undefined, undefined,
      pendingTouched,
    );
    expect(chunk.touchedRows).toBeDefined();
    expect(Array.from(chunk.touchedRows!)).toEqual([]);
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
