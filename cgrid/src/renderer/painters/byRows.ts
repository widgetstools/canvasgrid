import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';
import type { ViewportColumn, ViewportRow } from '../../core/viewport';
import type { CellPaintConfig } from '../cellRenderers/registry';
import { applyCellProps } from '../../core/propertyChain';
import { HeaderGroupSubgrid } from '../../core/subgrid';

export function paintCellsByRows(gc: CachedContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, cellRenderers, cellData, selection, sortModel } = p;

  // 1. Compute the right edge of the painted area (mirrors gridLinesPainter).
  const rightEdge = vs.visibleColumns.length === 0
    ? vs.bodyRight
    : Math.max(vs.bodyRight, ...vs.visibleColumns.map((c) => c.right));

  // Build sort lookup: colId -> { direction, index }.
  const sortLookup = new Map<string, { direction: 'asc' | 'desc'; index: number }>();
  for (let i = 0; i < sortModel.length; i++) {
    const entry = sortModel[i]!;
    sortLookup.set(entry.colId, { direction: entry.direction, index: i });
  }

  // 2. Resolve rowBg per visible row (one pass).
  const { selectedRowIndices } = selection;
  const rowBgs: string[] = new Array(vs.visibleRows.length);
  for (let r = 0; r < vs.visibleRows.length; r++) {
    const row = vs.visibleRows[r]!;
    if (row.subgrid.isHeader) {
      rowBgs[r] = theme.headerBg;
    } else if (row.subgrid.isData) {
      const dataIdx = row.localRowIndex;
      rowBgs[r] = selectedRowIndices.has(dataIdx)
        ? theme.rowSelectedBg
        : (dataIdx % 2 === 1 ? theme.rowAltBg : theme.bg);
    } else {
      // totals/footer — use headerBg as a neutral default
      rowBgs[r] = theme.headerBg;
    }
  }

  // 3. Build row bundles — consecutive rows with the same bg that differs from theme.bg.
  // theme.bg was already painted by the top-level full-canvas fill, so skip it.
  // Track per-bundle whether all member rows belong to the data subgrid; data
  // bundles get clamped to the body region in step 4 so overscan rows above
  // bodyTop (negative `top`) don't bleed their backgrounds into the header.
  type Bundle = { top: number; bottom: number; bg: string; isData: boolean };
  let bundle: Bundle | null = null;
  const bundles: Bundle[] = [];
  for (let r = 0; r < vs.visibleRows.length; r++) {
    const row = vs.visibleRows[r]!;
    const bg = rowBgs[r]!;
    if (bg === theme.bg) { bundle = null; continue; }
    const rowIsData = row.subgrid.isData;
    if (bundle && bundle.bg === bg && bundle.bottom === row.top && bundle.isData === rowIsData) {
      bundle.bottom = row.bottom;
    } else {
      bundle = { top: row.top, bottom: row.bottom, bg, isData: rowIsData };
      bundles.push(bundle);
    }
  }

  // 4. Paint bundles — one fillRect per bundle.
  // Use fillRect (NOT clearFill) so translucent bgs like rowSelectedBg alpha-blend
  // correctly over the underlying theme bg. Data bundles are clamped to the body
  // region so scrolled-overscan rows (top < bodyTop) can't paint over the header.
  for (const b of bundles) {
    const top = b.isData ? Math.max(b.top, vs.bodyTop) : b.top;
    const bottom = b.isData ? Math.min(b.bottom, vs.bodyBottom) : b.bottom;
    if (bottom <= top) continue;
    gc.cache.fillStyle = b.bg;
    gc.fillRect(0, top, rightEdge, bottom - top);
  }

  // 5. Split columns into bands and paint cells.
  const leftPinned = vs.visibleColumns.filter((c) => c.pinned === 'left');
  const center = vs.visibleColumns.filter((c) => !c.pinned);
  const rightPinned = vs.visibleColumns.filter((c) => c.pinned === 'right');

  // Pre-compute subgrid bands — group visibleRows by subgrid to get y-range per subgrid.
  // Walk once and group consecutive rows from the same subgrid.
  type SubgridBand = {
    yTop: number;
    yBottom: number;
    rows: ViewportRow[];
  };
  const subgridBands: SubgridBand[] = [];
  for (let r = 0; r < vs.visibleRows.length; r++) {
    const row = vs.visibleRows[r]!;
    const last = subgridBands[subgridBands.length - 1];
    if (last && last.rows[0]!.subgrid === row.subgrid) {
      last.rows.push(row);
      last.yBottom = row.bottom;
    } else {
      subgridBands.push({ yTop: row.top, yBottom: row.bottom, rows: [row] });
    }
  }

  // Shared config object — allocated once per call, mutated per cell.
  const sharedConfig: CellPaintConfig = {
    value: '', valueFormatted: '',
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    font: '', fg: '', bg: '', borderColor: '',
    halign: 'left', prefillColor: '',
    isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  };

  for (const sb of subgridBands) {
    const isDataBand = sb.rows[0]!.subgrid.isData;
    // Data subgrid bands always clip to the body region (vs.bodyTop..bodyBottom)
    // in every column band — left + center + right pinned. Without this, overscan
    // data rows whose top is < bodyTop paint cell text over the header band, and
    // the right-pinned band (which previously had clip:false) leaks data values
    // alongside the leaf header labels. Header bands keep their natural extent
    // and don't need clipping — their rows always have top >= 0.
    const sgTop = isDataBand ? vs.bodyTop : sb.yTop;
    const sgBottom = isDataBand ? vs.bodyBottom : sb.yBottom;

    paintBand(gc, sb.rows, leftPinned,
              0, vs.bodyLeft, sgTop, sgBottom,
              /*clip*/ isDataBand, rowBgs, sharedConfig, sortLookup, columnDefs, cellRenderers, cellData, selection, theme);
    paintBand(gc, sb.rows, center,
              vs.bodyLeft, vs.bodyRight, sgTop, sgBottom,
              /*clip*/ true, rowBgs, sharedConfig, sortLookup, columnDefs, cellRenderers, cellData, selection, theme);
    paintBand(gc, sb.rows, rightPinned,
              vs.bodyRight, rightEdge, sgTop, sgBottom,
              /*clip*/ isDataBand, rowBgs, sharedConfig, sortLookup, columnDefs, cellRenderers, cellData, selection, theme);
  }
}

