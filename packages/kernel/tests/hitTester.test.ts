import { describe, it, expect } from 'vitest';
import { HitTester } from '../src/interaction/hitTester';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 100, getRowHeight: () => 30, getCell: () => null,
};

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [
    { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 332,
  bodyWidth: 250, bodyHeight: 300,
  contentWidth: 250, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 0,
};

// Layout with a right-pinned column at [200, 300]; center column at [0, 200].
// bodyRight = 200 marks where the center band ends and the pinned-right zone
// begins; the zone-aware hit-tester uses this boundary to route hits.
const vsWithRightPin: ViewportState = {
  visibleColumns: [
    { colId: 'center', index: 0, left: 0,   right: 200, width: 200 },
    { colId: 'pinned', index: 1, left: 200, right: 300, width: 100, pinned: 'right' },
  ],
  visibleRows: [
    { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 200, bodyTop: 32, bodyBottom: 332,
  bodyWidth: 200, bodyHeight: 300,
  contentWidth: 200, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 0,
};

describe('HitTester', () => {
  it('header click', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4, () => 10);
    expect(ht.locate(50, 16).kind).toBe('header');
  });

  it('header resizer hot zone on right edge', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4, () => 10);
    const h = ht.locate(99, 16);
    expect(h.kind).toBe('headerResizer');
    if (h.kind === 'headerResizer') expect(h.edge).toBe('right');
  });

  it('right-pinned column: left edge is also a resizer with edge="left"', () => {
    const ht = new HitTester(() => vsWithRightPin, () => 32, () => 4, () => 10);
    // x=201 is just past the left edge (200) of the right-pinned column —
    // still inside the 4 px hot zone [200, 204).
    const h = ht.locate(201, 16);
    expect(h.kind).toBe('headerResizer');
    if (h.kind === 'headerResizer') {
      expect(h.colId).toBe('pinned');
      expect(h.edge).toBe('left');
    }
  });

  it('non-pinned column: left edge does NOT trigger a resizer (only the right edge does)', () => {
    const ht = new HitTester(() => vsWithRightPin, () => 32, () => 4, () => 10);
    // x=2 is inside the center column's left hot zone, but the center column
    // is NOT pinned-right, so no resizer fires here — it's a header click.
    const h = ht.locate(2, 16);
    expect(h.kind).toBe('header');
  });

  it('right-pinned column: right edge still resizes (consistent with left-pinned)', () => {
    const ht = new HitTester(() => vsWithRightPin, () => 32, () => 4, () => 10);
    const h = ht.locate(299, 16);
    expect(h.kind).toBe('headerResizer');
    if (h.kind === 'headerResizer') {
      expect(h.colId).toBe('pinned');
      expect(h.edge).toBe('right');
    }
  });

  it('cell hit', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4, () => 10);
    const h = ht.locate(120, 75) as any;
    expect(h.kind).toBe('cell');
    expect(h.colId).toBe('b');
    expect(h.rowIndex).toBe(1);
  });

  it('empty region returns empty', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4, () => 10);
    expect(ht.locate(500, 500).kind).toBe('empty');
  });
});
