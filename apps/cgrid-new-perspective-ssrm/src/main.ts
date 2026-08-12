import { migrateLegacyPersistence } from '@wellsfargo-starui/vg-new-appdata';
import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';
import { VelocityGridExtShell } from '@wellsfargo-starui/vg-new-ext';
import { StompPerspectiveProvider, type PositionRow } from '@wellsfargo-starui/vg-new-perspective';

migrateLegacyPersistence();

const params = new URLSearchParams(location.search);
const engine = params.get('engine') === 'wasm' ? 'wasm' as const : 'memory' as const;

const provider = new StompPerspectiveProvider({
  providerId: 'positions-seed',
  feed: 'seed',
  engine,
  snapshotRows: 2000,
  label: 'Positions',
});

const root = document.getElementById('root')!;
const shellHost = document.createElement('div');
shellHost.style.height = '100%';
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
    : 'Perspective SSRM',
  getGridApi: () => {
    if (!api) throw new Error('grid not ready');
    return api;
  },
});

const opts = provider.gridOptions();
const grid = new VelocityGrid<PositionRow>(shell.getGridHost(), {
  ...opts,
  onGridReady: (gridApi) => {
    provider.attach(grid);
    if (groupBy.length) {
      gridApi.setRowGroupColumns(groupBy);
      // Skeleton ingest is async — expand once known keys land.
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
