import type { ColumnLayout } from './layout';
import type { Subgrid } from './subgrid';

export interface ViewportColumn {
  colId: string;
  index: number;
  left: number;
  right: number;
  width: number;
  pinned?: 'left' | 'right';
}

export interface ViewportRow {
  /** Position of this row within the visibleRows array. */
  rowIndex: number;
  /** Subgrid that owns this row. */
  subgrid: Subgrid;
  /** Index within the owning subgrid's data (data row index for DataSubgrid, 0 for HeaderSubgrid). */
  localRowIndex: number;
  top: number;
  bottom: number;
  height: number;
}

export interface ViewportState {
  visibleColumns: ViewportColumn[];
  visibleRows: ViewportRow[];
  /** First/last visible *data* row index (in the DataSubgrid's local index space).
   * `lastRow = -1` when no data rows are visible. Used by the worker viewport fetch. */
  firstRow: number;
  lastRow: number;
  scrollLeft: number;
  scrollTop: number;
  bodyLeft: number;
  bodyRight: number;
  /** Top of the scrollable data region — sum of header subgrid heights. */
  bodyTop: number;
  /** Bottom of the scrollable data region — derived from container height. */
  bodyBottom: number;
  bodyWidth: number;
  bodyHeight: number;
  /** Total content extent of the scrollable BODY region (center columns + all data rows). */
  contentWidth: number;
  contentHeight: number;
  /** Maximum valid scrollLeft / scrollTop. ≤0 means body has no overflow. */
  maxScrollLeft: number;
  maxScrollTop: number;
}

export interface ViewportInput {
  columnLayout: ColumnLayout[];
  /** Subgrid stack, top→bottom. Header subgrids must come first; a single
   * DataSubgrid is required for the scrollable data area. */
  subgrids: Subgrid[];
  containerWidth: number;
  containerHeight: number;
  scrollLeft: number;
  scrollTop: number;
  overscanRows?: number;
}

