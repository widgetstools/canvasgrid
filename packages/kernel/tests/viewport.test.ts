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

/**
 * Data subgrid backed by a per-row height map keyed by `localRowIndex`.
 * Rows missing from the map fall back to `fallback` (mirrors how the real
 * DataSubgrid's per-row callback substitutes the grid-level rowHeight when
 * the current chunk has no entry for a row).
 */
function variableData(
  rowCount: number,
  fallback: number,
  perRow: Record<number, number>,
): Subgrid {
  return {
    type: 'data',
    isHeader: false, isData: true, isTotals: false, isFooter: false,
    getRowCount: () => rowCount,
    getRowHeight: (local: number) => perRow[local] ?? fallback,
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

  it('rowBuffer of 10 expands overscan above and below the visible window', () => {
    const baseline = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [data(1000, 30)],
      containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 300,
      overscanRows: 0,
    });
    const baselineData = baseline.visibleRows.filter((r) => r.subgrid.isData).length;

    const buffered = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [data(1000, 30)],
      containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 300,
      rowBuffer: 10,
    });
    const bufferedData = buffered.visibleRows.filter((r) => r.subgrid.isData).length;
    // Plenty of headroom both sides at scrollTop=300, so we add 2*N rows.
    expect(bufferedData).toBe(baselineData + 20);
  });

  it('rowBuffer takes precedence over overscanRows when both are supplied', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [data(1000, 30)],
      containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 300,
      overscanRows: 2,
      rowBuffer: 5,
    });
    expect(vs.firstRow).toBe(10 - 5);
    expect(vs.lastRow).toBe(20 + 5);
  });

  it('suppressRowVirtualisation paints every data row regardless of scrollTop', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(250, 30)],
      containerWidth: 100, containerHeight: 200,
      scrollLeft: 0, scrollTop: 900,
      suppressRowVirtualisation: true,
    });
    const dataRows = vs.visibleRows.filter((r) => r.subgrid.isData);
    expect(dataRows.length).toBe(250);
    expect(vs.firstRow).toBe(0);
    expect(vs.lastRow).toBe(249);
  });

  it('suppressColumnVirtualisation keeps every column in visibleColumns at any scrollLeft', () => {
    const cols = Array.from({ length: 20 }, (_, i) => ({
      colId: `c${i}`,
      left: i * 100,
      width: 100,
    }));
    const vs = computeViewport({
      columnLayout: cols,
      subgrids: [header(32), data(100, 30)],
      containerWidth: 300, containerHeight: 400,
      scrollLeft: 800, scrollTop: 0,
      suppressColumnVirtualisation: true,
    });
    expect(vs.visibleColumns.length).toBe(cols.length);
    // Order preserved.
    expect(vs.visibleColumns.map((c) => c.colId)).toEqual(cols.map((c) => c.colId));
  });

  it('per-row data heights — accumulator threads each row\'s height into top', () => {
    // 10 data rows; rows 2 and 5 are 60 px tall, the rest 30 px.
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [variableData(10, 30, { 2: 60, 5: 60 })],
      containerWidth: 100, containerHeight: 1000,
      scrollLeft: 0, scrollTop: 0,
      suppressRowVirtualisation: true,
    });
    const dataRows = vs.visibleRows.filter((r) => r.subgrid.isData);
    expect(dataRows.length).toBe(10);
    // Expected tops (no header, bodyTop=0): 0, 30, 60, 120, 150, 180, 240, 270, 300, 330.
    expect(dataRows.map((r) => r.top)).toEqual([0, 30, 60, 120, 150, 180, 240, 270, 300, 330]);
    // Rows 2 and 5 are 60 tall; the rest are 30.
    expect(dataRows[2]!.height).toBe(60);
    expect(dataRows[5]!.height).toBe(60);
    expect(dataRows[0]!.height).toBe(30);
    expect(dataRows[9]!.height).toBe(30);
    // Bottom of each row equals next row's top (no gaps).
    for (let i = 0; i < dataRows.length - 1; i++) {
      expect(dataRows[i]!.bottom).toBe(dataRows[i + 1]!.top);
    }
  });

  it('per-row data heights — accumulates pre-firstDataRow heights when scrolled', () => {
    // Row 1 is 90 px; row 0 + others are 30 px.
    // scrollTop=120 with fallback=30 → firstRowRaw=4. With per-row, the
    // top of row 4 in canvas space is bodyTop - scrollTop + (30+90+30+30) = -120 + 180 = 60.
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [variableData(20, 30, { 1: 90 })],
      containerWidth: 100, containerHeight: 300,
      scrollLeft: 0, scrollTop: 120,
      overscanRows: 0,
    });
    const firstVisible = vs.visibleRows.find((r) => r.subgrid.isData && r.localRowIndex === 4);
    // Without per-row math: top would be bodyTop + 4*30 - 120 = 0. With the
    // accumulator-aware refactor, the +60 from row 1's extra height shifts
    // row 4's top down to 60.
    expect(firstVisible).toBeDefined();
    expect(firstVisible!.top).toBe(60);
  });

  it('totals / pinned-bottom dock to the container bottom', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(5, 30), totals(1, 28)],
      containerWidth: 100, containerHeight: 400,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals);
    expect(totalsRow).toBeDefined();
    // Docked to the viewport bottom — not stacked after the last data row
    // (which would sit mid-canvas when the book does not fill the body).
    expect(totalsRow!.bottom).toBe(400);
    expect(totalsRow!.top).toBe(372);
    expect(vs.bodyBottom).toBe(372);
    expect(vs.bodyHeight).toBe(340);
  });

  it('large books keep pinned-bottom on-canvas despite data overscan', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(10_000, 32), totals(1, 32)],
      containerWidth: 100, containerHeight: 400,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 5,
    });
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals);
    expect(totalsRow).toBeDefined();
    expect(totalsRow!.top).toBeGreaterThanOrEqual(0);
    expect(totalsRow!.bottom).toBeLessThanOrEqual(400);
    expect(totalsRow!.bottom).toBe(400);
    // Scrollable body ends above the footer.
    expect(vs.bodyBottom).toBe(368);
  });
});
