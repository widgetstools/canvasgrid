import { CGrid, type CGridOptions, type CellPainter } from 'cgrid';
import type { Position } from './stomp';

/**
 * `pnlPill` — custom painter registered via `grid.registerCellRenderer`.
 * Paints a coloured rounded-rect pill behind the formatted value:
 * positive → green, negative → red, zero → neutral. Honors
 * `cellRendererParams.padX` so the demo can tune the pill inset.
 */
const pnlPill: CellPainter = {
  paint(gc, p) {
    const n = typeof p.value === 'number' ? p.value : Number(p.value);
    const params = (p.params ?? {}) as { padX?: number };
    const padX = params.padX ?? 6;
    const padY = 3;
    const x = p.bounds.x + padX;
    const y = p.bounds.y + padY;
    const w = Math.max(0, p.bounds.w - padX * 2);
    const h = Math.max(0, p.bounds.h - padY * 2);
    const fill = !Number.isFinite(n) || n === 0
      ? 'rgba(128,128,128,0.35)'
      : n > 0 ? 'rgba(46,160,67,0.45)' : 'rgba(220,70,70,0.45)';
    if (p.bg !== p.prefillColor) {
      gc.cache.fillStyle = p.bg;
      gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    }
    gc.cache.fillStyle = fill;
    gc.fillRect(x, y, w, h);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    gc.cache.textAlign = 'right';
    gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - padX - 2, p.bounds.y + p.bounds.h / 2);
  },
};

/** Demo bootstrap options. All flags default off so the demo opens
 *  clean (uniform rows, no decorative cell backgrounds). E2E specs
 *  that depend on the variant features opt in via the URL:
 *
 *   - `?editType=fullRow` — full-row edit mode (Cycle 5 / Task 10)
 *   - `?variableHeights=1` — `getRowHeight` returns 56px for ~25% of
 *     rows (Cycle 5 / Task 6's variableHeights.spec.ts)
 *   - `?autoHeight=1` — `notes` column flips to `autoHeight: true` +
 *     `wrapText: true` (Cycle 5 / Task 8 + 9's autoHeight.spec.ts +
 *     wrapText.spec.ts)
 *   - `?cellClassDemo=1` — re-enables the Cycle 6 / Task 7 demo
 *     surfaces: `cellClassRules` (positive/negative bg on Total) +
 *     `cellClass: 'warning'` (pale-yellow bg on Daily). Off by
 *     default so the default demo isn't visually busy. */
export interface PositionsGridOptions {
  editType?: 'fullRow';
  variableHeights?: boolean;
  autoHeight?: boolean;
  cellClassDemo?: boolean;
}

/** Cycle 7 / Task 8 — toolbar-driven external filter state. The
 *  `isExternalFilterPresent` / `doesExternalFilterPass` callbacks close
 *  over this module-level toggle so flipping it via
 *  `setPositiveOnlyFilter(true)` activates the worker round-trip on the
 *  next `grid.onFilterChanged('externalFilter')`. Module-scoped (rather
 *  than per-grid) because the demo only ever creates one grid; a more
 *  permissive shape lands when Cycle 22 introduces the option-bag
 *  builder. */
let positiveOnlyExternalFilter = false;

/** Cycle 7 / Task 8 — flip the demo's "show only positive P&L" filter
 *  and re-trigger the pipeline. Exposed so the toolbar checkbox in
 *  main.ts can drive the grid without reaching into private state. */
export function setPositiveOnlyFilter(grid: CGrid<Position>, value: boolean): void {
  positiveOnlyExternalFilter = value;
  grid.onFilterChanged('externalFilter');
}

