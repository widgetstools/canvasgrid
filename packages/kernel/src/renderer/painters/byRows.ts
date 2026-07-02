import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';
import type { ViewportColumn, ViewportRow } from '../../core/viewport';
import type { CellPaintConfig } from '../cellRenderers/registry';
import type { ResolvedColDef } from '../../core/propertyChain';
import { applyCellProps } from '../../core/propertyChain';
import { HeaderGroupSubgrid } from '../../core/subgrid';
import { cellMatchesAnyQuickFilterTerm } from '../../worker/dataPipeline';
import { isPivotResultGroupId } from '../../core/pivotColumns';
import { resolveIcon as resolveIconPath } from '../../icons/registry';
import { bumpFormatEvalGeneration } from '../../core/formatEvalMemo';

/** Cycle 21c / Task 16 — pending inline-icon draw for one cell. Resolved
 *  before the cell painter runs (so the painter's text can shift by the
 *  icon width via `config.padding`) and drawn after it (so the icon
 *  sits on top of the cell background the painter laid down). */
interface PendingCellIcon {
  path: Path2D;
  x: number;
  y: number;
  size: number;
  tint: string;
}

/** Icon slot sizing — 55% of the row height, vertically centered, with
 *  a 4px gutter between icon and text. Matches the composite renderer's
 *  Lucide 24×24-viewBox scaling. */
const CELL_ICON_EDGE_PAD = 6;
const CELL_ICON_GUTTER = 4;

function drawCellIcon(gc: CachedContext2D, icon: PendingCellIcon): void {
  gc.cache.save();
  gc.translate(icon.x, icon.y);
  const scale = icon.size / 24; // Lucide viewBox is 24×24
  gc.scale(scale, scale);
  gc.cache.strokeStyle = icon.tint;
  gc.cache.lineWidth = 2 / scale;
  gc.cache.lineCap = 'round';
  gc.cache.lineJoin = 'round';
  gc.stroke(icon.path);
  gc.cache.restore();
}

/** Cycle 14 / Task 4 — decorate a leaf-column header with its aggFunc
 *  prefix when the column declares `aggFunc` AND the suppress flag is
 *  off. Returns `sum(Notional)` for `aggFunc: 'sum'`, the array's first
 *  entry's name for `aggFunc: ['sum', 'avg']` (per the design plan,
 *  decision 6 — first entry wins as the visible label), and the raw
 *  `headerName` otherwise. Column-level `suppressAggFuncInHeader`
 *  (when explicitly set) wins over the grid-level value; an unset
 *  per-column flag defers to the grid-level option.
 *
 *  Pure + sync; called once per leaf header per paint. The decorated
 *  string flows through the existing header cell renderer's right-
 *  side ellipsification, so a narrow column renders `sum(Noti...)` —
 *  the verb sits on the LEFT and survives natural truncation. */
export function decorateHeader(def: ResolvedColDef, gridSuppress: boolean): string {
  const headerName = def.headerName;
  const colSuppress = def.suppressAggFuncInHeader;
  const suppressed = colSuppress !== undefined ? colSuppress : gridSuppress;
  if (suppressed) return headerName;
  const aggFunc = def.aggFunc;
  if (!aggFunc) return headerName;
  const aggName = Array.isArray(aggFunc) ? aggFunc[0] : aggFunc;
  if (!aggName) return headerName;
  return `${aggName}(${headerName})`;
}