function paintBand(
  gc: CachedContext2D,
  rows: ViewportRow[],
  cols: ViewportColumn[],
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number,
  clip: boolean,
  rowBgs: string[],
  config: CellPaintConfig,
  sortLookup: Map<string, { direction: 'asc' | 'desc'; index: number }>,
  columnDefs: PainterCtx['columnDefs'],
  cellRenderers: PainterCtx['cellRenderers'],
  cellData: PainterCtx['cellData'],
  selection: PainterCtx['selection'],
  theme: PainterCtx['theme'],
): void {
  if (cols.length === 0 || rows.length === 0) return;
  if (clip) {
    gc.cache.save();
    gc.beginPath();
    gc.rect(x0, yTop, x1 - x0, yBottom - yTop);
    gc.clip();
  }

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]!;
    const r = row.rowIndex;
    const rowBg = rowBgs[r]!;

    // HeaderGroupSubgrid: walk columns left→right, merging adjacent leaves
    // that resolve to the same group at this row's depth. One rect per group;
    // ungrouped slots paint nothing (the row background bundle remains).
    if (row.subgrid instanceof HeaderGroupSubgrid) {
      let i = 0;
      while (i < cols.length) {
        const col = cols[i]!;
        const groupId = row.subgrid.getGroupIdAt(col.colId);
        let span = 1;
        while (
          groupId !== null &&
          i + span < cols.length &&
          row.subgrid.getGroupIdAt(cols[i + span]!.colId) === groupId
        ) {
          span++;
        }
        const def = columnDefs.get(col.colId);
        if (def && groupId) {
          const lastCol = cols[i + span - 1]!;
          const w = lastCol.right - col.left;
          const cell = row.subgrid.getCell(0, col.colId);
          const text = cell?.valueFormatted ?? '';
          applyCellProps(config, {
            theme,
            colDef: def,
            value: text,
            valueFormatted: text,
            x: col.left, y: row.top, w, h: row.height,
            rowBg,
            prefillColor: rowBg,
            isFocused: false, isSelected: false, isHovered: false, isHeader: true,
            iconColor: theme.focusRingColor,
          });
          cellRenderers.get('header').paint(gc, config);
        }
        i += span;
      }
      continue;
    }

    for (const col of cols) {
      const def = columnDefs.get(col.colId);
      if (!def) continue;

      let value: unknown = '';
      let valueFormatted = '';
      let flashAlpha: number | undefined;
      let sortDirection: 'asc' | 'desc' | undefined;

      if (row.subgrid.isHeader) {
        value = def.headerName;
        valueFormatted = def.headerName;
        const sort = sortLookup.get(col.colId);
        sortDirection = sort?.direction;
      } else if (row.subgrid.isData) {
        const cell = cellData(row.localRowIndex, col.colId);
        value = cell?.value ?? '';
        valueFormatted = cell?.valueFormatted ?? '';
        flashAlpha = cell?.flashAlpha;
      } else {
        continue; // totals/footer not yet wired
      }

      applyCellProps(config, {
        theme,
        colDef: def,
        value,
        valueFormatted,
        x: col.left, y: row.top, w: col.width, h: row.height,
        rowBg,
        prefillColor: rowBg,
        isFocused: !row.subgrid.isHeader
          && selection.focusedRowIndex === row.localRowIndex
          && selection.focusedColId === col.colId,
        isSelected: !row.subgrid.isHeader
          && selection.selectedRowIndices.has(row.localRowIndex),
        isHovered: false,
        isHeader: row.subgrid.isHeader,
        iconColor: theme.focusRingColor,
        sortDirection,
        flashAlpha,
      });

      const rendererName = row.subgrid.isHeader ? 'header' : def.cellRenderer;
      cellRenderers.get(rendererName).paint(gc, config);
    }
  }

  if (clip) gc.cache.restore();
}
