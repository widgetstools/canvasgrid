// Cycle 20 / Task 6 — `domLayout: 'print'` virtualization override.
//
// `domLayout: 'print'` is a paper-friendly flag: it suppresses both
// row + column virtualization so `window.print()` captures the
// entire grid (not just the visible viewport). The flag composes
// with `suppressRowVirtualisation` / `suppressColumnVirtualisation`
// — either path setting them is sufficient.
//
// Runtime-mutable: flip to `'print'`, call window.print(), flip back
// to `'normal'`.

import { describe, it, expect } from 'vitest';
import { computeViewport } from '../src/core/viewport';
import { DataSubgrid } from '../src/core/subgrid';

function fakeSubgrids(rowCount: number, rowHeight = 24) {
  return [
    new DataSubgrid(
      () => rowCount,
      () => rowHeight,
      () => ({ value: null, valueFormatted: '' }),
    ),
  ];
}

describe('computeViewport — virtualization suppression', () => {
  it('without suppress flags, only the visible window is materialised', () => {
    const vp = computeViewport({
      subgrids: fakeSubgrids(1000),
      containerHeight: 240, // 10 visible rows of 24px
      containerWidth: 400,
      columnLayout: [],
      scrollTop: 0,
      scrollLeft: 0,
      rowBuffer: 3,
    });
    // 10 visible + 3 overscan = ~13 rows, well below 1000.
    expect(vp.visibleRows.length).toBeLessThan(50);
  });

  it('suppressRowVirtualisation: true → every data row materialises', () => {
    const vp = computeViewport({
      subgrids: fakeSubgrids(1000),
      containerHeight: 240,
      containerWidth: 400,
      columnLayout: [],
      scrollTop: 0,
      scrollLeft: 0,
      rowBuffer: 3,
      suppressRowVirtualisation: true,
    });
    // All 1000 rows are in the visibleRows list when virtualization is off.
    expect(vp.visibleRows.length).toBe(1000);
  });
});
