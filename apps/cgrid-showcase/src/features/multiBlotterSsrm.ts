import { CGrid, type CColDef } from '@cgrid/kernel';
import type { Feature } from './index';
import {
  StompSsrmDataProvider,
  type StompRow,
} from '../data/stompSsrmDataProvider';

/**
 * Multi-blotter SSRM demo — one StompSsrmDataProvider hydrates from
 * stomp-view-server; three CGrid instances use `rowModelType: 'serverSide'`
 * with shared-book datasources (different projections). Scroll is tuned
 * for the lean path: qualityMode performance + defer live txs while scrolling.
 */

const COLUMNS: CColDef<StompRow>[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', cellDataType: 'text', width: 160, filter: 'text', pinned: 'left' },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 90, filter: 'text' },
  { colId: 'desk', field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 130, filter: 'text', enableRowGroup: true },
  { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', width: 100, filter: 'text', enableRowGroup: true },
  { colId: 'instrumentType', field: 'instrumentType', headerName: 'Instrument', cellDataType: 'text', width: 140, filter: 'text' },
  { colId: 'notionalAmount', field: 'notionalAmount', headerName: 'Notional', cellDataType: 'number', width: 120, filter: 'number', aggFunc: 'sum', enableValue: true },
  { colId: 'marketValue', field: 'marketValue', headerName: 'Mkt Value', cellDataType: 'number', width: 120, filter: 'number', aggFunc: 'sum', enableValue: true },
  { colId: 'pnl', field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 100, filter: 'number', aggFunc: 'sum', enableValue: true },
  { colId: 'dailyPnl', field: 'dailyPnl', headerName: 'Daily P&L', cellDataType: 'number', width: 100, filter: 'number', aggFunc: 'sum', enableValue: true },
];

interface BlotterSpec {
  id: string;
  title: string;
  filter?: (row: StompRow) => boolean;
}

const BLOTTERS: BlotterSpec[] = [
  { id: 'all', title: 'All positions' },
  {
    id: 'securitized',
    // Matches values seen on the live stomp feed (e.g. desk "Securitized").
    // Region tokens vary ("AMER" vs "Americas"), so desk is the reliable key.
    title: 'Securitized desk',
    filter: (r) => String(r.desk ?? '').toLowerCase().includes('securit'),
  },
  {
    id: 'winners',
    title: 'Positive P&L',
    filter: (r) => Number(r.pnl) > 0,
  },
];

function qualityFromUrl(): 'auto' | 'quality' | 'performance' {
  const q = new URLSearchParams(window.location.search).get('quality');
  if (q === 'performance' || q === 'quality' || q === 'auto') return q;
  return 'performance';
}

function makeGrid(host: HTMLElement, theme: string, datasource: ReturnType<StompSsrmDataProvider['createDatasource']>): CGrid<StompRow> {
  return new CGrid<StompRow>(host, {
    getRowId: (r: StompRow) => r.positionId,
    columnDefs: COLUMNS,
    theme,
    rowModelType: 'serverSide',
    serverSideDatasource: datasource,
    cacheBlockSize: 100,
    maxConcurrentDatasourceRequests: 2,
    serverSideEnableClientSidePipeline: false,
    qualityMode: qualityFromUrl(),
    deferAsyncTransactionsWhileScrolling: true,
    asyncTransactionConflate: true,
    asyncTransactionWaitMillis: 50,
    asyncTransactionThrottleMillis: 200,
    enableCellChangeFlash: true,
    rowGroupPanelShow: 'always',
    rowBuffer: 5,
  } as never);
}

export const multiBlotterSsrm: Feature = {
  id: 'multiBlotterSsrm',
  label: 'Multi-blotter (SSRM + STOMP)',
  description:
    'Three SSRM blotters share one StompSsrmDataProvider hydrated by stomp-view-server (ws://localhost:8081). ' +
    'Each grid only windows blocks via getRows — scroll uses qualityMode=performance by default (?quality=). ' +
    'Start the view-server first: cd stomp-view-server && npm start.',

  mount(gridHost, controls, theme) {
    gridHost.classList.add('multi-blotter-host');
    gridHost.replaceChildren();

    // Controls first — provider callbacks close over these (avoid TDZ).
    const status = document.createElement('span');
    status.className = 'ctrl-btn';
    status.style.cursor = 'default';
    status.textContent = 'Provider: idle';

    const counter = document.createElement('span');
    counter.className = 'ctrl-btn';
    counter.style.cursor = 'default';
    counter.textContent = 'Book: 0';

    const connectBtn = document.createElement('button');
    connectBtn.className = 'ctrl-btn primary';
    connectBtn.textContent = 'Connect';
    connectBtn.setAttribute('data-testid', 'btn-multi-ssrm-connect');

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'ctrl-btn';
    refreshBtn.textContent = 'Refresh all';

    const qualityHint = document.createElement('span');
    qualityHint.className = 'ctrl-label';
    qualityHint.textContent = `quality=${qualityFromUrl()}`;

    controls.appendChild(connectBtn);
    controls.appendChild(refreshBtn);
    controls.appendChild(status);
    controls.appendChild(counter);
    controls.appendChild(qualityHint);

    const provider = new StompSsrmDataProvider({
      snapshotRows: 10_000,
      rate: 40,
      batchSize: 50,
      updatesPerTick: 5,
      onPhase: (phase) => {
        status.textContent = `Provider: ${phase}`;
        status.style.background =
          phase === 'live' || phase === 'snapshot'
            ? 'rgba(80,200,120,0.18)'
            : 'rgba(255,80,80,0.15)';
      },
      onStats: ({ storeSize, gridCount }) => {
        counter.textContent = `Book: ${storeSize.toLocaleString()} · grids: ${gridCount}`;
      },
    });

    const grids: CGrid<StompRow>[] = [];
    const unsubs: Array<() => void> = [];
    const ready: Array<Promise<void>> = [];

    for (const spec of BLOTTERS) {
      const panel = document.createElement('div');
      panel.className = 'multi-blotter-panel';
      panel.setAttribute('data-testid', `blotter-${spec.id}`);

      const header = document.createElement('div');
      header.className = 'multi-blotter-panel-header';
      header.textContent = spec.title;
      panel.appendChild(header);

      const body = document.createElement('div');
      body.className = 'multi-blotter-panel-body';
      panel.appendChild(body);
      gridHost.appendChild(panel);

      const ds = provider.createDatasource({ filter: spec.filter, label: spec.id });
      const grid = makeGrid(body, theme, ds);
      grids.push(grid);
      unsubs.push(provider.attachGrid(grid, { filter: spec.filter, label: spec.id }));
      ready.push(new Promise<void>((resolve) => {
        const off = grid.on('gridReady', () => {
          off();
          resolve();
        });
      }));
    }

    connectBtn.addEventListener('click', () => {
      if (provider.getPhase() === 'live' || provider.getPhase() === 'snapshot' || provider.getPhase() === 'connecting') {
        provider.disconnect();
        connectBtn.textContent = 'Connect';
      } else {
        provider.connect();
        connectBtn.textContent = 'Disconnect';
      }
    });

    refreshBtn.addEventListener('click', () => {
      for (const g of grids) g.refreshServerSide({ purge: true });
    });

    let cancelled = false;
    void Promise.all(ready).then(() => {
      if (cancelled) return;
      provider.connect();
      connectBtn.textContent = 'Disconnect';
    });

    const primary = grids[0]!;
    const origDestroy = primary.destroy.bind(primary);
    (primary as unknown as { destroy: () => void }).destroy = () => {
      cancelled = true;
      for (const u of unsubs) u();
      provider.destroy();
      for (let i = 1; i < grids.length; i++) {
        try { grids[i]!.destroy(); } catch { /* swallow */ }
      }
      gridHost.classList.remove('multi-blotter-host');
      origDestroy();
    };

    return primary;
  },
};
