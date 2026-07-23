import type { ColumnLayout } from './layout';
import type { Subgrid } from './subgrid';
import type { RowHeightIndex } from './rowHeightIndex';

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
   * `lastRow = -1` when no data rows are visible. Used by the worker viewport fetch.
   * Both are widened by `overscan` — use `firstVisibleDataRow` for the true
   * on-screen boundary (e.g. the sticky-ancestor decision). */
  firstRow: number;
  lastRow: number;
  /** Task 5 (paint-cache layer) fix — the UNPADDED first visible data row,
   *  i.e. `firstRow` before `overscan` widens it downward. Threaded to the
   *  worker as `stickyBoundaryRow` so the sticky-ancestor band tracks the
   *  real on-screen scroll position rather than the (now overscan-widened)
   *  fetch window. Optional so pre-existing hand-built `ViewportState` test
   *  fixtures (which never exercised this field) keep compiling; every
   *  real `computeViewport()` result always sets it. Consumers fall back
   *  to `firstRow` when absent. */
  firstVisibleDataRow?: number;
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
  /** Top edge (CSS px from the container's top) of the floating-filter
   *  row, when present. `undefined` when no `FloatingFilterSubgrid` is
   *  in the subgrid stack. `FloatingFilterOverlay.repositionAll` reads
   *  this to position the pooled `<input>` elements via `transform`.
   *  Cycle 7 / Task 1. */
  floatingFilterRowTop?: number;
  /** Pixel height of the floating-filter row, when present. `undefined`
   *  when no `FloatingFilterSubgrid` is in the stack. Cycle 7 / Task 1. */
  floatingFilterRowHeight?: number;
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
  /** Cumulative-height index for the data subgrid (Cycle 5 / Task 7). When
   *  supplied AND its length matches the data subgrid's row count, the
   *  first-visible-row search descends through the index in O(log n) and
   *  `dataContentHeight` reads `index.totalHeight()` exactly. When omitted
   *  the viewport falls back to the uniform-height approximation built from
   *  `subgrid.getRowHeight(0)`. */
  dataRowHeightIndex?: RowHeightIndex;
}

