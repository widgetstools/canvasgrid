import { migrateLegacyPersistence } from '@wellsfargo-starui/vg-new-appdata';
import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';
import { VelocityGridExtShell } from '@wellsfargo-starui/vg-new-ext';
import { StompPerspectiveProvider, type PositionRow } from '@wellsfargo-starui/vg-new-perspective';

migrateLegacyPersistence();

const params = new URLSearchParams(location.search);
const engine = params.get('engine') === 'wasm' ? 'wasm' as const : 'memory' as const;
const feed = params.get('feed') === 'seed' ? 'seed' as const : 'stomp' as const;

const WS_URL = (import.meta.env.VITE_STOMP_URL as string | undefined) ?? 'ws://localhost:8082';
const CLIENT_ID = (import.meta.env.VITE_STOMP_CLIENT_ID as string | undefined) ?? 'TRADER001';
const LIVE_RATE = Number(import.meta.env.VITE_STOMP_RATE ?? 40) || 40;
const BATCH = Number(import.meta.env.VITE_STOMP_BATCH ?? 200) || 200;
const SNAPSHOT_ROWS = Number(import.meta.env.VITE_STOMP_ROWS ?? 10_000) || 10_000;

const statusEl = document.getElementById('status');
const paintStatus = (phase: string): void => {
  if (!statusEl) return;
  const cls = phase === 'live' ? 'ok' : phase === 'error' ? 'err' : '';
  statusEl.innerHTML = [
    `<span class="${cls}">phase <b>${phase}</b></span>`,
    `<span>feed <b>${feed}</b></span>`,
    feed === 'stomp' ? `<span>broker <b>${WS_URL}</b></span>` : '',
    `<span>engine <b>${engine}</b></span>`,
  ].filter(Boolean).join('');
};

const provider = new StompPerspectiveProvider({
  providerId: 'positions-live',
  feed,
  engine,
  snapshotRows: feed === 'stomp' ? SNAPSHOT_ROWS : 2000,
  label: 'Positions',
  wsUrl: WS_URL,
  clientId: CLIENT_ID,
  snapshotTopic: `/snapshot/positions/${CLIENT_ID}`,
  triggerTopic: `/snapshot/positions/${CLIENT_ID}/${LIVE_RATE}/${BATCH}`,
  snapshotEndToken: 'Success',
  keyColumn: 'positionId',
  rate: LIVE_RATE,
  batchSize: BATCH,
  onPhase: paintStatus,
});
paintStatus(provider.bookRef.getPhase());

const root = document.getElementById('root')!;
const shellHost = document.createElement('div');
shellHost.style.flex = '1';
shellHost.style.minHeight = '0';
root.appendChild(shellHost);

const groupBy = (params.get('groupBy') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let api: ReturnType<VelocityGrid<PositionRow>['getApi']> | null = null;
const shell = new VelocityGridExtShell(shellHost, {
  gridId: 'new-perspective-ssrm',
  title: groupBy.length
    ? `Perspective SSRM · groupBy ${groupBy.join(' › ')}`
    : feed === 'stomp'
      ? 'Perspective SSRM · STOMP'
      : 'Perspective SSRM · seed',
  getGridApi: () => {
    if (!api) throw new Error('grid not ready');
    return api;
  },
});

const opts = provider.gridOptions();
const grid = new VelocityGrid<PositionRow>(shell.getGridHost(), {
  ...opts,
  defaultColDef: { resizable: true, sortable: true, minWidth: 80, floatingFilter: true, filter: true },
  enableCellChangeFlash: true,
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters'] },
  onGridReady: (gridApi) => {
    provider.attach(grid);
    gridApi.applyFormatPatch({ colIds: ['pnl', 'dailyPnl'], format: '0.00', align: 'right' });
    gridApi.setStyleRules([
      { id: 'loss', expression: '[pnl] < 0', style: { color: '#b42318' }, colIds: ['pnl'] },
      { id: 'gain', expression: '[pnl] > 1000', style: { color: '#027a48' }, colIds: ['pnl'] },
    ]);
    if (groupBy.length) {
      gridApi.setRowGroupColumns(groupBy);
      const tryExpand = (): void => {
        gridApi.expandAll();
        if (gridApi.getRowCount() <= groupBy.length) {
          setTimeout(tryExpand, 40);
        }
      };
      setTimeout(tryExpand, 40);
    }
  },
});
api = grid.getApi();

(window as unknown as {
  __provider: StompPerspectiveProvider;
  __gridApi: typeof api;
}).__provider = provider;
(window as unknown as { __gridApi: typeof api }).__gridApi = api;