export function computeViewport(opts: ViewportInput): ViewportState {
  const overscan = opts.overscanRows ?? 3;

  // ---------------------------------------------------------------------------
  // Row visibility — walk the subgrid stack.
  //
  // Header subgrids contribute every row at the top (no scroll). Data subgrids
  // respect scrollTop and overscan. Other subgrids (totals/footer) render all
  // rows immediately after the previous subgrid's bottom — Task-3 placement is
  // structural; visual positioning of totals/footer is refined in a later task.
  // ---------------------------------------------------------------------------
  const visibleRows: ViewportRow[] = [];
  let bodyTop = 0;
  let firstDataRow = 0;
  let lastDataRow = -1;
  let dataContentHeight = 0;

  // Pass 1: header subgrids — accumulate their height into bodyTop.
  for (const subgrid of opts.subgrids) {
    if (!subgrid.isHeader) continue;
    const rows = subgrid.getRowCount();
    for (let local = 0; local < rows; local++) {
      const h = subgrid.getRowHeight(local);
      visibleRows.push({
        rowIndex: visibleRows.length,
        subgrid,
        localRowIndex: local,
        top: bodyTop,
        bottom: bodyTop + h,
        height: h,
      });
      bodyTop += h;
    }
  }

  const bodyBottom = opts.containerHeight;
  const bodyHeight = Math.max(0, bodyBottom - bodyTop);

  // Pass 2: data subgrid(s). Only the data area scrolls.
  let yAfterData = bodyTop;
  for (const subgrid of opts.subgrids) {
    if (!subgrid.isData) continue;
    const rowH = subgrid.getRowHeight(0); // assume uniform — refined when variable-height lands
    if (rowH <= 0) continue;
    const totalRows = subgrid.getRowCount();
    dataContentHeight += totalRows * rowH;

    const firstRowRaw = Math.floor(opts.scrollTop / rowH);
    const lastRowRaw = Math.floor((opts.scrollTop + bodyHeight) / rowH);
    firstDataRow = Math.max(0, firstRowRaw - overscan);
    lastDataRow = Math.min(totalRows - 1, lastRowRaw + overscan);

    for (let local = firstDataRow; local <= lastDataRow; local++) {
      const top = bodyTop + local * rowH - opts.scrollTop;
      visibleRows.push({
        rowIndex: visibleRows.length,
        subgrid,
        localRowIndex: local,
        top,
        bottom: top + rowH,
        height: rowH,
      });
    }
    // Advance yAfterData so trailing subgrids (totals/footer) land below.
    yAfterData = Math.max(yAfterData, bodyTop + (lastDataRow + 1) * rowH - opts.scrollTop);
  }

  // Pass 3: totals/footer subgrids — stacked after the visible data rows.
  let y = yAfterData;
  for (const subgrid of opts.subgrids) {
    if (subgrid.isHeader || subgrid.isData) continue;
    const rows = subgrid.getRowCount();
    for (let local = 0; local < rows; local++) {
      const h = subgrid.getRowHeight(local);
      visibleRows.push({
        rowIndex: visibleRows.length,
        subgrid,
        localRowIndex: local,
        top: y,
        bottom: y + h,
        height: h,
      });
      y += h;
    }
  }

  // ---------------------------------------------------------------------------
  // Column visibility (unchanged from pre-subgrid implementation).
  // ---------------------------------------------------------------------------
  const leftPinned = opts.columnLayout.filter((c) => c.pinned === 'left');
  const center = opts.columnLayout.filter((c) => !c.pinned);
  const rightPinned = opts.columnLayout.filter((c) => c.pinned === 'right');

  const pinnedLeftWidth = leftPinned.reduce((s, c) => s + c.width, 0);
  const pinnedRightWidth = rightPinned.reduce((s, c) => s + c.width, 0);
  const bodyLeft = pinnedLeftWidth;
  const bodyRight = opts.containerWidth - pinnedRightWidth;
  const bodyWidth = bodyRight - bodyLeft;

  const visibleColumns: ViewportColumn[] = [];
  let idx = 0;

  // Pinned-left columns — always visible at their layout x.
  for (const c of leftPinned) {
    visibleColumns.push({
      colId: c.colId,
      index: idx++,
      left: c.left,
      right: c.left + c.width,
      width: c.width,
      pinned: 'left',
    });
  }

  // Center (scrollable) columns — shifted by scrollLeft, clipped to body region.
  const centerBaseLeft = bodyLeft;
  const centerContentLeft = pinnedLeftWidth;
  for (const c of center) {
    const cellLeft = centerBaseLeft + (c.left - centerContentLeft) - opts.scrollLeft;
    const cellRight = cellLeft + c.width;
    if (cellRight <= bodyLeft || cellLeft >= bodyRight) continue;
    visibleColumns.push({
      colId: c.colId,
      index: idx++,
      left: cellLeft,
      right: cellRight,
      width: c.width,
    });
  }

  // Pinned-right columns — anchored to right edge.
  const centerTotalWidth = center.reduce((s, c) => s + c.width, 0);
  for (const c of rightPinned) {
    const fromRightEdge = c.left - (pinnedLeftWidth + centerTotalWidth);
    const cellLeft = bodyRight + fromRightEdge;
    visibleColumns.push({
      colId: c.colId,
      index: idx++,
      left: cellLeft,
      right: cellLeft + c.width,
      width: c.width,
      pinned: 'right',
    });
  }

  const contentWidth = centerTotalWidth;
  const contentHeight = dataContentHeight;
  const maxScrollLeft = Math.max(0, contentWidth - bodyWidth);
  const maxScrollTop = Math.max(0, contentHeight - bodyHeight);

  return {
    visibleColumns,
    visibleRows,
    firstRow: firstDataRow,
    lastRow: lastDataRow,
    scrollLeft: opts.scrollLeft,
    scrollTop: opts.scrollTop,
    bodyLeft,
    bodyRight,
    bodyTop,
    bodyBottom,
    bodyWidth,
    bodyHeight,
    contentWidth,
    contentHeight,
    maxScrollLeft,
    maxScrollTop,
  };
}
