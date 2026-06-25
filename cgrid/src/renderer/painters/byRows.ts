import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';
import type { ViewportColumn, ViewportRow } from '../../core/viewport';
import type { CellPaintConfig } from '../cellRenderers/registry';
import { applyCellProps } from '../../core/propertyChain';
import { HeaderGroupSubgrid } from '../../core/subgrid';
import { cellMatchesAnyQuickFilterTerm } from '../../worker/dataPipeline';


export function paintCellsByRows(gc: CachedContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, cellRenderers, cellData, selection, sortModel, rowDataSnapshotAt, quickFilterLowerTerms } = p;
  const quickFilterActive = quickFilterLowerTerms.length > 0;

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
              /*clip*/ isDataBand, rowBgs, sharedConfig, sortLookup, columnDefs, cellRenderers, cellData, selection, theme, rowDataSnapshotAt, quickFilterActive, quickFilterLowerTerms);
    paintBand(gc, sb.rows, center,
              vs.bodyLeft, vs.bodyRight, sgTop, sgBottom,
              /*clip*/ true, rowBgs, sharedConfig, sortLookup, columnDefs, cellRenderers, cellData, selection, theme, rowDataSnapshotAt, quickFilterActive, quickFilterLowerTerms);
    paintBand(gc, sb.rows, rightPinned,
              vs.bodyRight, rightEdge, sgTop, sgBottom,
              /*clip*/ isDataBand, rowBgs, sharedConfig, sortLookup, columnDefs, cellRenderers, cellData, selection, theme, rowDataSnapshotAt, quickFilterActive, quickFilterLowerTerms);
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
  rowDataSnapshotAt: PainterCtx['rowDataSnapshotAt'],
  quickFilterActive: boolean,
  quickFilterLowerTerms: readonly string[],
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
          // Resolve the group's headerClass into class names for applyCellProps.
          const groupDef = (row.subgrid as HeaderGroupSubgrid).getGroupDef(col.colId);
          let groupHeaderClassNames: string[] | undefined;
          if (groupDef) {
            if (groupDef.headerClassStatic) {
              groupHeaderClassNames = groupDef.headerClassStatic;
            } else if (groupDef.headerClassFn) {
              const result = groupDef.headerClassFn({ colId: col.colId });
              const arr = result === undefined ? [] : Array.isArray(result) ? result : [result];
              groupHeaderClassNames = arr.filter(Boolean) as string[];
            } else {
              groupHeaderClassNames = []; // signal: group path, no class names
            }
          }
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
            rowData: undefined,
            groupHeaderClassNames,
          });
          cellRenderers.get('header').paint(gc, config);
        }
        i += span;
      }
      continue;
    }

    // Compute rowData once per data row (not per cell) for use by
    // cellClassRules predicates and function-form cellStyle / cellClass.
    // Header rows don't need row data.
    const rowData: Record<string, unknown> | undefined = row.subgrid.isData
      ? rowDataSnapshotAt(row.localRowIndex)
      : undefined;

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

      // Resolve the renderer per cell: header rows always go to 'header';
      // data rows ask the column's cellRendererSelector (if any) and fall
      // back to the static cellRenderer + cellRendererParams. The selector
      // is the only per-cell hook here — keep it cheap.
      let rendererName: string;
      let params: unknown;
      if (row.subgrid.isHeader) {
        rendererName = 'header';
        params = undefined;
      } else if (def.cellRendererSelector) {
        const selected = def.cellRendererSelector({ value, colId: col.colId, data: null });
        rendererName = selected?.component ?? def.cellRenderer;
        params = selected?.params !== undefined ? selected.params : def.cellRendererParams;
      } else {
        rendererName = def.cellRenderer;
        params = def.cellRendererParams;
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
        params,
        rowData,
        rowIndex: row.subgrid.isData ? row.localRowIndex : 0,
      });

      // Cycle 7 / Task 7 — quick-filter cell highlight. Tints any data
      // cell whose RENDERED text contains an active search term with the
      // theme's `quickFilterMatchBg`. We test against `valueFormatted`,
      // not the raw `value`, so the tint tracks what the user actually
      // sees on screen — a moneyFormatter turning 12345.67 into
      // "$12,345.67" would otherwise leave a cell highlighted that the
      // user can't see why (raw includes "12345" but the comma in the
      // formatted text breaks the visible substring). Skipped on header
      // rows (no row filter participation) and on selected rows (the
      // selection bg already signals "this row matters"; doubling up
      // would fight the focus ring). Applied AFTER the cellClassRules
      // pass so the highlight wins over class-driven bg.
      if (
        quickFilterActive
        && row.subgrid.isData
        && !config.isSelected
        && cellMatchesAnyQuickFilterTerm(valueFormatted, quickFilterLowerTerms)
      ) {
        config.bg = theme.quickFilterMatchBg;
      }

      // Per-cell clip — adjacent columns share the same band clip, so a value
      // wider than its column (long Position ID, fat number) would otherwise
      // bleed into the next cell. Intersection with the band clip means the
      // cell never paints outside [col.left, col.right] ∩ [x0, x1] or below
      // the row band — correct under both horizontal and vertical scroll.
      gc.cache.save();
      gc.beginPath();
      gc.rect(col.left, row.top, col.width, row.height);
      gc.clip();
      cellRenderers.get(rendererName).paint(gc, config);
      gc.cache.restore();
    }
  }

  if (clip) gc.cache.restore();
}
