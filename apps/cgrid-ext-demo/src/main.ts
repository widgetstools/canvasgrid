/**
 * cgrid-ext demo — live-STOMP testbed for `@cgrid/ext`.
 *
 * ZERO feature code lives here: this app is a plain consumer that
 * instantiates CGridExt (the batteries-included kernel + extension shell)
 * with cgrid's existing tooling enabled — the StarUI theme, the `sideBar`
 * tool panels (Columns / Filters / Grid Options / Column Groups), the
 * row-group panel, formatted + grouped + conditionally-styled columns — and
 * pipes in the stomp-view-server feed (ws://localhost:8081, run it from
 * /Users/develop/wfh/starui/apps/stomp-view-server). The shell mounts even
 * if the feed never connects; STOMP errors only affect data. Anything not
 * doable through the public @cgrid/ext / @cgrid/kernel API is a gap to fix
 * upstream, never worked around here.
 */
import { CGridExt, titleBarExtensions, ribbonExtensions } from '@cgrid/ext';
import { formatPrice32, type CColDef, type CColGroupDef } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireEditIntoKernel } from '@cgrid/edit';
import { wireIntoKernel as wireCalc } from '@cgrid/calc';
import { wireIntoKernel as wireRules } from '@cgrid/rules';
import { connectStomp, type Position } from './stomp';

const DESKS = ['RATES', 'CREDIT', 'FX', 'EQD'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes'];

/** Deterministic categoricals derived from positionId so grouping affordances
 *  (row-group panel, Columns tool panel) have stable dimensions. */
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

/** Mode-aware ± sign colouring via theme tokens (resolved per active theme). */
const signStyle = (p: { value: unknown }) => {
  const n = Number(p.value);
  return Number.isFinite(n) && n !== 0
    ? { fg: n > 0 ? 'var(--cg-pos-color)' : 'var(--cg-neg-color)' }
    : {};
};

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
        openByDefault: true,
        children: [
          num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
          num('Mkt Value', 'marketValue', { valueFormatter: '#,##0', aggFunc: 'sum', columnGroupShow: 'open' }),
        ],
      },
      num('P&L', 'pnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)', cellStyle: signStyle }),
      num('Daily P&L', 'dailyPnl', {
        aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)',
        cellStyle: (p: { value: unknown }) => {
          const n = Number(p.value);
          if (!Number.isFinite(n) || n === 0) return {};
          if (n > 0) {
            return {
              fg: 'var(--cg-pos-color)', fontWeight: 700,
              decorators: [{ position: 'tr', kind: 'emoji', value: '▲', color: 'var(--cg-pos-color)', size: 9 }],
            };
          }
          return {
            fg: 'var(--cg-neg-color)', fontWeight: 700,
            border: { left: { width: 3, style: 'solid', color: 'var(--cg-neg-color)' } },
            decorators: [{ position: 'tr', kind: 'emoji', value: '▼', color: 'var(--cg-neg-color)', size: 9 }],
          };
        },
      }),
    ],
  },
  // 32nds bond price: displayed and edited as `101-16`.
  num('Price', 'currentPrice', {
    cellEditor: 'price32',
    valueFormatter: (p: { value: unknown }) => formatPrice32(p.value as number),
  }),
  num('Unrealized', 'unrealizedPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)', cellStyle: signStyle }),
  {
    groupId: 'risk',
    headerName: 'Risk',
    children: [
      num('DV01', 'dv01', { aggFunc: 'sum' }),
      num('PV01', 'pv01', { aggFunc: 'sum' }),
      num('Yield', 'yield', { valueFormatter: '0.000' }),
      num('Spread', 'spread', { cellStyle: { fg: 'var(--cg-info-color)' } }),
    ],
  },
];

const app = document.querySelector<HTMLDivElement>('#app')!;

const ext = new CGridExt<Position>(app, {
  gridId: 'ext-demo',
  persistState: true,
  getRowId: (r) => r.positionId,
  columnDefs,
  theme: 'cg-theme-starui-dark',
  defaultColDef: { resizable: true, sortable: true, editable: true, flex: 1, minWidth: 80 },
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions', 'columnGroups'] },
  enableCellChangeFlash: true,
  cellSelection: {},
  ext: {
    // Replace the spine's bare Settings/Save with the full MarketsGrid-style
    // title bar (brand, search, notifications, profiles, save, date, settings,
    // overflow). The Grid Options module still opens from the settings icon.
    extensions: [
      { remove: 'settings-launcher' },
      { remove: 'save' },
      ...titleBarExtensions({ name: 'MarketsGrid', date: new Date().toISOString().slice(0, 10) }),
      ...ribbonExtensions(),
    ],
  },
});

// Wire cgrid's engines onto the owned grid: format (compiles the string
// valueFormatters / DSL above), edit (editors + Smart Edit / Bulk Update),
// calc (calculated columns + styling templates), rules (conditional styles).
wireFormat(ext.grid);
wireEditIntoKernel(ext.grid);
wireCalc(ext.grid);
wireRules(ext.grid);
// Re-issue defs so the now-registered format compiler picks up the string
// valueFormatters ('#,##0.00', '[Red]…').
ext.grid.updateGridOptions({ columnDefs });

// Expose for console poking + the hermetic E2E suite.
(window as unknown as { __ext: unknown }).__ext = ext;

// ─── STOMP feed ──────────────────────────────────────────────────────────
// The shell + grid are already mounted above and stay visible regardless of
// feed state; connectStomp's onPhase('error') only affects these logs.
connectStomp({
  onPhase: (phase) => { console.info(`[cgrid-ext-demo] stomp phase: ${phase}`); },
  onSnapshot: (rows) => { rows.forEach(decorateWithCategoricals); ext.setRowData(rows); },
  onLiveUpdate: (updates) => { updates.forEach(decorateWithCategoricals); ext.grid.applyTransactionAsync({ update: updates }); },
});
