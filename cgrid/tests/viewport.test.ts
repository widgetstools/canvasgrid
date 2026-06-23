import { describe, it, expect } from 'vitest';
import { computeViewport } from '../src/core/viewport';

describe('computeViewport', () => {
  it('selects visible rows given scrollTop + container height', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      rowCount: 1000, rowHeight: 30,
      headerHeight: 32, containerWidth: 100, containerHeight: 332,
      scrollLeft: 0, scrollTop: 90,
      overscanRows: 0,
    });
    expect(vs.firstRow).toBe(3);
    expect(vs.lastRow).toBe(13);
  });

  it('applies overscan above and below', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      rowCount: 1000, rowHeight: 30,
      headerHeight: 0, containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 300,
      overscanRows: 2,
    });
    expect(vs.firstRow).toBe(8);
    expect(vs.lastRow).toBe(22);
  });
});
