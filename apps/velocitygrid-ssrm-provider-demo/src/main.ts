/**
 * SSRM + DataProvider demo, on VelocityGridExt.
 *
 * Same catalog entry shape as the CSRM demo, but `rowModel: 'serverSide'`
 * routes it to Perspective instead of the hub. Perspective owns the book —
 * filter, sort, group, aggregate and the pivot cross-tab all run in WASM, and
 * the grid only ever holds the rows it paints.
 *
 * Provider wiring is Ext's `perspectiveDataProviderModule`: Customize → Data
 * lists the catalog, Apply maps the STOMP config onto StompPerspectiveProvider
 * and binds it as the SSRM datasource, and "Edit…" opens the real DataProvider
 * editor in a popout.
 */
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  perspectiveDataProviderModule,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import {
  LocalStorageConfigBackend,
  registerDefaultTransports,
} from '@wellsfargo-starui/velocity-grid-data';
import { LocalStore } from '@wellsfargo-starui/velocity-grid-data/storage';
import {
  PerspectiveDataProviderController,
  type BookTelemetry,
} from '@wellsfargo-starui/velocity-grid-perspective';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import {
  buildSsrmProviderConfig, createDemoAppData, ensureSeeded, SSRM_PROVIDER_ID,
} from '@demo/providerCatalog';
import { DEMO_THEME, mountShell } from '@demo/shell';
import '@demo/styles.css';

registerDefaultTransports();

const { host, setStatus } = mountShell({
  title: 'SSRM + DataProvider',
  mode: 'serverSide',
});

const storage = new LocalStore();
const catalog = new LocalStorageConfigBackend({ storage });

function paintTelemetry(t: BookTelemetry): void {
  const cls = t.phase === 'live' ? 'ok' : t.phase === 'error' ? 'err' : '';
  setStatus(
    [
      `phase <b>${t.phase}</b>`,
      `book <b>${t.bookSize.toLocaleString()}</b>`,
      `rows/s <b>${t.liveUpdatesPerSec.toLocaleString()}</b>`,
      `getRows <b>${t.getRowsTotal.toLocaleString()}</b>`,
    ].join(' · '),
    cls,
  );
}

const demoAppData = createDemoAppData();

const dataController = new PerspectiveDataProviderController({
  catalog,
  // Resolves {{session.trader}} in the catalog topics — both row models.
  appData: demoAppData,
  onTelemetry: paintTelemetry,
  onActiveChange: (providerId) => {
    if (!providerId) setStatus('no provider — Customize → Data → Apply', 'err');
  },
});

let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const ext = new VelocityGridExt(host, {
  gridId: 'ssrm-provider-demo',
  theme: DEMO_THEME,
  columnDefs: [],
  defaultColDef: {
    resizable: true, sortable: true, editable: true,
    minWidth: 80, filter: true, floatingFilter: true,
  },
  getRowId: (r: { positionId?: string }) => String(r.positionId ?? ''),
  rowModelType: 'serverSide',
  // Sparse: Perspective owns the query, pivot cross-tab included. Never
  // hydrate the whole book into the client — that is the point of SSRM.
  serverSideEnableClientSidePipeline: false,
  cacheBlockSize: 100,
  serverSideMaxCachedLeafBlocks: 20,
  groupDefaultExpanded: 0,
  enableCellChangeFlash: true,
  cellSelection: { suppressHeader: true },
  sideBar: { toolPanels: ['columns', 'filters'] },
  rowGroupPanelShow: 'always',
  pivotPanelShow: 'always',
  grandTotalRow: 'pinnedBottom',
  groupDisplayType: 'singleColumn',
  ext: {
    storage,
    extensions: [
      ...titleBarExtensions({
        name: 'SSRM · Positions (server-side)',
        date: new Date().toISOString().slice(0, 10),
      }),
      ...ribbonExtensions({ edit: () => editHandle }),
      perspectiveDataProviderModule({ controller: dataController }),
    ],
  },
} as unknown as VelocityGridExtOptions);

wireFormat(ext.grid);
wireCalc(ext.grid);
wireRules(ext.grid);
editHandle = wireEditIntoKernel(ext.grid, {
  // SSRM patches ride the server-side transaction path, not applyTransaction.
  commitUpdates: (rows) => { ext.grid.applyServerSideTransaction({ update: rows }); },
});

void (async () => {
  await ensureSeeded(catalog, buildSsrmProviderConfig());
  await ext.grid.whenReady();
  await ext.reapplyActiveProfile();
  if (!dataController.getActiveProviderId()) {
    await dataController.setActiveProvider(SSRM_PROVIDER_ID, { force: true });
  }
})().catch((err) => {
  console.error('[ssrm-provider-demo] startup failed', err);
  setStatus('startup failed — see console', 'err');
});

(window as unknown as { __demo: unknown }).__demo = {
  ext, get grid() { return ext.grid; }, catalog, storage, dataController,
  providerId: SSRM_PROVIDER_ID,
};

window.addEventListener('beforeunload', () => {
  dataController.detach();
  ext.destroy();
});
