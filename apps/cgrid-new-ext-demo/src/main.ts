import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';
import { VelocityGridExtShell } from '@wellsfargo-starui/vg-new-ext';
import { LocalStorageConfigBackend, openProviderEditorPopout } from '@wellsfargo-starui/vg-new-data';

type Row = { id: string; desk: string; ticker: string; pnl: number };

const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
  id: `R${i}`,
  desk: i % 2 ? 'EQ' : 'FX',
  ticker: `T${i % 40}`,
  pnl: Math.round((Math.random() - 0.5) * 50000) / 100,
}));

const root = document.getElementById('root')!;
const shellHost = document.createElement('div');
shellHost.style.height = '100%';
root.appendChild(shellHost);

let api: ReturnType<VelocityGrid<Row>['getApi']> | null = null;
const shell = new VelocityGridExtShell(shellHost, {
  gridId: 'new-ext-demo',
  title: 'VelocityGrid New',
  getGridApi: () => {
    if (!api) throw new Error('grid not ready');
    return api;
  },
});

const grid = new VelocityGrid<Row>(shell.getGridHost(), {
  columnDefs: [
    { field: 'id', width: 80 },
    { field: 'desk', width: 90 },
    { field: 'ticker', width: 90 },
    { field: 'pnl', width: 100 },
  ],
  rowData: rows,
  getRowId: (r) => r.id,
  rowSelection: 'multiple',
});
api = grid.getApi();

const backend = new LocalStorageConfigBackend();
window.addEventListener('vg-new:open-provider-editor', () => {
  openProviderEditorPopout(backend);
});
