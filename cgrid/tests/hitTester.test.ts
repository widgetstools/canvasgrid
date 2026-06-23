import { describe, it, expect } from 'vitest';
import { HitTester } from '../src/interaction/hitTester';
import type { ViewportState } from '../src/core/viewport';

const vs: ViewportState = {
  visibleColumns: [
    { colId: 'a', index: 0, left: 0,   right: 100, width: 100 },
    { colId: 'b', index: 1, left: 100, right: 250, width: 150 },
  ],
  visibleRows: [
    { rowIndex: 0, top: 32, bottom: 62, height: 30 },
    { rowIndex: 1, top: 62, bottom: 92, height: 30 },
  ],
  firstRow: 0, lastRow: 1,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 250, bodyTop: 32, bodyBottom: 332,
  bodyWidth: 250, bodyHeight: 300,
};

describe('HitTester', () => {
  it('header click', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    expect(ht.locate(50, 16).kind).toBe('header');
  });

  it('header resizer hot zone on right edge', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    const h = ht.locate(99, 16);
    expect(h.kind).toBe('headerResizer');
  });

  it('cell hit', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    const h = ht.locate(120, 75) as any;
    expect(h.kind).toBe('cell');
    expect(h.colId).toBe('b');
    expect(h.rowIndex).toBe(1);
  });

  it('empty region returns empty', () => {
    const ht = new HitTester(() => vs, () => 32, () => 4);
    expect(ht.locate(500, 500).kind).toBe('empty');
  });
});
