/**
 * Minimal consumer of `@cgrid/perspective` — the whole integration:
 * a provider, a grid built from its options bundle, one `attach` call.
 *
 * Everything else (WASM engine in a SharedWorker, cross-tab shared table,
 * feed leader election + takeover, snapshot/live phases, sparse SSRM
 * windowing, group/sort/filter push-down, live tick fan-out) is inside
 * the provider. `feed: 'stomp'` + `wsUrl` swaps the seed book for a live
 * STOMP feed with the same three lines.
 */
import { CGrid } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { StompPerspectiveProvider } from '@cgrid/perspective';

const provider = new StompPerspectiveProvider({
  feed: 'seed',            // 'stomp' + wsUrl/clientId for a live broker
  snapshotRows: 10_000,
  rate: 40,
  label: 'All positions',
});

const grid = new CGrid(document.getElementById('grid')!, {
  theme: 'cg-theme-quartz-dark',
  ...provider.gridOptions(), // columnDefs + SSRM contract (provider IS the datasource)
});

const detach = provider.attach(grid); // live ticks + group/sort/filter sync

// Dev/e2e drivability.
(window as unknown as { __simple: unknown }).__simple = { provider, grid };

window.addEventListener('beforeunload', () => {
  detach();
  provider.destroy();
  grid.destroy();
});
