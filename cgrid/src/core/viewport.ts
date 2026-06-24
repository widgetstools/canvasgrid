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
  /** Legacy overscan field — still respected, but `rowBuffer` wins when both
   *  are supplied. Defaults to 3 when neither is set. */
  overscanRows?: number;
  /** Public ag-grid-parity name for the row overscan. Takes precedence over
   *  `overscanRows` so the runtime `setGridOption('rowBuffer', N)` path is
   *  honoured regardless of the legacy field. */
  rowBuffer?: number;
  /** When true, every center column lands in `visibleColumns` regardless of
   *  scrollLeft. Pinned columns are unaffected (they're always visible). */
  suppressColumnVirtualisation?: boolean;
  /** When true, every data row is materialised regardless of scrollTop. */
  suppressRowVirtualisation?: boolean;
}

export function computeViewport(opts: ViewportInput): ViewportState {
  const overscan = opts.rowBuffer ?? opts.overscanRows ?? 3;
  const suppressRows = opts.suppressRowVirtualisation === true;
  const suppressCols = opts.suppressColumnVirtualisation === true;

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

  // Pass 2: data subgrid(s). Only the data area scrolls. Per-row heights —
  // each data subgrid exposes `getRowHeight(local)` (Cycle 5 / Task 6). The
  // first-visible-row search still uses a uniform-height approximation
  // (`subgrid.getRowHeight(0)` as the fallback) — Task 7's Fenwick tree
  // replaces that scan with O(log n) cumulative lookups. Within the visible
  // range we walk per-row so variable-height rows position correctly relative
  // to one another (no overlap, no gap).
  let yAfterData = bodyTop;
  for (const subgrid of opts.subgrids) {
    if (!subgrid.isData) continue;
    const fallbackH = subgrid.getRowHeight(0);
    if (fallbackH <= 0) continue;
    const totalRows = subgrid.getRowCount();
    // dataContentHeight uses the fallback uniformly — Task 7's Fenwick gives
    // the exact total height in O(log n). Until then, scrollbar thumb extent
    // is approximate when many rows deviate from the fallback.
    dataContentHeight += totalRows * fallbackH;

    if (suppressRows) {
      firstDataRow = 0;
      lastDataRow = totalRows - 1;
    } else {
      const firstRowRaw = Math.floor(opts.scrollTop / fallbackH);
      const lastRowRaw = Math.floor((opts.scrollTop + bodyHeight) / fallbackH);
      firstDataRow = Math.max(0, firstRowRaw - overscan);
      lastDataRow = Math.min(totalRows - 1, lastRowRaw + overscan);
    }

    // Accumulate the top of `firstDataRow` by walking pre-window rows once.
    // O(firstDataRow) — acceptable for Task 6; Task 7 swaps this for O(log n).
    let top = bodyTop - opts.scrollTop;
    for (let pre = 0; pre < firstDataRow; pre++) top += subgrid.getRowHeight(pre);
    for (let local = firstDataRow; local <= lastDataRow; local++) {
      const h = subgrid.getRowHeight(local);
      visibleRows.push({
        rowIndex: visibleRows.length,
        subgrid,
        localRowIndex: local,
        top,
        bottom: top + h,
        height: h,
      });
      top += h;
    }
    // Advance yAfterData so trailing subgrids (totals/footer) land below the
    // last visible data row — `top` is now exactly that bottom edge.
    yAfterData = Math.max(yAfterData, top);
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
  // When `suppressColumnVirtualisation` is on, every center column ships through
  // unchanged so apps that need stable column instances (screenshot suites,
  // CSV-style export) don't see culling.
  const centerBaseLeft = bodyLeft;
  const centerContentLeft = pinnedLeftWidth;
  for (const c of center) {
    const cellLeft = centerBaseLeft + (c.left - centerContentLeft) - opts.scrollLeft;
    const cellRight = cellLeft + c.width;
    if (!suppressCols && (cellRight <= bodyLeft || cellLeft >= bodyRight)) continue;
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
