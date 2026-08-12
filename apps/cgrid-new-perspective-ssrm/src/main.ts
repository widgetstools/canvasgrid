import { VelocityGrid } from '@wellsfargo-starui/vg-new-grid';
import { VelocityGridExtShell } from '@wellsfargo-starui/vg-new-ext';
import { StompPerspectiveProvider, type PositionRow } from '@wellsfargo-starui/vg-new-perspective';

const provider = new StompPerspectiveProvider({
  providerId: 'positions-seed',
  feed: 'seed',
  snapshotRows: 2000,
  label: 'Positions',
});

const root = document.getElementById('root')!;
const shellHost = document.createElement('div');
shellHost.style.height = '100%';
root.appendChild(shellHost);

let api: ReturnType<VelocityGrid<PositionRow>['getApi']> | null = null;
const shell = new VelocityGridExtShell(shellHost, {
  gridId: 'new-perspective-ssrm',
  title: 'Perspective SSRM',
  getGridApi: () => {
    if (!api) throw new Error('grid not ready');
    return api;
  },
});

const opts = provider.gridOptions();
const grid = new VelocityGrid<PositionRow>(shell.getGridHost(), {
  ...opts,
  onGridReady: () => {
    provider.attach(grid);
  },
});
api = grid.getApi();

(window as unknown as { __provider: StompPerspectiveProvider }).__provider = provider;
