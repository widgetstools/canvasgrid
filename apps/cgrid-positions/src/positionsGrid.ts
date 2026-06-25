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

/** Demo bootstrap options. `editType` is forwarded from the URL query
 *  (`?editType=fullRow`) so the Cycle 5 / Task 10 E2E can flip into
 *  full-row mode without changing the default single-cell demo flow. */
export interface PositionsGridOptions {
  editType?: 'fullRow';
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
      { field: 'cusip',          headerName: 'CUSIP',         width: 110, pinned: 'left', editable: true, suppressAutoSize: true },
      // Cycle 5 Task 2: ticker exercises the 'select' editor; the values list
      // is fixed for the demo so the E2E can pick a known entry.
      {
        field: 'ticker', headerName: 'Ticker', width: 100, editable: true,
        cellEditor: 'select',
        cellEditorParams: { values: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'TSLA', 'META'] },
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
        field: 'notionalAmount', headerName: 'Notional', type: 'money', width: 130, aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellEditorParams: { min: 0, precision: 2 },
        lockPosition: 'right',
      },
      { field: 'marketValue',    headerName: 'Market Value',  type: 'money', width: 130, aggFunc: 'sum' },
      { field: 'currentPrice',   headerName: 'Price',         type: 'number', width: 100, aggFunc: 'avg' },
      {
        groupId: 'pnl', headerName: 'P&L',
        children: [
          // Static cellRenderer + cellRendererParams: every Total cell paints
          // as a pill, padX wires through to the painter.
          // Cycle 6 / Task 7 — cellClassRules colour the *cell background*
          // underneath the pill: positive → #e7f7ec, negative → #fde7e9.
          // Both coexist visually — the pill's semi-transparent fill renders
          // on top of the class-driven bg.
          {
            field: 'pnl', headerName: 'Total', type: 'number', width: 110, pinned: 'right',
            aggFunc: 'sum',
            cellRenderer: 'pnlPill',
            cellRendererParams: { padX: 4 },
            cellClassRules: {
              positive: (p: { value: unknown }) => typeof p.value === 'number' && p.value > 0,
              negative: (p: { value: unknown }) => typeof p.value === 'number' && p.value < 0,
            },
          },
          // cellRendererSelector: positive → pnlPill, negative or zero →
          // default 'number' renderer. Demonstrates the per-cell override.
          // Cycle 6 / Task 7 — static cellClass 'warning' for demo coverage
          // of the static-class path (applies a pale-yellow bg to all cells).
          {
            field: 'dailyPnl', headerName: 'Daily', type: 'number', width: 110,
            aggFunc: 'sum',
            cellClass: 'warning',
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
      // Cycle 5 / Task 8 — autoHeight target. main.ts seeds ~1 in 3 rows
      // with a long synthetic description so the worker's measure pass has
      // real wrap content. The largeText editor stays — popup mode is
      // exactly what an autoHeight cell wants when the user edits.
      {
        field: 'notes', headerName: 'Notes', width: 200, editable: true,
        cellEditor: 'largeText',
        cellEditorParams: { rows: 6, cols: 40, maxLength: 500 },
        autoHeight: true,
        // Cycle 5 / Task 9 — paint multi-line wrapped text inside the cell.
        // Combined with autoHeight, the row grows to fit; without autoHeight,
        // the last visible line would truncate with an ellipsis.
        wrapText: true,
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
    // Cycle 5 / Task 6 — variable row heights. A deterministic per-positionId
    // rule that produces a visible mix in the demo viewport: positions whose
    // ID ends with a character code divisible by 4 render 56 px tall, the
    // rest fall back to the grid-level rowHeight. Picks roughly a quarter
    // of rows so the E2E can scan a small window and still find at least
    // one tall + one normal row.
    getRowHeight: ({ data }) => {
      const id = data.positionId;
      if (!id) return null;
      const last = id.charCodeAt(id.length - 1);
      return last % 4 === 0 ? 56 : null;
    },
    // Cycle 5 / Task 10 — full-row edit. Opt-in via `?editType=fullRow`
    // (main.ts reads the URL). Triggering an edit on any editable cell
    // opens N editors at once; Tab cycles within the row, Enter commits
    // all, Esc cancels all.
    ...(opts.editType ? { editType: opts.editType } : {}),
  };
  const grid = new CGrid<Position>(container, options);
  grid.registerCellRenderer('pnlPill', pnlPill);
  return grid;
}
