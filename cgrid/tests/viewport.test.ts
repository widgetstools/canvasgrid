import { describe, it, expect } from 'vitest';
import { computeViewport } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';

function header(height = 32): Subgrid {
  return {
    type: 'header',
    isHeader: true, isData: false, isTotals: false, isFooter: false,
    getRowCount: () => 1,
    getRowHeight: () => height,
    getCell: () => null,
  };
}

function data(rowCount = 1000, rowHeight = 30): Subgrid {
  return {
    type: 'data',
    isHeader: false, isData: true, isTotals: false, isFooter: false,
    getRowCount: () => rowCount,
    getRowHeight: () => rowHeight,
    getCell: () => null,
  };
}

function totals(rowCount = 1, height = 28): Subgrid {
  return {
    type: 'totals',
    isHeader: false, isData: false, isTotals: true, isFooter: false,
    getRowCount: () => rowCount,
    getRowHeight: () => height,
    getCell: () => null,
  };
}

describe('computeViewport', () => {
  it('selects visible data rows given scrollTop + container height', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(1000, 30)],
      containerWidth: 100, containerHeight: 332,
      scrollLeft: 0, scrollTop: 90,
      overscanRows: 0,
    });
    expect(vs.firstRow).toBe(3);
    expect(vs.lastRow).toBe(13);
    // visibleRows = 1 header + 11 data rows.
    const dataRows = vs.visibleRows.filter((r) => r.subgrid.isData);
    expect(dataRows.length).toBe(11);
  });

  it('applies overscan above and below', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      // No header subgrid here so bodyTop is 0 — preserves the pre-subgrid math.
      subgrids: [data(1000, 30)],
      containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 300,
      overscanRows: 2,
    });
    expect(vs.firstRow).toBe(8);
    expect(vs.lastRow).toBe(22);
  });

  it('header subgrid contributes a top row that ignores scrollTop', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(40), data(100, 30)],
      containerWidth: 100, containerHeight: 200,
      scrollLeft: 0, scrollTop: 500, // scroll far down — header still at top
      overscanRows: 0,
    });
    expect(vs.bodyTop).toBe(40);
    const headerRow = vs.visibleRows.find((r) => r.subgrid.isHeader);
    expect(headerRow).toBeDefined();
    expect(headerRow!.top).toBe(0);
    expect(headerRow!.bottom).toBe(40);
    expect(headerRow!.localRowIndex).toBe(0);
  });

  it('every visible row carries a subgrid ref + localRowIndex', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(10, 30)],
      containerWidth: 100, containerHeight: 400,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    for (const row of vs.visibleRows) {
      expect(row.subgrid).toBeDefined();
      expect(typeof row.localRowIndex).toBe('number');
    }
    // Data rows have unique localRowIndex starting at 0.
    const dataRows = vs.visibleRows.filter((r) => r.subgrid.isData);
    expect(dataRows[0]!.localRowIndex).toBe(0);
    expect(dataRows[dataRows.length - 1]!.localRowIndex).toBe(9);
  });

  it('stacks one header row per group-tree depth above the leaf header', () => {
    // 2 header subgrids (a group row + a leaf header row) + 1 data subgrid.
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 50 }],
      subgrids: [header(24), header(24), data(5, 30)],
      containerWidth: 200, containerHeight: 200,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    expect(vs.visibleRows.filter((r) => r.subgrid.isHeader).length).toBe(2);
    expect(vs.bodyTop).toBe(48);
  });

  it('totals subgrid lands after data rows (positional sanity)', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(5, 30), totals(1, 28)],
      containerWidth: 100, containerHeight: 400,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals);
    const lastData = [...vs.visibleRows].filter((r) => r.subgrid.isData).pop();
    expect(totalsRow).toBeDefined();
    expect(lastData).toBeDefined();
    // Totals row comes immediately after the last data row.
    expect(totalsRow!.top).toBeGreaterThanOrEqual(lastData!.bottom - 0.001);
    expect(totalsRow!.height).toBe(28);
  });
});
