import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';
import { VelocityGridExtShell } from '@wellsfargo-starui/vg-new-ext';
import {
  DataProviderController,
  LocalStorageConfigBackend,
  openProviderEditorPopout,
  SEED_PROVIDERS,
} from '@wellsfargo-starui/vg-new-data';
import {
  LocalStorageAppDataStore,
  migrateLegacyPersistence,
} from '@wellsfargo-starui/vg-new-appdata';

migrateLegacyPersistence();

type Row = { id: string; desk: string; ticker: string; pnl: number; dailyPnl: number };

const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
  id: `R${i}`,
  desk: i % 2 ? 'EQ' : 'FX',
  ticker: `T${i % 40}`,
  pnl: Math.round((Math.random() - 0.5) * 50000) / 100,
  dailyPnl: Math.round((Math.random() - 0.5) * 10000) / 100,
}));

const root = document.getElementById('root')!;
const shellHost = document.createElement('div');
shellHost.style.height = '100%';
root.appendChild(shellHost);

const appData = new LocalStorageAppDataStore('new-ext-demo');
if (appData.get('env', 'brokerUrl') == null) {
  appData.set('env', 'brokerUrl', 'ws://localhost:61614/ws');
}

const catalog = new LocalStorageConfigBackend();
const dataProvider = new DataProviderController({
  catalog,
  appData,
  onActiveChange: (id) => {
    console.info('[ext-demo] active provider', id);
  },
});

let api: ReturnType<VelocityGrid<Row>['getApi']> | null = null;
const shell = new VelocityGridExtShell(shellHost, {
  gridId: 'new-ext-demo',
  title: 'VelocityGrid New',
  asOfLabel: 'As-of today',
  dataProvider,
  catalog,
  appData: appData.lookup,
  getGridApi: () => {
    if (!api) throw new Error('grid not ready');
    return api;
  },
});
shell.setAlertCount(2);

const grid = new VelocityGrid<Row>(shell.getGridHost(), {
  columnDefs: [
    { field: 'id', width: 80 },
    { field: 'desk', width: 90 },
    { field: 'ticker', width: 90 },
    { field: 'pnl', width: 100 },
    { field: 'dailyPnl', width: 100 },
  ],
  rowData: rows,
  getRowId: (r) => r.id,
  rowSelection: 'multiple',
});
api = grid.getApi();
dataProvider.attachGrid(api as never);

void dataProvider.ensureSeedCatalog(SEED_PROVIDERS).then(() => {
  const active = shell.getSession().getDoc().gridLevelData?.activeProviderId;
  if (active) void dataProvider.setActiveProvider(active);
});

// Seed engines so Customize Apply has something to replace
api.setCalcColumns([{ alias: 'net', expression: '[pnl] + [dailyPnl]', headerName: 'Net' }]);
api.setStyleRules([{
  id: 'neg-pnl',
  expression: '[pnl] < 0',
  style: { color: '#b42318' },
  enabled: true,
}]);
api.setAlertRules([{
  id: 'big-loss',
  expression: '[pnl] < -1000',
  channels: ['toast', 'badge'],
  messageTemplate: 'Large loss',
}]);

const backend = catalog;
window.addEventListener('vg-new:open-provider-editor', () => {
  openProviderEditorPopout(backend);
});