export function computeViewport(opts: ViewportInput): ViewportState {
  const overscan = opts.rowBuffer ?? opts.overscanRows ?? 3;
  const suppressRows = opts.suppressRowVirtualisation === true;
  const suppressCols = opts.suppressColumnVirtualisation === true;

  // ---------------------------------------------------------------------------
  // Row visibility — walk the subgrid stack.
  //
  // Header subgrids contribute every row at the top (no scroll). Data subgrids
  // respect scrollTop and overscan. Post-data subgrids (pinned-bottom /
  // totals-bottom) dock to the container bottom and reserve body height.
  // ---------------------------------------------------------------------------
  const visibleRows: ViewportRow[] = [];
  let bodyTop = 0;
  let firstDataRow = 0;
  let lastDataRow = -1;
  // Task 5 (paint-cache layer) fix — the UNPADDED first visible data row
  // (before `overscan` widens `firstDataRow` downward). Task 3 widened the
  // row overscan so the worker fetch window covers the retained layer's
  // coverage (spec §1's fetch-window coupling) — but the worker's sticky-
  // ancestor computation (`computeStickyAncestors`) was keyed off the
  // FETCHED window's `rowStart`, using it as a proxy for "the first row
  // rendered on screen". Widening overscan legitimately grows the gap
  // between "first fetched row" and "first VISIBLE row", so a scroll depth
  // smaller than the (now larger) overscan buffer left `rowStart` at 0
  // even though the user had genuinely scrolled a group's header off
  // screen — the sticky band silently stopped appearing. Exposing the
  // true unpadded boundary here lets `ViewportManager`/`WorkerCoordinator`
  // thread it to the worker as `stickyBoundaryRow`, decoupling the visual
  // sticky-pin decision from the fetch-window's overscan padding entirely.
  let firstVisibleDataRow = 0;
  let dataContentHeight = 0;
  let floatingFilterRowTop: number | undefined;
  let floatingFilterRowHeight: number | undefined;

  // Classify each subgrid by its position relative to the data subgrid
  // in stack order. Subgrids appearing BEFORE the first data subgrid pin
  // at the top (contributing to bodyTop); the data subgrid scrolls; any
  // subgrid AFTER the data subgrid docks to the BOTTOM of the container
  // (pinned-bottom / totals-bottom) and reserves height from the
  // scrollable body so overscan data rows cannot push them off-canvas.
  const dataIndex = opts.subgrids.findIndex((sg) => sg.isData);
  const preDataSubgrids = dataIndex < 0
    ? opts.subgrids
    : opts.subgrids.slice(0, dataIndex);
  const postDataSubgrids = dataIndex < 0
    ? []
    : opts.subgrids.slice(dataIndex + 1);

  // Pass 1: every subgrid that sits BEFORE the data subgrid pins above
  // the scrollable data region. Headers and the floating-filter row
  // (Cycle 7 / Task 1) ride here by default. A top-pinned totals
  // (Cycle 14 / Task 1) does too when its subgrid is stacked before
  // the data subgrid in `cgrid.ts`.
  for (const subgrid of preDataSubgrids) {
    const rows = subgrid.getRowCount();
    for (let local = 0; local < rows; local++) {
      const h = subgrid.getRowHeight(local);
      if (subgrid.isFloatingFilter) {
        floatingFilterRowTop = bodyTop;
        floatingFilterRowHeight = h;
      }
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

  // Reserve footer / pinned-bottom height before sizing the scrollable body.
  // Without this, Pass-3 used to stack post-data rows after overscanned
  // data (often below `containerHeight`), so grand-total / pinned-bottom
  // rows updated in options but never painted on screen.
  let postDataHeight = 0;
  for (const subgrid of postDataSubgrids) {
    const rows = subgrid.getRowCount();
    for (let local = 0; local < rows; local++) {
      postDataHeight += subgrid.getRowHeight(local);
    }
  }

  const containerBottom = opts.containerHeight;
  const bodyBottom = Math.max(bodyTop, containerBottom - postDataHeight);
  const bodyHeight = Math.max(0, bodyBottom - bodyTop);

  // Pass 2: data subgrid(s). Only the data area scrolls. Per-row heights —
  // each data subgrid exposes `getRowHeight(local)` (Cycle 5 / Task 6). When
  // a `dataRowHeightIndex` is supplied (Cycle 5 / Task 7) the first/last
  // visible-row search descends the Fenwick tree in O(log n) and the
  // pre-window top is read as a single `index.topOf(firstDataRow)` query.
  // Without the index we fall back to the uniform-height approximation
  // (`subgrid.getRowHeight(0)` as the fallback row size). Within the visible
  // range we still walk per-row so variable-height rows position correctly
  // relative to one another (no overlap, no gap).
  for (const subgrid of opts.subgrids) {
    if (!subgrid.isData) continue;
    const totalRows = subgrid.getRowCount();
    // Use the index only when it covers the same row population the data
    // subgrid reports. A length mismatch means a sort/filter just landed
    // and the index hasn't been rebuilt yet — fall back to uniform math
    // until the next `requestViewport()` completes.
    const idx = opts.dataRowHeightIndex && opts.dataRowHeightIndex.length() === totalRows
      ? opts.dataRowHeightIndex : undefined;
    const fallbackH = subgrid.getRowHeight(0);
    // Skip only when there is BOTH no usable per-row index AND no
    // sensible fallback row height. Pivot mode reports
    // `getRowHeight(0) === 0` for rows outside the loaded chunk
    // window — without this guard, scrolling mid-load skips the data
    // subgrid entirely, collapses `dataContentHeight` to 0, sets
    // `maxScrollTop = 0`, the sizer shrinks to 1px, and the browser
    // resets `scrollTop` to 0. The Fenwick index already carries
    // valid heights (its constructor seeds every row with the
    // grid-level fallback); use it.
    if (!idx && fallbackH <= 0) continue;

    if (idx) {
      dataContentHeight += idx.totalHeight();
    } else {
      // No index — scrollbar thumb extent is approximate when many rows
      // deviate from `fallbackH`. Acceptable for the first frame after a
      // sort/filter; the next chunk-arrival rebuilds the index.
      dataContentHeight += totalRows * fallbackH;
    }

    if (suppressRows) {
      firstDataRow = 0;
      lastDataRow = totalRows - 1;
      firstVisibleDataRow = idx ? idx.rowAt(opts.scrollTop) : Math.floor(opts.scrollTop / fallbackH);
    } else if (idx) {
      const firstRowRaw = idx.rowAt(opts.scrollTop);
      const lastRowRaw = idx.rowAt(opts.scrollTop + bodyHeight);
      firstDataRow = Math.max(0, firstRowRaw - overscan);
      lastDataRow = Math.min(totalRows - 1, lastRowRaw + overscan);
      firstVisibleDataRow = Math.max(0, firstRowRaw);
    } else {
      const firstRowRaw = Math.floor(opts.scrollTop / fallbackH);
      const lastRowRaw = Math.floor((opts.scrollTop + bodyHeight) / fallbackH);
      firstDataRow = Math.max(0, firstRowRaw - overscan);
      lastDataRow = Math.min(totalRows - 1, lastRowRaw + overscan);
      firstVisibleDataRow = Math.max(0, firstRowRaw);
    }

    // Pre-window top: one Fenwick query when the index is present, else a
    // linear accumulator walk over the pre-firstDataRow heights. The linear
    // walk is O(firstDataRow) — fine for the indexless fallback because that
    // path only fires the first frame after a sort/filter.
    let top: number;
    if (idx) {
      top = bodyTop + idx.topOf(firstDataRow) - opts.scrollTop;
    } else {
      top = bodyTop - opts.scrollTop;
      for (let pre = 0; pre < firstDataRow; pre++) top += subgrid.getRowHeight(pre);
    }
    for (let local = firstDataRow; local <= lastDataRow; local++) {
      // Per-row height: subgrid first, but fall back to the index
      // when the subgrid returns 0 (pivot mode outside-chunk
      // sentinel). The index already carries the grid-level fallback
      // for every row, so this keeps visible-row positioning sane
      // mid-scroll while the new chunk is in flight.
      let h = subgrid.getRowHeight(local);
      if (h <= 0 && idx) h = idx.heightAt(local);
      if (h <= 0 && fallbackH > 0) h = fallbackH;
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
  }

  // Pass 3: post-data subgrids dock to the container bottom (AG-style
  // pinned-bottom / totals footer). Height was reserved from bodyHeight
  // above so the scrollable data region ends at `bodyBottom`.
  let y = bodyBottom;
  for (const subgrid of postDataSubgrids) {
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
    firstVisibleDataRow,
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
    floatingFilterRowTop,
    floatingFilterRowHeight,
  };
}
