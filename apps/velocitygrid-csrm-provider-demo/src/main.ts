/**
 * CSRM + DataProvider demo, on VelocityGridExt.
 *
 * The client-side row model fed by a catalog DataProvider, with the full Ext
 * chrome (title bar, ribbon, Customize drawer) around it.
 *
 * Provider wiring is Ext's own `dataProviderModule`: Customize → Data lists
 * the catalog, Apply binds the selected provider to the grid through the hub,
 * and "Edit…" opens the real DataProvider editor in a popout. Column defs come
 * from the provider's `columnDefinitions`, so editing the Columns tab and
 * applying is visible in the grid — no hard-coded colDefs here.
 *
 * Note there are TWO independent throttle stages: the hub pipeline
 * (`throttleMs` / `conflateEnabled`, Pipeline tab in the editor) and the
 * grid's `asyncTransaction*` options below. Tune the first for wire volume,
 * the second for paint cadence.
 */
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  dataProviderModule,
  DataProviderController,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import {
  LocalStorageConfigBackend,
  getDataHubTarget,
  registerDefaultTransports,
  type ProviderClientAdapter,
} from '@wellsfargo-starui/velocity-grid-data';
import { LocalStore } from '@wellsfargo-starui/velocity-grid-data/storage';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import {
  buildCsrmProviderConfig, CSRM_PROVIDER_ID, createDemoAppData, ensureSeeded,
} from '@demo/providerCatalog';
import { DEMO_THEME, mountShell } from '@demo/shell';
import '@demo/styles.css';

registerDefaultTransports();

const { host, setStatus } = mountShell({
  title: 'CSRM + DataProvider',
  mode: 'clientSide',
});

/** One KV transport shared by the provider catalog and Ext's ConfigSession. */
const storage = new LocalStore();
const catalog = new LocalStorageConfigBackend({ storage });

const demoAppData = createDemoAppData();

// `?huburl=` / `?hubapp=` / `?hubstrict` stand in for what a real deployment
// hard-codes. A SharedWorker is keyed on (origin, script URL, name), so:
//   - one DEPLOYED script, named from every app  ⇒ apps can converge at all
//   - the app name then partitions hubs: same name ⇒ same hub (one upstream
//     connection per providerId, one cache), different name ⇒ separate hub
// Unset, each app bundles its OWN copy of the worker and gets its own hub
// whatever name it passes — which is what `hubstrict` refuses.
const hubQuery = new URLSearchParams(location.search);
const hubOpts = {
  workerUrl: hubQuery.get('huburl') ?? undefined,
  name: hubQuery.get('hubapp') ?? undefined,
  strict: hubQuery.has('hubstrict') || undefined,
};

let activeProvider: ProviderClientAdapter | null = null;

const dataController = new DataProviderController({
  catalog,
  ...hubOpts,
  // Resolves {{session.trader}} in the catalog topics — both row models.
  appData: demoAppData,
  onActiveChange: (providerId, provider) => {
    // Kept so `__demo.hubStats()` can ask the hub who is connected to it.
    activeProvider = provider;
    if (!providerId || !provider) {
      setStatus('no provider — Customize → Data → Apply', 'err');
      return;
    }
    provider.onStatus((s, err) => {
      setStatus(
        `provider <b>${s}</b>${err ? ` — ${err}` : ''} · rows <b>${ext.grid.getTotalRowCount()}</b>`,
        s === 'ready' ? 'ok' : s === 'error' ? 'err' : '',
      );
    });
    setStatus(`bound <b>${providerId}</b>`);
  },
});

/** Wired after construction — the ribbon looks this up lazily. */
let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const ext = new VelocityGridExt(host, {
  gridId: 'csrm-provider-demo',
  theme: DEMO_THEME,
  // Columns are owned by the DataProvider — the controller pushes them on
  // Apply, so starting empty is correct rather than a placeholder.
  columnDefs: [],
  defaultColDef: {
    resizable: true, sortable: true, editable: true,
    minWidth: 80, filter: true, floatingFilter: true,
  },
  getRowId: (r: { positionId?: string }) => String(r.positionId ?? ''),
  enableCellChangeFlash: true,
  cellSelection: { suppressHeader: true },
  sideBar: { toolPanels: ['columns', 'filters'] },
  rowGroupPanelShow: 'always',
  pivotPanelShow: 'always',
  grandTotalRow: 'pinnedBottom',
  groupDisplayType: 'singleColumn',
  groupDefaultExpanded: 0,
  // Paint cadence — independent of the hub's own pipeline throttling.
  asyncTransactionWaitMillis: 60,
  asyncTransactionThrottleMillis: 200,
  ext: {
    storage,
    extensions: [
      ...titleBarExtensions({
        name: 'CSRM · Positions (client-side)',
        date: new Date().toISOString().slice(0, 10),
      }),
      ...ribbonExtensions({ edit: () => editHandle }),
      dataProviderModule({ controller: dataController }),
    ],
  },
} as unknown as VelocityGridExtOptions);

wireFormat(ext.grid);
wireCalc(ext.grid);
wireRules(ext.grid);
editHandle = wireEditIntoKernel(ext.grid, {
  commitUpdates: (rows) => { ext.grid.applyTransactionAsync({ update: rows }); },
});

void (async () => {
  await ensureSeeded(catalog, buildCsrmProviderConfig());
  await ext.grid.whenReady();
  await ext.reapplyActiveProfile();
  if (!dataController.getActiveProviderId()) {
    await dataController.setActiveProvider(CSRM_PROVIDER_ID, { force: true });
  }
})().catch((err) => {
  console.error('[csrm-provider-demo] startup failed', err);
  setStatus('startup failed — see console', 'err');
});

(window as unknown as { __demo: unknown }).__demo = {
  ext, get grid() { return ext.grid; }, catalog, storage, dataController,
  providerId: CSRM_PROVIDER_ID,
  // What this tab's hub is keyed on. Apps meant to share must report the same
  // `url` and `name`, with `bundled: false`.
  hubTarget: () => getDataHubTarget(dataController.getHubOpts()),
  // The hub's own view of who is connected. `subscriberCount` is the proof of
  // convergence: two apps on ONE hub, both subscribed to this provider, read
  // 2 — where two separate hubs each read 1.
  hubStats: async () => (activeProvider ? await activeProvider.getStats() : null),
};

window.addEventListener('beforeunload', () => {
  dataController.detach();
  ext.destroy();
});