export function paintCellsByRows(gc: CachedContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, cellRenderers, cellData, selection, sortModel, rowDataSnapshotAt, quickFilterLowerTerms, suppressAggFuncInHeader, groupRowStrip } = p;
  const totalRowCount = p.totalRowCount ?? 0;
  const quickFilterActive = quickFilterLowerTerms.length > 0;

  // 1. Compute the right edge of the painted area (mirrors gridLinesPainter).
  // Cycle 25 / Task 5 — walk once instead of `Math.max(...visibleColumns.map(...))`
  // which allocates an array and a spread frame per paint.
  let rightEdge = vs.bodyRight;
  for (let i = 0; i < vs.visibleColumns.length; i++) {
    const r = vs.visibleColumns[i]!.right;
    if (r > rightEdge) rightEdge = r;
  }

  // Build sort lookup: colId -> { direction, index }.
  const sortLookup = new Map<string, { direction: 'asc' | 'desc'; index: number }>();
  for (let i = 0; i < sortModel.length; i++) {
    const entry = sortModel[i]!;
    sortLookup.set(entry.colId, { direction: entry.direction, index: i });
  }

  // Cycle 15 / Task 5 — pre-compute the per-row group-strip context for
  // `'groupRows'` / `'custom'` modes. Indexed by visible-row position
  // (matches `rowBgs`); `null` entries are data rows that paint per-cell
  // as usual. Lookup runs once per data row; `null` entries skip the
  // per-row override below + the strip-paint loop further down.
  const groupStripRows: (import('../cellRenderers/group').GroupCellValue | null)[] =
    new Array(vs.visibleRows.length).fill(null);
  if (groupRowStrip) {
    for (let r = 0; r < vs.visibleRows.length; r++) {
      const row = vs.visibleRows[r]!;
      if (!row.subgrid.isData) continue;
      const ctx = groupRowStrip.lookup(row.localRowIndex);
      if (ctx !== null && ctx.rowKind === 1) groupStripRows[r] = ctx;
    }
  }

  // 2. Resolve rowBg per visible row (one pass).
  const { selectedRowIndices } = selection;
  const rowBgs: string[] = new Array(vs.visibleRows.length);
  // Cycle 15 / Task 12 — pre-resolve per-row "is footer row" lookup
  // via the painter ctx's `rowKindAt` probe (mirrors the chunk's
  // `rowKinds[localIndex]` array). Reading once per visible row
  // (rather than per cell × N) keeps the bg-bundle + per-cell route
  // synchronised without paying for redundant chunk reads.
  const isFooterRow: boolean[] = new Array(vs.visibleRows.length).fill(false);
  // Tests that build a partial PainterCtx may omit `rowKindAt` — guard
  // defensively so the per-row check never crashes existing harnesses.
  const rowKindAt = p.rowKindAt;
  if (rowKindAt) {
    for (let r = 0; r < vs.visibleRows.length; r++) {
      const row = vs.visibleRows[r]!;
      if (!row.subgrid.isData) continue;
      if (rowKindAt(row.localRowIndex) === 3) isFooterRow[r] = true;
    }
  }
  for (let r = 0; r < vs.visibleRows.length; r++) {
    const row = vs.visibleRows[r]!;
    // Cycle 15 / Task 5 — group-row strip mode wins over selection /
    // alt-row bg. The row IS a group label, not a data row; the strip's
    // `groupRowBg` carries the structural signal.
    if (groupStripRows[r]) {
      rowBgs[r] = theme.groupRowBg;
      continue;
    }
    // Cycle 15 / Task 12 — footer rows get the totals "lift" bg via
    // `theme.groupFooterBg`. Paint it BEFORE the data-row selection /
    // alt-row branch so a footer inside a selected group still reads
    // as a footer (selection chrome belongs to data rows only).
    if (isFooterRow[r]) {
      rowBgs[r] = theme.groupFooterBg;
      continue;
    }
    if (row.subgrid.isHeader) {
      rowBgs[r] = theme.headerBg;
    } else if (row.subgrid.isData) {
      const dataIdx = row.localRowIndex;
      rowBgs[r] = selectedRowIndices.has(dataIdx)
        ? theme.rowSelectedBg
        : (dataIdx % 2 === 1 ? theme.rowAltBg : theme.bg);
    } else if (row.subgrid.isTotals) {
      // Cycle 14 / Task 1 — the "hairline lift": a 3% slate tint that
      // gives the totals row its visual signature without competing
      // with the data above. The top border lands in gridLinesPainter.
      rowBgs[r] = theme.totalsBg;
    } else if (row.subgrid.isPinned) {
      // Cycle 14 / Task 2 — warm tint for pinned reference rows. Same
      // luminosity lift as totals but the opposite temperature so the
      // trader can tell "static reference" (warm) from "computed
      // summary" (slate) at a glance. The structural border at the
      // body-side edge of the pinned stack lands in gridLinesPainter.
      rowBgs[r] = theme.pinnedRowBg;
    } else {
      // footer / unknown — neutral default
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
  // Cycle 25 / Task 5 — walk visibleColumns once and push into three
  // pre-allocated arrays instead of three .filter() passes (three
  // allocations + three walks per paint).
  const leftPinned: typeof vs.visibleColumns = [];
  const center: typeof vs.visibleColumns = [];
  const rightPinned: typeof vs.visibleColumns = [];
  for (let i = 0; i < vs.visibleColumns.length; i++) {
    const col = vs.visibleColumns[i]!;
    if (col.pinned === 'left') leftPinned.push(col);
    else if (col.pinned === 'right') rightPinned.push(col);
    else center.push(col);
  }

  // Cycle 21e / Task 14 (review fix 1) — advance the format-eval paint
  // generation once per paint pass: tier-1/tier-2 format programs (row-
  // dependent output) share one eval per cell WITHIN this pass but never
  // reuse an eval from a previous pass.
  bumpFormatEvalGeneration();

  // Cycle 21e / Task 14 — first/last visible data column across all
  // bands (left-pinned → center → right-pinned order) for row-start /
  // row-end rule indicators.
  const firstVisibleColId = (leftPinned[0] ?? center[0] ?? rightPinned[0])?.colId;
  const lastVisibleColId = (rightPinned[rightPinned.length - 1]
    ?? center[center.length - 1]
    ?? leftPinned[leftPinned.length - 1])?.colId;

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

  // Cycle 19 / Task 8b — shared per-paint context threaded through
  // every `paintBand` call in the subgrid loop. Same identity across
  // every band so the mutated `sharedConfig` + the resolved lookups
  // stay hot in cache.
  const bandCtx: PaintBandCtx = {
    rowBgs,
    groupStripRows,
    isFooterRow,
    config: sharedConfig,
    sortLookup,
    columnDefs,
    cellRenderers,
    cellData,
    selection,
    theme,
    rowDataSnapshotAt,
    quickFilterActive,
    quickFilterLowerTerms,
    suppressAggFuncInHeader,
    getColumnGroupOpen: p.getColumnGroupOpen,
    totalRowCount,
    stringRowIdAt: p.stringRowIdAt,
    getRowDataById: p.getRowDataById,
    themeKind: p.themeKind,
    firstVisibleColId,
    lastVisibleColId,
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

    paintBand(gc, { rows: sb.rows, cols: leftPinned,  x0: 0,             x1: vs.bodyLeft,  yTop: sgTop, yBottom: sgBottom, clip: isDataBand }, bandCtx);
    paintBand(gc, { rows: sb.rows, cols: center,      x0: vs.bodyLeft,   x1: vs.bodyRight, yTop: sgTop, yBottom: sgBottom, clip: true },       bandCtx);
    paintBand(gc, { rows: sb.rows, cols: rightPinned, x0: vs.bodyRight,  x1: rightEdge,    yTop: sgTop, yBottom: sgBottom, clip: isDataBand }, bandCtx);
  }

  // Cycle 15 / Task 5 — group-row strip content (chevron + value + count).
  // Painted AFTER the per-band loops so the strip is unclipped — the
  // value text can flow across the full visible width (left-pinned +
  // center + right-pinned) without per-band clip rects subdividing it.
  // Per-cell painting on strip rows was already skipped inside `paintBand`
  // so there's nothing to over-paint. The strip's bg was painted via the
  // row-bg bundle (`theme.groupRowBg` selected in step 2).
  if (groupRowStrip) {
    const stripPainter = cellRenderers.get(groupRowStrip.renderer);
    for (let r = 0; r < vs.visibleRows.length; r++) {
      const ctx = groupStripRows[r];
      if (!ctx) continue;
      const row = vs.visibleRows[r]!;
      // Clip the strip to the body band so an overscan group row whose
      // top is < vs.bodyTop (vertical scroll) can't paint over the
      // header row above.
      const topClip = Math.max(row.top, vs.bodyTop);
      const bottomClip = Math.min(row.bottom, vs.bodyBottom);
      if (bottomClip <= topClip) continue;
      gc.cache.save();
      gc.beginPath();
      gc.rect(0, topClip, rightEdge, bottomClip - topClip);
      gc.clip();
      sharedConfig.value = ctx;
      sharedConfig.valueFormatted = ctx.valueFormatted;
      sharedConfig.bounds.x = 0;
      sharedConfig.bounds.y = row.top;
      sharedConfig.bounds.w = rightEdge;
      sharedConfig.bounds.h = row.height;
      sharedConfig.font = theme.font;
      sharedConfig.fg = theme.fg;
      sharedConfig.bg = theme.groupRowBg;
      sharedConfig.borderColor = theme.gridLineColor;
      sharedConfig.halign = 'left';
      sharedConfig.prefillColor = theme.groupRowBg;
      sharedConfig.isFocused = false;
      sharedConfig.isSelected = false;
      sharedConfig.isHovered = false;
      sharedConfig.isHeader = false;
      sharedConfig.flashAlpha = undefined;
      sharedConfig.flashFromColor = theme.flashFromColor;
      sharedConfig.groupChevronColor = theme.groupChevronColor;
      sharedConfig.groupCountColor = theme.groupCountColor;
      sharedConfig.groupIndent = theme.groupIndent;
      // Cycle 15 / Task 8 — tri-state checkbox tokens for the
      // groupRows strip path; the renderer omits the checkbox when
      // selectionState is undefined on the cell payload.
      sharedConfig.groupCheckboxBorderColor = theme.groupCheckboxBorderColor;
      sharedConfig.groupCheckboxCheckColor = theme.groupCheckboxCheckColor;
      sharedConfig.groupCheckboxIndeterminateColor = theme.groupCheckboxIndeterminateColor;
      sharedConfig.groupCheckboxFill = theme.groupCheckboxFill;
      // Strip mode is signalled by the renderer reading the value's
      // groupCellValue payload + the absence of a `groupColumnDepth`
      // param. Custom renderers may interpret the value differently.
      sharedConfig.params = undefined;
      stripPainter.paint(gc, sharedConfig);
      gc.cache.restore();
    }
  }
}

/** Cycle 19 / Task 8b — geometry + `clip` for a single `paintBand`
 *  call. Fresh per invocation (three per subgrid band — left-pinned,
 *  center, right-pinned). */
interface BandRect {
  rows: ViewportRow[];
  cols: ViewportColumn[];
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
  clip: boolean;
}

/** Cycle 19 / Task 8b — shared per-paint context threaded through
 *  every `paintBand` invocation. Same identity across every band so
 *  the mutated `sharedConfig` + resolved lookups stay hot in cache. */
interface PaintBandCtx {
  rowBgs: string[];
  groupStripRows: (import('../cellRenderers/group').GroupCellValue | null)[];
  isFooterRow: boolean[];
  config: CellPaintConfig;
  sortLookup: Map<string, { direction: 'asc' | 'desc'; index: number }>;
  columnDefs: PainterCtx['columnDefs'];
  cellRenderers: PainterCtx['cellRenderers'];
  cellData: PainterCtx['cellData'];
  selection: PainterCtx['selection'];
  theme: PainterCtx['theme'];
  rowDataSnapshotAt: PainterCtx['rowDataSnapshotAt'];
  quickFilterActive: boolean;
  quickFilterLowerTerms: readonly string[];
  suppressAggFuncInHeader: boolean;
  getColumnGroupOpen: ((groupId: string) => boolean) | undefined;
  totalRowCount: number;
  stringRowIdAt: PainterCtx['stringRowIdAt'];
  getRowDataById: PainterCtx['getRowDataById'];
  themeKind: PainterCtx['themeKind'];
  /** Cycle 21e / Task 14 — first/last visible data colId across all
   *  bands, for row-start / row-end rule indicator targeting. */
  firstVisibleColId?: string;
  lastVisibleColId?: string;
}

function paintBand(gc: CachedContext2D, band: BandRect, ctx: PaintBandCtx): void {
  const { rows, cols, x0, x1, yTop, yBottom, clip } = band;
  const {
    rowBgs, groupStripRows, isFooterRow, config, sortLookup, columnDefs,
    cellRenderers, cellData, selection, theme, rowDataSnapshotAt,
    quickFilterActive, quickFilterLowerTerms, suppressAggFuncInHeader,
    getColumnGroupOpen, totalRowCount,
  } = ctx;
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
    // Cycle 15 / Task 5 — strip-mode group rows skip per-cell painting
    // entirely. The full-row strip paints in `paintCellsByRows` after the
    // band loop with the row's `groupRowBg` and the strip renderer
    // owning the full visible width.
    if (groupStripRows[r] !== null) continue;

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
          // Cycle 18 / Task 4 — pivot column-group chevron. Only BRANCH
          // pivot groups (those whose synthesis emitted a
          // `columnGroupShow:'closed'` totals leaf) get the chevron:
          // those are the groups where toggling has a meaningful effect
          // (totals leaf ⇄ child columns). Cycle 4 column groups never
          // hit this branch — the `isPivotResultGroupId` guard rejects
          // them. The hit-test for the toggle is the entire group rect,
          // wired in `interaction/features/headerClick.ts` →
          // `toggleColumnGroup`.
          let pivotGroupExpand: 'open' | 'closed' | undefined;
          if (groupDef && isPivotResultGroupId(groupDef.groupId) && getColumnGroupOpen) {
            // Cycle 18 / Task 9 follow-up (AG parity) — paint a chevron
            // when the toggle has a visible effect, which is when EITHER:
            //   - the group has a sub-group child (branch pivot group;
            //     collapsing hides every value-col leaf inside the
            //     descendant sub-groups while always-visible leaves
            //     stay — the AG-Grid default behaviour); OR
            //   - the group has a direct `columnGroupShow:'closed'`
            //     leaf (legacy Cycle 18 / Task 4 — collapse reveals the
            //     fallback total leaf).
            const hasBranchChild = groupDef.children.some((c) => c.kind === 'group');
            const hasClosedLeaf = groupDef.children.some(
              (c) => c.kind === 'leaf' && c.colDef.columnGroupShow === 'closed',
            );
            if (hasBranchChild || hasClosedLeaf) {
              pivotGroupExpand = getColumnGroupOpen(groupDef.groupId) ? 'open' : 'closed';
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
            // Cycle 27 / Task 1 — thread the group's resolved headerStyle
            // overrides through to applyCellProps' header branch.
            groupHeaderStyle: groupDef?.headerStyle,
            groupHeaderStyleFn: groupDef?.headerStyleFn,
            pivotGroupExpand,
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
    // Cycle 21e / Task 11 — rule-fold identity. `stringRowIds` is '' for
    // group/footer chunk entries, so `ruleRowId` is undefined exactly on
    // the rows the fold must skip. `ruleRow` prefers the full row from
    // the rowDataById mirror (hidden columns included) and falls back to
    // the visible-column snapshot.
    const ruleRowId: string | undefined = row.subgrid.isData
      ? (ctx.stringRowIdAt?.(row.localRowIndex) || undefined)
      : undefined;
    const ruleRow: Record<string, unknown> | undefined = ruleRowId !== undefined
      ? ((ctx.getRowDataById?.(ruleRowId) as Record<string, unknown> | undefined) ?? rowData)
      : undefined;

    for (const col of cols) {
      const def = columnDefs.get(col.colId);
      if (!def) continue;

      let value: unknown = '';
      let valueFormatted = '';
      let flashAlpha: number | undefined;
      let flashColor: string | undefined;
      let sortDirection: 'asc' | 'desc' | undefined;
      let sortIndex: number | undefined;
      let sortTotal: number | undefined;
      let unSortIcon: boolean | undefined;

      if (row.subgrid.isHeader) {
        // Cycle 14 / Task 4 — leaf-column headers decorate to
        // `sum(Notional)` when the column declares an aggFunc AND the
        // suppress toggle (grid-level OR per-column override) is off.
        // Group headers are handled above via `HeaderGroupSubgrid` and
        // skip this path; per the design plan, group cells carry no
        // aggFunc of their own.
        const headerText = decorateHeader(def, suppressAggFuncInHeader);
        value = headerText;
        valueFormatted = headerText;
        const sort = sortLookup.get(col.colId);
        sortDirection = sort?.direction;
        // Cycle 8 / Task 1 — 1-index for the display badge; sortTotal
        // mirrors the full sortModel length so the painter can decide
        // whether to render the badge at all.
        if (sort) sortIndex = sort.index + 1;
        sortTotal = sortLookup.size;
        // Cycle 8 / Task 5 — only flag unSortIcon when the column is
        // both opted in AND currently sortable AND not already sorted.
        // The painter additionally guards on `sortDirection` so the
        // flag is purely a "render hint" with no extra branching.
        if (def.unSortIcon && def.sortable && !sort) unSortIcon = true;
      } else if (row.subgrid.isData) {
        const cell = cellData(row.localRowIndex, col.colId);
        value = cell?.value ?? '';
        valueFormatted = cell?.valueFormatted ?? '';
        flashAlpha = cell?.flashAlpha;
        flashColor = cell?.flashColor;
      } else if (row.subgrid.isTotals) {
        // Cycle 14 / Task 1 — read the totals value through the
        // subgrid's `getCell`, which proxies to the current chunk's
        // `totals[colId]` map (already worker-computed). Returns null
        // for columns with no aggFunc — paint the cell empty (the row
        // bg + top border still apply, so the row reads as part of the
        // summary even with empty cells). Task 5's polished `'totals'`
        // renderer overrides this with an em-dash placeholder.
        const cell = row.subgrid.getCell(row.localRowIndex, col.colId);
        value = cell?.value ?? '';
        valueFormatted = cell?.valueFormatted ?? '';
      } else if (row.subgrid.isPinned) {
        // Cycle 14 / Task 2 — read the pinned row's value via the
        // subgrid's `getCell`, which proxies to the caller-owned row
        // data array. The lookup runs the column's `valueFormatter` so
        // a moneyFormatter-decorated column reads identically in a
        // data row and a pinned reference row.
        const cell = row.subgrid.getCell(row.localRowIndex, col.colId);
        value = cell?.value ?? '';
        valueFormatted = cell?.valueFormatted ?? '';
      } else {
        continue; // footer not yet wired
      }

      // Resolve the renderer per cell: header rows always go to 'header';
      // totals rows default to the polished `'totals'` renderer (Cycle 14
      // / Task 5) unless the column declares an explicit
      // `totalsCellRenderer` override. Cycle 15 / Task 12 — per-group
      // footer rows (`isFooterRow[r]`) inside the DataSubgrid route
      // through the new `'groupFooter'` renderer. Data rows ask the
      // column's cellRendererSelector (if any) and fall back to the
      // static cellRenderer + cellRendererParams. The selector is the
      // only per-cell hook here — keep it cheap.
      let rendererName: string;
      let params: unknown;
      if (row.subgrid.isHeader) {
        rendererName = 'header';
        params = undefined;
      } else if (row.subgrid.isTotals) {
        rendererName = def.totalsCellRenderer ?? 'totals';
        params = def.cellRendererParams;
      } else if (row.subgrid.isData && isFooterRow[r]) {
        rendererName = 'groupFooter';
        params = def.cellRendererParams;
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
        isFocused: row.subgrid.isData
          && !isFooterRow[r]
          && selection.focusedRowIndex === row.localRowIndex
          && selection.focusedColId === col.colId,
        isSelected: row.subgrid.isData
          && !isFooterRow[r]
          && selection.selectedRowIndices.has(row.localRowIndex),
        isHovered: false,
        isHeader: row.subgrid.isHeader,
        // Cycle 14 / Task 1 — totals rows trigger the "lift" treatment
        // in `applyCellProps`: +1 font-weight stop + totalsFg.
        isTotals: row.subgrid.isTotals,
        // Cycle 15 / Task 12 — per-group footer rows trigger the same
        // shape lift but via the `--cg-group-footer-*` token family.
        // Mutually exclusive with isTotals (the input contract on
        // `ApplyCellPropsInput` documents this; the `else if` in
        // `applyCellProps` enforces it).
        isGroupFooter: row.subgrid.isData && isFooterRow[r],
        iconColor: theme.focusRingColor,
        sortDirection,
        sortIndex,
        sortTotal,
        unSortIcon,
        unSortIconColor: theme.unsortIconColor,
        flashAlpha,
        params,
        rowData,
        rowIndex: row.subgrid.isData ? row.localRowIndex : 0,
        // Cycle 21e / Task 11 — rule-engine fold inputs. Undefined on
        // header / totals / pinned / group / footer rows.
        rowId: ruleRowId,
        ruleRow,
        themeKind: ctx.themeKind,
        // Row-select header tri-state checkbox. Resolved on the
        // header row only; non-headers stay `undefined` so the cell
        // / totals / footer paths see the default. State is computed
        // from the selection-set cardinality vs. the total visible
        // row count — `'none'` / `'all'` are exact, anything else is
        // `'partial'` (indeterminate).
        headerCheckboxState: row.subgrid.isHeader && def.headerCheckboxSelection === true
          ? (selection.selectedRowIndices.size === 0
              ? 'none'
              : selection.selectedRowIndices.size >= totalRowCount
                ? 'all'
                : 'partial')
          : undefined,
      });

      // Cycle 21e / Task 13 — per-call flash color override. applyCellProps
      // just reset flashFromColor to the theme value, so this is
      // self-clearing across the reused config object.
      if (flashColor !== undefined) config.flashFromColor = flashColor;

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

      // Cycle 21c / Task 16 — inline icon from a compiled format string.
      // Only data cells on columns whose resolved `cellIcon` fn returns a
      // registry-resolvable IconRef. The icon claims a slot at the leading
      // or trailing edge; the text shifts away via `config.padding` (every
      // built-in painter reads `padding.left/right` with its own default).
      // Columns without `cellIcon` (the overwhelming majority) skip this
      // block entirely — no per-cell cost on the hot path.
      let pendingIcon: PendingCellIcon | null = null;
      // Cycle 21e / Task 14 — rule indicator resolution. `cell` targets
      // paint on the matching cell; `row-start` / `row-end` paint only on
      // the first / last visible data column of the matching row (the
      // engine returns the indicator on every cell of a row-scope match;
      // byRows owns column order, so the filter lives here).
      let ruleIconRef: { name: string; color?: string; position?: 'leading' | 'trailing' } | null = null;
      const ri = config.ruleIndicator;
      if (ri && row.subgrid.isData && !isFooterRow[r]) {
        const placed =
          ri.target === 'cell'
          || (ri.target === 'row-start' && col.colId === ctx.firstVisibleColId)
          || (ri.target === 'row-end' && col.colId === ctx.lastVisibleColId);
        if (placed) {
          ruleIconRef = {
            name: ri.iconName,
            color: ri.color,
            position: ri.position === 'after' ? 'trailing' : 'leading',
          };
        }
      }
      if (
        ruleIconRef !== null
        || (row.subgrid.isData
          && !isFooterRow[r]
          && typeof def.cellIcon === 'function')
      ) {
        let iconRef: { name: string; color?: string; position?: 'leading' | 'trailing' } | null = ruleIconRef;
        if (iconRef === null) {
          try {
            iconRef = def.cellIcon!({
              value, data: (rowData ?? {}) as never, colId: col.colId,
              rowId: ruleRowId, themeKind: ctx.themeKind,
            });
          } catch {
            iconRef = null;
          }
        }
        if (iconRef && iconRef.name) {
          const path = resolveIconPath(iconRef.name);
          if (path) {
            const iconSize = Math.floor(row.height * 0.55);
            const position = iconRef.position ?? 'leading';
            pendingIcon = {
              path,
              x: position === 'leading'
                ? col.left + CELL_ICON_EDGE_PAD
                : col.left + col.width - CELL_ICON_EDGE_PAD - iconSize,
              y: row.top + (row.height - iconSize) / 2,
              size: iconSize,
              tint: iconRef.color ?? config.fg,
            };
            const pad = { ...(config.padding ?? {}) };
            if (position === 'leading') {
              pad.left = (pad.left ?? CELL_ICON_EDGE_PAD) + iconSize + CELL_ICON_GUTTER;
            } else {
              pad.right = (pad.right ?? CELL_ICON_EDGE_PAD) + iconSize + CELL_ICON_GUTTER;
            }
            config.padding = pad;
          }
        }
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
      // Cycle 21c / Task 16 — icon draws after the painter so it sits on
      // top of the cell bg, inside the same clip so it can't bleed.
      if (pendingIcon) drawCellIcon(gc, pendingIcon);
      gc.cache.restore();
    }
  }

  if (clip) gc.cache.restore();
}
