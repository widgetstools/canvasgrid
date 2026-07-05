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
import { CGrid, formatPrice32, type CColDef, type CColGroupDef } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireEditIntoKernel } from '@cgrid/edit';
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

// Cycle 21i / Task 5 — seed a couple of NESTED column groups so the new
// "Column Groups" tab opens with real content to inspect/edit. Everything
// else stays flat/ungrouped. Only the placement changed — the underlying
// `num(...)`/`cat(...)` call sites (and their options) are untouched.
const columnDefs: (CColDef<Position> | CColGroupDef<Position>)[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', pinned: 'left', width: 130 },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', enableRowGroup: true, enablePivot: true, width: 90 },
  { colId: 'cusip', field: 'cusip', headerName: 'CUSIP', cellDataType: 'text', width: 110 },
  cat('Desk', 'desk'),
  cat('Region', 'region'),
  cat('Ccy', 'currency'),
  cat('Trader', 'trader'),
  {
    groupId: 'trade',
    headerName: 'Trade',
    openByDefault: true,
    children: [
      {
        groupId: 'valuation',
        headerName: 'Valuation',
        // Task 10 — starts OPEN so the seeded grid shows marketValue by
        // default; the caret's collapse affordance is what hides it.
        openByDefault: true,
        children: [
          num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
          // Task 10 — `columnGroupShow: 'open'` so collapsing "Valuation"
          // has a visible effect (this column drops out of the viewport)
          // and the group header caret has something real to demonstrate.
          num('Mkt Value', 'marketValue', { valueFormatter: '#,##0', aggFunc: 'sum', columnGroupShow: 'open' }),
        ],
      },
      num('P&L', 'pnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)' }),
      num('Daily P&L', 'dailyPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)' }),
    ],
  },
  // Price uses the reference 32nds bond editor: displayed as `101-16`, edited
  // in the same notation. Try it with the Edit trigger set to "Excel-style"
  // in the Grid Options panel — type a digit to enter quick-entry, F2 /
  // double-click to caret-edit, and enter e.g. `101-16+` (half-tick).
  num('Price', 'currentPrice', {
    cellEditor: 'price32',
    valueFormatter: (p: { value: unknown }) => formatPrice32(p.value as number),
  }),
  num('Unrealized', 'unrealizedPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)' }),
  {
    groupId: 'risk',
    headerName: 'Risk',
    children: [
      num('DV01', 'dv01', { aggFunc: 'sum' }),
      num('PV01', 'pv01', { aggFunc: 'sum' }),
      num('Yield', 'yield', { valueFormatter: '0.000' }),
      num('Spread', 'spread'),
    ],
  },
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
  // editable: true so the testbed can exercise the edit trigger (single /
  // double click) out of the box; group / totals / pivot cells stay
  // read-only via the editable predicate.
  defaultColDef: { resizable: true, sortable: true, editable: true, flex: 1, minWidth: 80 },
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions', 'columnGroups'] },
  enableCellChangeFlash: true,
  cellSelection: {},
});

// The format compiler registers after construction; re-issue the defs so
// string valueFormatters ('#,##0.00', '[Red]…') compile through the DSL.
wireFormat(grid);
grid.updateGridOptions({ columnDefs });

// Cycle 21i Phase 2 — wire the edit engine; its settings persist through
// the kernel module-state registry (GridState.modules.editSettings). The
// editing UI returns as SettingsSheet modules in the Phase 3 pivot.
wireEditIntoKernel(grid);


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

// ─── Demo switches ───────────────────────────────────────────────────────
// Live updates: pause/resume applying the STOMP stream to the grid.
let liveUpdates = true;
const liveSwitch = document.getElementById('live-updates') as HTMLInputElement;
liveSwitch.addEventListener('change', () => { liveUpdates = liveSwitch.checked; });

// Editable: toggle defaultColDef.editable so the whole grid becomes
// read-only or editable on demand.
const editableSwitch = document.getElementById('editable') as HTMLInputElement;
editableSwitch.addEventListener('change', () => {
  const dcd = (grid.getGridOption('defaultColDef') ?? {}) as Record<string, unknown>;
  grid.setGridOption('defaultColDef', { ...dcd, editable: editableSwitch.checked });
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
    if (!liveUpdates) return; // paused — drop the batch, keep the grid static
    updates.forEach(decorateWithCategoricals);
    grid.applyTransactionAsync({ update: updates });
    updatesThisSecond += updates.length;
  },
});

// Console access for poking at the public API while testing, and hooks the
// hermetic E2E suite drives (see apps/cgrid-customizer-demo/e2e/). `__cgapi`
// is the object handed to `gridReady` (has `getColumnGroupDefs()` etc.) —
// distinct from `__cgrid`, which is the CGrid instance itself.
(window as unknown as { __cgrid: unknown }).__cgrid = grid;
grid.on('gridReady', (e) => {
  (window as unknown as { __cgapi: unknown }).__cgapi = e.api;
  (window as unknown as { __cgridReady: boolean }).__cgridReady = true;
});
