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

export function createPositionsGrid(container: HTMLElement): CGrid<Position> {
  const options: CGridOptions<Position> = {
    columnDefs: [
      { field: 'positionId',     headerName: 'Position ID',  width: 150, pinned: 'left' },
      // Cycle 5 Task 2: cusip carries the text-editor E2E coverage now that
      // ticker hosts the select editor.
      { field: 'cusip',          headerName: 'CUSIP',         width: 110, pinned: 'left', editable: true },
      // Cycle 5 Task 2: ticker exercises the 'select' editor; the values list
      // is fixed for the demo so the E2E can pick a known entry.
      {
        field: 'ticker', headerName: 'Ticker', width: 100, editable: true,
        cellEditor: 'select',
        cellEditorParams: { values: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA', 'TSLA', 'META'] },
      },
      // Cycle 5 Task 2: notionalAmount exercises the 'number' editor; min/precision
      // enforce non-negative two-decimal commits.
      {
        field: 'notionalAmount', headerName: 'Notional', type: 'number', width: 130, aggFunc: 'sum',
        editable: true,
        cellEditor: 'number',
        cellEditorParams: { min: 0, precision: 2 },
      },
      { field: 'marketValue',    headerName: 'Market Value',  type: 'number', width: 130, aggFunc: 'sum' },
      { field: 'currentPrice',   headerName: 'Price',         type: 'number', width: 100, aggFunc: 'avg' },
      {
        groupId: 'pnl', headerName: 'P&L',
        children: [
          // Static cellRenderer + cellRendererParams: every Total cell paints
          // as a pill, padX wires through to the painter.
          {
            field: 'pnl', headerName: 'Total', type: 'number', width: 110, pinned: 'right',
            aggFunc: 'sum',
            cellRenderer: 'pnlPill',
            cellRendererParams: { padX: 4 },
          },
          // cellRendererSelector: positive → pnlPill, negative or zero →
          // default 'number' renderer. Demonstrates the per-cell override.
          {
            field: 'dailyPnl', headerName: 'Daily', type: 'number', width: 110,
            aggFunc: 'sum',
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
        field: 'tradeDate', headerName: 'Trade Date', width: 120, editable: true,
        cellEditor: 'dateString',
      },
      {
        field: 'expiryDate', headerName: 'Expiry', width: 120, editable: true,
        cellEditor: 'date',
      },
      {
        field: 'notes', headerName: 'Notes', width: 140, editable: true,
        cellEditor: 'largeText',
        cellEditorParams: { rows: 6, cols: 40, maxLength: 500 },
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
  };
  const grid = new CGrid<Position>(container, options);
  grid.registerCellRenderer('pnlPill', pnlPill);
  return grid;
}
