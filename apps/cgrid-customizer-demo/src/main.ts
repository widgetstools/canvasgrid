/**
 * cgrid Customizer Demo — Cycle 21i interactive testbed.
 *
 * ZERO feature code lives here: this app is a plain consumer that
 * instantiates CGrid with the features under test enabled and pipes in the
 * stomp-view-server feed (ws://localhost:8081 — run it from
 * /Users/develop/wfh/starui/apps/stomp-view-server). If something can't be
 * done through the public API, that's a kernel gap to fix in the kernel,
 * never worked around here.
 */
import { CGrid, type CColDef } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { connectStomp, STOMP_PUBLISH_RATE_PER_SEC, type Position } from './stomp';

const DESKS = ['RATES', 'CREDIT', 'FX', 'EQD'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes'];

/** Deterministic categoricals derived from positionId so grouping/pivot
 *  demos have stable dimensions across snapshots and live updates. */
function decorateWithCategoricals(row: Position): Position {
  let h = 0;
  for (let i = 0; i < row.positionId.length; i++) {
    h = (h * 31 + row.positionId.charCodeAt(i)) >>> 0;
  }
  row.desk = DESKS[h % DESKS.length];
  row.region = REGIONS[(h >>> 2) % REGIONS.length];
  row.currency = CURRENCIES[(h >>> 4) % CURRENCIES.length];
  row.trader = TRADERS[(h >>> 6) % TRADERS.length];
  return row;
}

const num = (headerName: string, field: keyof Position, extra: Partial<CColDef<Position>> = {}): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'number',
  enableValue: true,
  valueFormatter: '#,##0.00',
  ...extra,
});

const cat = (headerName: string, field: keyof Position): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'text',
  enableRowGroup: true,
  enablePivot: true,
});

const columnDefs: CColDef<Position>[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', pinned: 'left', width: 130 },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', enableRowGroup: true, enablePivot: true, width: 90 },
  { colId: 'cusip', field: 'cusip', headerName: 'CUSIP', cellDataType: 'text', width: 110 },
  cat('Desk', 'desk'),
  cat('Region', 'region'),
  cat('Ccy', 'currency'),
  cat('Trader', 'trader'),
  num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
  num('Mkt Value', 'marketValue', { valueFormatter: '#,##0', aggFunc: 'sum' }),
  num('Price', 'currentPrice'),
  num('P&L', 'pnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)' }),
  num('Daily P&L', 'dailyPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)' }),
  num('Unrealized', 'unrealizedPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)' }),
  num('Yield', 'yield', { valueFormatter: '0.000' }),
  num('Spread', 'spread'),
  num('DV01', 'dv01', { aggFunc: 'sum' }),
  num('PV01', 'pv01', { aggFunc: 'sum' }),
];

const appEl = document.querySelector<HTMLDivElement>('.app')!;
const gridHost = document.getElementById('grid')!;
const themeBtn = document.getElementById('theme')!;
const resetBtn = document.getElementById('reset-state')!;
const statusPhase = document.querySelector<HTMLElement>('[data-testid="status-phase"]')!;
const statusRows = document.querySelector<HTMLElement>('[data-testid="status-rows"]')!;
const statusUps = document.querySelector<HTMLElement>('[data-testid="status-ups"]')!;

const savedTheme = localStorage.getItem('custdemo:theme');
let dark = savedTheme !== 'light';

const grid = new CGrid<Position>(gridHost, {
  gridId: 'customizer-demo',
  persistState: true,
  getRowId: (r) => r.positionId,
  columnDefs,
  theme: dark ? 'cg-theme-quartz-dark' : 'cg-theme-quartz',
  defaultColDef: { resizable: true, sortable: true, flex: 1, minWidth: 80 },
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions'] },
  enableCellChangeFlash: true,
  cellSelection: {},
});

// The format compiler registers after construction; re-issue the defs so
// string valueFormatters ('#,##0.00', '[Red]…') compile through the DSL.
wireFormat(grid);
grid.updateGridOptions({ columnDefs });

function applyTheme() {
  appEl.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.textContent = dark ? 'Light theme' : 'Dark theme';
  grid.setGridOption('theme', dark ? 'cg-theme-quartz-dark' : 'cg-theme-quartz');
  localStorage.setItem('custdemo:theme', dark ? 'dark' : 'light');
}
applyTheme();
themeBtn.addEventListener('click', () => { dark = !dark; applyTheme(); });

resetBtn.addEventListener('click', () => {
  grid.clearPersistedState();
  location.reload();
});

// ─── STOMP feed ──────────────────────────────────────────────────────────
let updatesThisSecond = 0;
setInterval(() => {
  statusUps.textContent = `${updatesThisSecond} of ${STOMP_PUBLISH_RATE_PER_SEC} upd/s`;
  updatesThisSecond = 0;
}, 1000);

connectStomp({
  onPhase: (phase) => { statusPhase.textContent = phase; },
  onSnapshot: (rows) => {
    rows.forEach(decorateWithCategoricals);
    grid.setRowData(rows);
    statusRows.textContent = `Rows: ${rows.length.toLocaleString()}`;
  },
  onLiveUpdate: (updates) => {
    updates.forEach(decorateWithCategoricals);
    grid.applyTransactionAsync({ update: updates });
    updatesThisSecond += updates.length;
  },
});

// Console access for poking at the public API while testing.
(window as unknown as { __cgrid: unknown }).__cgrid = grid;
(window as unknown as { __cgridReady: boolean }).__cgridReady = true;
