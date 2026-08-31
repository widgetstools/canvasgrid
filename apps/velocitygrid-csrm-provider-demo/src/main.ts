/**
 * CSRM + DataProvider demo.
 *
 * Shows the client-side row model fed by a catalog DataProvider, with the
 * real DataProvider editor authoring that catalog entry.
 *
 * Data path:
 *   catalog config (rowModel: 'clientSide')
 *     → ProviderClientAdapter   (SharedWorker hub owns the socket + RowCache)
 *     → toClientSideDataProvider (adapts the hub provider to the kernel contract)
 *     → grid `clientSideDataProvider` option
 *
 * The grid owns the subscription: snapshots full-replace, deltas ride
 * `applyTransactionAsync`. Note there are TWO independent throttle stages —
 * the hub's pipeline (`throttleMs` / `conflateEnabled`, authored in the
 * editor's Pipeline tab) and the grid's own `asyncTransaction*` options set
 * below. Tune the first for wire volume, the second for paint cadence.
 */
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import '@wellsfargo-starui/velocity-grid/style.css';
import {
  LocalStorageConfigBackend,
  ProviderClientAdapter,
  registerDefaultTransports,
  toClientSideDataProvider,
  type DataProviderConfig,
} from '@wellsfargo-starui/velocity-grid-data';
import { LocalStore } from '@wellsfargo-starui/velocity-grid-data/storage';
import {
  buildCsrmProviderConfig,
  CSRM_PROVIDER_ID,
  ensureSeeded,
} from '@demo/providerCatalog';
import { gridColumnsFrom } from '@demo/columns';
import { mountEditorDrawer } from '@demo/editorDrawer';
import '@demo/styles.css';

registerDefaultTransports();

const app = document.getElementById('app')!;
app.className = 'pd-app';
app.innerHTML = `
  <div class="pd-bar">
    <h1>CSRM + DataProvider</h1>
    <span class="pd-mode">clientSide</span>
    <button type="button" class="pd-btn" id="edit">Configure provider</button>
    <span class="pd-status" id="status"></span>
  </div>
  <div class="pd-hint">Needs the STOMP fixture: <code>npm run dev:stomp</code> (ws://localhost:8082).</div>
  <div class="pd-main"><div class="pd-grid" id="grid"></div></div>
`;
const gridHost = document.getElementById('grid')!;
const statusEl = document.getElementById('status')!;
const main = app.querySelector('.pd-main') as HTMLElement;

/** One KV transport shared by the catalog (and, in a real app, ConfigSession). */
const catalog = new LocalStorageConfigBackend({ storage: new LocalStore() });

let grid: VelocityGrid | null = null;
let provider: ProviderClientAdapter | null = null;

function paintStatus(text: string, cls = ''): void {
  statusEl.innerHTML = `<span class="${cls}">${text}</span>`;
}

/**
 * (Re)build the grid for a catalog config. Called on boot and again whenever
 * the editor saves — so changing columns, topics or pipeline knobs is visible
 * without a reload.
 */
async function applyConfig(cfg: DataProviderConfig): Promise<void> {
  if (cfg.rowModel === 'serverSide') {
    paintStatus('provider is serverSide — open the SSRM demo for this one', 'err');
    return;
  }
  // Tear the old pair down first: the grid unsubscribes but never destroys a
  // provider (they're shared), so the provider is ours to dispose.
  grid?.destroy();
  grid = null;
  provider?.destroy();
  provider = null;
  gridHost.replaceChildren();

  const columnDefs = gridColumnsFrom(cfg.config.columnDefinitions ?? []);
  if (columnDefs.length === 0) {
    paintStatus('no columns configured — add some in the editor’s Columns tab', 'err');
    return;
  }

  provider = new ProviderClientAdapter(cfg);
  provider.onStatus((s, err) => {
    paintStatus(
      `provider <b>${s}</b>${err ? ` — ${err}` : ''} · rows <b>${grid?.getTotalRowCount() ?? 0}</b>`,
      s === 'ready' ? 'ok' : s === 'error' ? 'err' : '',
    );
  });

  grid = new VelocityGrid(gridHost, {
    columnDefs,
    getRowId: (r: Record<string, unknown>) => String(r.positionId ?? ''),
    theme: 'vg-theme-quartz',
    rowSelection: 'multiple',
    sideBar: { toolPanels: ['columns', 'filters'] },
    rowGroupPanelShow: 'always',
    pivotPanelShow: 'always',
    grandTotalRow: 'bottom',
    // The provider option — the grid owns the subscription for its lifetime.
    clientSideDataProvider: toClientSideDataProvider(provider),
    // Paint cadence, independent of the hub's own pipeline throttling.
    asyncTransactionWaitMillis: 60,
    asyncTransactionThrottleMillis: 200,
  } as never);

  await grid.whenReady();
  await provider.start();
}

const drawer = mountEditorDrawer(main, {
  catalog,
  providerId: CSRM_PROVIDER_ID,
  onSaved: (cfg) => {
    if (cfg.providerId !== CSRM_PROVIDER_ID) return;
    void applyConfig(cfg);
  },
});
document.getElementById('edit')!.addEventListener('click', () => drawer.toggle());

void (async () => {
  paintStatus('seeding catalog…');
  const cfg = await ensureSeeded(catalog, buildCsrmProviderConfig());
  await applyConfig(cfg);
})();

// Test/debug handle, mirroring the other demos.
(window as unknown as { __demo: unknown }).__demo = {
  get grid() { return grid; },
  get provider() { return provider; },
  catalog,
  applyConfig,
};
