import type { ColumnLayout } from './layout';

export interface ViewportColumn {
  colId: string;
  index: number;
  left: number;
  right: number;
  width: number;
  pinned?: 'left' | 'right';
}

export interface ViewportRow {
  rowIndex: number;
  top: number;
  bottom: number;
  height: number;
}

export interface ViewportState {
  visibleColumns: ViewportColumn[];
  visibleRows: ViewportRow[];
  firstRow: number;
  lastRow: number;
  scrollLeft: number;
  scrollTop: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  bodyWidth: number;
  bodyHeight: number;
  /** Total content extent of the scrollable BODY region (center columns + all rows). */
  contentWidth: number;
  contentHeight: number;
  /** Maximum valid scrollLeft / scrollTop. ≤0 means body has no overflow. */
  maxScrollLeft: number;
  maxScrollTop: number;
}

export interface ViewportInput {
  columnLayout: ColumnLayout[];
  rowCount: number;
  rowHeight: number;
  headerHeight: number;
  containerWidth: number;
  containerHeight: number;
  scrollLeft: number;
  scrollTop: number;
  overscanRows?: number;
}

export function computeViewport(opts: ViewportInput): ViewportState {
  const overscan = opts.overscanRows ?? 3;
  const bodyTop = opts.headerHeight;
  const bodyBottom = opts.containerHeight;
  const bodyHeight = bodyBottom - bodyTop;

  // Row visibility math.
  const firstRowRaw = Math.floor(opts.scrollTop / opts.rowHeight);
  const lastRowRaw = Math.floor((opts.scrollTop + bodyHeight) / opts.rowHeight);
  const firstRow = Math.max(0, firstRowRaw - overscan);
  const lastRow = Math.min(opts.rowCount - 1, lastRowRaw + overscan);

  const visibleRows: ViewportRow[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const top = bodyTop + r * opts.rowHeight - opts.scrollTop;
    visibleRows.push({
      rowIndex: r,
      top,
      bottom: top + opts.rowHeight,
      height: opts.rowHeight,
    });
  }

  // Column visibility math.
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
  const centerContentLeft = pinnedLeftWidth; // where center cols start in content space
  for (const c of center) {
    const cellLeft = centerBaseLeft + (c.left - centerContentLeft) - opts.scrollLeft;
    const cellRight = cellLeft + c.width;
    // Skip columns fully outside the body viewport.
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
    // c.left is relative to the overall layout (after leftPinned + center).
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
  const contentHeight = opts.rowCount * opts.rowHeight;
  const maxScrollLeft = Math.max(0, contentWidth - bodyWidth);
  const maxScrollTop = Math.max(0, contentHeight - bodyHeight);

  return {
    visibleColumns,
    visibleRows,
    firstRow,
    lastRow,
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