export function createPositionsGrid(
  container: HTMLElement,
  opts: PositionsGridOptions = {},
): CGrid<Position> {
  // Cycle 6 / Task 6 — named column-type bundle. Columns referencing
  // `type: 'money'` pick up the numeric cellDataType (drives the default
  // right-aligned halign) plus a shared currency formatter so the two
  // dollar-valued columns render identically without each one repeating
  // the formatter on the column def.
  const moneyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const columnTypes: NonNullable<CGridOptions<Position>['columnTypes']> = {
    money: {
      cellDataType: 'number',
      valueFormatter: ({ value }) =>
        value == null || Number.isNaN(Number(value))
          ? ''
          : moneyFormatter.format(Number(value)),
    },
  };

  const options: CGridOptions<Position> = {
    columnTypes,
    // Cycle 7 / Task 1 — turn on the floating-filter row so the
    // cycle7-floatingFilter E2E has a typing target. Per-column
    // `floatingFilter: false` opts an individual column out of the row
    // without collapsing the row itself.
    defaultColDef: { floatingFilter: true },
    floatingFilter: true,
    columnDefs: [
      // Cycle 6 / Task 1: positionId opts out of drag-reorder. Pinned-left
      // is already a strong visual signal that this column shouldn't move;
      // suppressMovable enforces it for the UI without binding the
      // imperative moveColumnByIndex API.
      // Cycle 6 / Task 3: suppressSizeToFit holds positionId at its
      // declared width during a Fit-columns pass — the identifier column
      // shouldn't shrink to absorb container width.
      { field: 'positionId',     headerName: 'Position ID',  width: 150, pinned: 'left', suppressMovable: true, suppressSizeToFit: true },
      // Cycle 5 Task 2: cusip carries the text-editor E2E coverage now that
      // ticker hosts the select editor.
      // Cycle 6 / Task 4: suppressAutoSize holds cusip at its declared
      // width during an Autosize-all pass — identifier columns shouldn't
      // grow/shrink based on the sampled rows' content.
      // Cycle 7 / Task 5 — text-filter popup demo target. caseSensitive
      // false so the popup checkbox defaults to off; trimInput true so
      // accidental whitespace around a typed CUSIP doesn't fail to match.
      // textFormatter unset — cusips already arrive case-stable from the
      // STOMP server, no normalisation needed.
      {
        field: 'cusip', headerName: 'CUSIP', width: 110, pinned: 'left',
        editable: true, suppressAutoSize: true,
        filter: 'text',
        filterParams: { caseSensitive: false, trimInput: true },
      },
      // Cycle 5 Task 2: ticker exercises the 'select' editor; the values list
      // is fixed for the demo so the E2E can pick a known entry.
      // Cycle 7 / Task 9 — ticker is the demo's only stable categorical
      // column (tradeDate / expiryDate / notes / confirmed are
      // user-edited synthetic fields; cusip uses filter: 'text'), so it
      // hosts the set-filter popup demo.
      {
        field: 'ticker', headerName: 'Ticker', width: 100, editable: true,
        cellEditor: 'select',
        cellEditorParams: { values: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'TSLA', 'META'] },
        filter: 'set',
      },
      // Cycle 5 Task 2: notionalAmount exercises the 'number' editor; min/precision
      // enforce non-negative two-decimal commits.
      // Cycle 6 / Task 1: lockPosition: 'right' pins notionalAmount to the
      // end of the flat visible-leaf order. A drag-attempt that would push
      // it earlier clamps to the last index instead of throwing.
      // Cycle 6 / Task 6 — shared `money` columnTypes bundle (declared
      // above) supplies cellDataType + valueFormatter, so both
      // dollar-valued columns format identically without repeating the
      // formatter per col-def.
      {
        // Cycle 7 / Task 3 — explicit `filter: 'number'` lights up the
        // number-filter popup behind the floating-filter expand button.
        // `filterParams.buttons` / `closeOnApply` keep the default surface
        // (Apply / Clear / Reset, close-on-apply: true).
        field: 'notionalAmount', headerName: 'Notional', type: 'money', width: 130, aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellEditorParams: { min: 0, precision: 2 },
        lockPosition: 'right',
        filter: 'number',
      },
      { field: 'marketValue',    headerName: 'Market Value',  type: 'money', width: 130, aggFunc: 'sum', filter: 'number' },
      { field: 'currentPrice',   headerName: 'Price',         type: 'number', width: 100, aggFunc: 'avg', filter: 'number' },
      {
        groupId: 'pnl', headerName: 'P&L',
        children: [
          // Total uses the pnlPill renderer for its pill-shaped fill.
          // The cell background stays at the theme default — the pill
          // colour already encodes positive/negative.
          {
            field: 'pnl', headerName: 'Total', type: 'number', width: 110, pinned: 'right',
            aggFunc: 'sum',
            cellRenderer: 'pnlPill',
            cellRendererParams: { padX: 4 },
            // Cycle 6 / Task 7 — cellClassRules opt-in: positive →
            // pale-green bg, negative → pale-red bg. Off by default;
            // `?cellClassDemo=1` re-enables.
            ...(opts.cellClassDemo ? {
              cellClassRules: {
                positive: (p: { value: unknown }) => typeof p.value === 'number' && p.value > 0,
                negative: (p: { value: unknown }) => typeof p.value === 'number' && p.value < 0,
              },
            } : {}),
            // Cycle 7 / Task 6 — multi-condition popup. Two condition rows
            // joined by AND / OR. Demonstrates expressions like
            // "greaterThan 0 OR lessThan -1000".
            filter: 'number',
            filterParams: { maxNumConditions: 2, defaultJoinOperator: 'AND' },
          },
          // cellRendererSelector: positive → pnlPill, negative or zero →
          // default 'number' renderer. Demonstrates the per-cell override.
          {
            field: 'dailyPnl', headerName: 'Daily', type: 'number', width: 110,
            aggFunc: 'sum',
            // Cycle 6 / Task 7 — static `cellClass: 'warning'` opt-in
            // (pale-yellow bg). Off by default; `?cellClassDemo=1`
            // re-enables.
            ...(opts.cellClassDemo ? { cellClass: 'warning' } : {}),
            cellRendererSelector: (p) => {
              const n = typeof p.value === 'number' ? p.value : Number(p.value);
              return Number.isFinite(n) && n > 0 ? { component: 'pnlPill' } : undefined;
            },
          },
          { field: 'unrealizedPnl', headerName: 'Unrealized', type: 'number', width: 110, aggFunc: 'sum' },
        ],
      },
      { field: 'yield',  headerName: 'Yield',  type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'spread', headerName: 'Spread', type: 'number', width: 90,  aggFunc: 'avg' },
      { field: 'dv01',   headerName: 'DV01',   type: 'number', width: 100, aggFunc: 'sum' },
      { field: 'pv01',   headerName: 'PV01',   type: 'number', width: 100, aggFunc: 'sum' },
      // Cycle 5 Task 2: synthetic columns so the remaining four built-in
      // editors (dateString, date, largeText, checkbox) have a click target
      // in the demo. The fields are not sent by STOMP — they start empty and
      // persist user edits via the default valueSetter path.
      {
        // Cycle 7 / Task 1 (parser enhancement) — `filter: 'date'` routes
        // the floating-filter input through the date-aware parser
        // (>YYYY-MM-DD, A..B, CSV, AND/OR).
        field: 'tradeDate', headerName: 'Trade Date', width: 120, editable: true,
        cellEditor: 'dateString',
        filter: 'date',
      },
      {
        field: 'expiryDate', headerName: 'Expiry', width: 120, editable: true,
        cellEditor: 'date',
        filter: 'date',
      },
      // Notes column — fixed-height by default; the autoHeight +
      // wrapText behaviors opt in via `?autoHeight=1` so the
      // autoHeight.spec.ts and wrapText.spec.ts E2Es still have a
      // target while the default demo stays uniform.
      {
        field: 'notes', headerName: 'Notes', width: 200, editable: true,
        cellEditor: 'largeText',
        cellEditorParams: { rows: 6, cols: 40, maxLength: 500 },
        ...(opts.autoHeight ? { autoHeight: true, wrapText: true } : {}),
      },
      {
        field: 'confirmed', headerName: 'Conf.', width: 70, editable: true,
        cellEditor: 'checkbox',
      },
    ],
    getRowId: (row) => row.positionId,
    rowSelection: 'multiple',
    enableCellChangeFlash: true,
    cellFlashDuration: 500,
    cellFadeDuration: 800,
    asyncTransactionWaitMillis: 50,
    theme: 'cg-theme-quartz-dark',
    // Cycle 5 / Task 4 — turn on the click + key edit-triggers so the
    // editing.triggers E2E can exercise singleClickEdit and
    // enterNavigatesVerticallyAfterEdit. stopEditingWhenCellsLoseFocus
    // is opted-out to keep the existing Esc-cancels-without-writing E2E
    // honest (clicking the input would otherwise commit on focusout).
    singleClickEdit: true,
    enterNavigatesVerticallyAfterEdit: true,
    // Cycle 5 / Task 5 — Excel-style arrow-commit. Type-to-edit starts in
    // 'enter' mode; ArrowDown/Up/Left/Right commit + move focus to the
    // adjacent cell. F2, dblclick, single-click and api.startEditingCell
    // start in 'edit' mode so arrows still move the input caret.
    enableExcelEditing: true,
    // Default: uniform rows. `?variableHeights=1` re-enables the
    // Cycle 5 / Task 6 `getRowHeight` rule (56px for positionIds
    // whose last char-code is divisible by 4) so the
    // variableHeights.spec.ts E2E still has a target.
    ...(opts.variableHeights ? {
      getRowHeight: ({ data }) => {
        const id = (data as { positionId?: string } | null)?.positionId;
        if (!id) return null;
        const last = id.charCodeAt(id.length - 1);
        return last % 4 === 0 ? 56 : null;
      },
    } : {}),
    // Cycle 5 / Task 10 — full-row edit. Opt-in via `?editType=fullRow`
    // (main.ts reads the URL). Triggering an edit on any editable cell
    // opens N editors at once; Tab cycles within the row, Enter commits
    // all, Esc cancels all.
    ...(opts.editType ? { editType: opts.editType } : {}),
    // Cycle 7 / Task 8 — external filter wiring. The "show only positive
    // P&L" toolbar checkbox flips the module-level `positiveOnlyExternalFilter`
    // toggle via `setPositiveOnlyFilter`; on the next
    // `onFilterChanged('externalFilter')` the worker pushes the candidate
    // rowIds back to main, where this predicate filters on the pnl field.
    // Always present even when the toggle is off — `isExternalFilterPresent`
    // returning false short-circuits the round-trip without re-registering.
    isExternalFilterPresent: () => positiveOnlyExternalFilter,
    doesExternalFilterPass: ({ data }) => typeof data.pnl === 'number' && data.pnl > 0,
  };
  const grid = new CGrid<Position>(container, options);
  grid.registerCellRenderer('pnlPill', pnlPill);
  return grid;
}
