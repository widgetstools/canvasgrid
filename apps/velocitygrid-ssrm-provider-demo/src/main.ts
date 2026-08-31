/**
 * SSRM + DataProvider demo.
 *
 * The same catalog entry shape as the CSRM demo, but with
 * `rowModel: 'serverSide'` — which routes it to Perspective instead of the
 * hub. Perspective owns the book (filter / sort / group / aggregate / pivot
 * all run in WASM); the grid only ever holds the rows it is painting.
 *
 * Data path:
 *   catalog config (rowModel: 'serverSide')
 *     → dataProviderConfigToPerspective  (catalog fields → provider config)
 *     → StompPerspectiveProvider          (owns the Perspective Table + feed)
 *     → grid `serverSideDatasource` (+ provider.attach for live ticks)
 *
 * Pivot here is computed by Perspective via `split_by` and pushed to the grid,
 * so it works WITHOUT hydrating the whole book — the point of sparse SSRM.
 */
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import '@wellsfargo-starui/velocity-grid/style.css';
import {
  LocalStorageConfigBackend,
  registerDefaultTransports,
  type DataProviderConfig,
} from '@wellsfargo-starui/velocity-grid-data';
import { LocalStore } from '@wellsfargo-starui/velocity-grid-data/storage';
import {
  StompPerspectiveProvider,
  dataProviderConfigToPerspective,
  type BookTelemetry,
} from '@wellsfargo-starui/velocity-grid-perspective';
import {
  buildSsrmProviderConfig,
  SSRM_PROVIDER_ID,
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
    <h1>SSRM + DataProvider</h1>
    <span class="pd-mode">serverSide</span>
    <button type="button" class="pd-btn" id="edit">Configure provider</button>
    <span class="pd-status" id="status"></span>
  </div>
  <div class="pd-hint">Needs the STOMP fixture: <code>npm run dev:stomp</code> (ws://localhost:8082).</div>
  <div class="pd-main"><div class="pd-grid" id="grid"></div></div>
`;
const gridHost = document.getElementById('grid')!;
const statusEl = document.getElementById('status')!;
const main = app.querySelector('.pd-main') as HTMLElement;

const catalog = new LocalStorageConfigBackend({ storage: new LocalStore() });

let grid: VelocityGrid | null = null;
let provider: StompPerspectiveProvider | null = null;
let detach: (() => void) | null = null;

function paintTelemetry(t: BookTelemetry): void {
  const cls = t.phase === 'live' ? 'ok' : t.phase === 'error' ? 'err' : '';
  statusEl.innerHTML = [
    `<span class="${cls}">phase <b>${t.phase}</b></span>`,
    `<span>book <b>${t.bookSize.toLocaleString()}</b></span>`,
    `<span>rows/s <b>${t.liveUpdatesPerSec.toLocaleString()}</b></span>`,
    `<span>getRows <b>${t.getRowsTotal.toLocaleString()}</b></span>`,
  ].join('');
}

async function applyConfig(cfg: DataProviderConfig): Promise<void> {
  if (cfg.rowModel !== 'serverSide') {
    statusEl.innerHTML =
      '<span class="err">provider is clientSide — open the CSRM demo for this one</span>';
    return;
  }
  detach?.();
  detach = null;
  grid?.destroy();
  grid = null;
  await provider?.destroy();
  provider = null;
  gridHost.replaceChildren();

  const columnDefs = gridColumnsFrom(cfg.config.columnDefinitions ?? []);
  if (columnDefs.length === 0) {
    statusEl.innerHTML = '<span class="err">no columns configured — see the editor’s Columns tab</span>';
    return;
  }

  provider = new StompPerspectiveProvider({
    ...dataProviderConfigToPerspective(cfg),
    onTelemetry: paintTelemetry,
  });

  // `gridOptions()` is the provider's own recommended bundle: it already
  // wires itself as the datasource with the sparse contract
  // (serverSideEnableClientSidePipeline: false) and supplies getRowId from
  // the configured keyColumn. Spread FIRST, then override presentation.
  grid = new VelocityGrid(gridHost, {
    ...provider.gridOptions(),
    columnDefs,
    theme: 'vg-theme-quartz',
    rowSelection: 'multiple',
    sideBar: { toolPanels: ['columns', 'filters'] },
    pivotPanelShow: 'always',
  } as never);

  await grid.whenReady();
  // Live ticks, group/sort/filter push-down, and the pivot cross-tab all ride
  // this attachment — without it the grid renders a static first page.
  detach = provider.attach(grid as never);
}

const drawer = mountEditorDrawer(main, {
  catalog,
  providerId: SSRM_PROVIDER_ID,
  onSaved: (cfg) => {
    if (cfg.providerId !== SSRM_PROVIDER_ID) return;
    void applyConfig(cfg);
  },
});
document.getElementById('edit')!.addEventListener('click', () => drawer.toggle());

void (async () => {
  statusEl.textContent = 'seeding catalog…';
  const cfg = await ensureSeeded(catalog, buildSsrmProviderConfig());
  await applyConfig(cfg);
})();

(window as unknown as { __demo: unknown }).__demo = {
  get grid() { return grid; },
  get provider() { return provider; },
  catalog,
  applyConfig,
};
