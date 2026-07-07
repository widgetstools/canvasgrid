/**
 * cgrid-ext demo — live-STOMP testbed for `@cgrid/ext`.
 *
 * ZERO feature code lives here: this app is a plain consumer that
 * instantiates CGridExt (the batteries-included kernel + extension shell)
 * and pipes in the stomp-view-server feed (ws://localhost:8081 — run it
 * from /Users/develop/wfh/starui/apps/stomp-view-server). The grid must
 * render — shell, title bar, Settings + Save — even if the feed never
 * connects; STOMP errors only affect data, never the mount. If something
 * can't be done through the public @cgrid/ext / @cgrid/kernel API, that's a
 * gap to fix upstream, never worked around here.
 */
import { CGridExt } from '@cgrid/ext';
import type { CColDef } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { connectStomp, type Position } from './stomp';

const num = (headerName: string, field: keyof Position, extra: Partial<CColDef<Position>> = {}): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'number',
  ...extra,
});

const columnDefs: CColDef<Position>[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', pinned: 'left', width: 130 },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 90 },
  { colId: 'cusip', field: 'cusip', headerName: 'CUSIP', cellDataType: 'text', width: 110 },
  num('Notional', 'notionalAmount'),
  num('Mkt Value', 'marketValue'),
  num('Price', 'currentPrice'),
  num('P&L', 'pnl'),
  num('Daily P&L', 'dailyPnl'),
  num('Unrealized', 'unrealizedPnl'),
  num('Yield', 'yield'),
  num('Spread', 'spread'),
  num('DV01', 'dv01'),
  num('PV01', 'pv01'),
];

const app = document.querySelector<HTMLDivElement>('#app')!;

const ext = new CGridExt<Position>(app, {
  gridId: 'ext-demo',
  persistState: true,
  getRowId: (r) => r.positionId,
  columnDefs,
  theme: 'cg-theme-starui-dark',
  defaultColDef: { resizable: true, sortable: true, flex: 1, minWidth: 80 },
});

// Expose for console poking + the hermetic E2E suite (Task 11).
(window as unknown as { __ext: unknown }).__ext = ext;

// ─── STOMP feed ──────────────────────────────────────────────────────────
// The shell (title bar, Settings, Save) is already mounted above and stays
// visible regardless of feed state; connectStomp's onPhase('error') only
// ever affects these console logs, never the grid mount.
connectStomp({
  onPhase: (phase) => { console.info(`[cgrid-ext-demo] stomp phase: ${phase}`); },
  onSnapshot: (rows) => { ext.setRowData(rows); },
  onLiveUpdate: (updates) => { ext.grid.applyTransactionAsync({ update: updates }); },
});
