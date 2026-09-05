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
  canUseWorkerFeed,
  configurePerspectiveSharedWorker,
  getPerspectiveClient,
  getPerspectiveSharedWorkerTarget,
  getPerspectiveWorkerMode,
  getSharedEngineProtocol,
  readSharedEngineStats,
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

// `?swurl=<path>` / `?swname=<name>` / `?swstrict` stand in for what a real
// deployment hard-codes.
//
// The model to aim for is (origin, instance name) with `bundled: false`: an
// app joins the engine NAMED `swname` on its origin. Getting there needs the
// script URL to stop varying, because the browser keys on it too — so every
// app points at ONE deployed copy and the name becomes the only axis left.
// Tabs of a single app already share without any of this; it is several apps
// on one origin that need the agreement.
//
//   configurePerspectiveSharedWorker({
//     url: '/vendor/velocity-grid/psp-shared-worker.js',
//     name: 'positions-engine',
//     strict: true,   // a silent per-app engine is a failure, not a degrade
//   });
{
  const q = new URLSearchParams(location.search);
  const url = q.get('swurl');
  const name = q.get('swname');
  const strict = q.has('swstrict');
  if (url || name || strict) {
    configurePerspectiveSharedWorker({
      ...(url ? { url } : {}),
      ...(name ? { name } : {}),
      ...(strict ? { strict: true } : {}),
    });
  }
}

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

// `?feed=worker` runs the STOMP transport inside the SharedWorker that hosts
// the engine, instead of on an elected tab's main thread. Watch `feedRole` in
// telemetry to see which path actually ran: `worker` means the delegation
// took, `leader`/`follower` means it fell back (no shared engine, or a
// deployed worker older than the `feed:*` commands).
const workerFeed = new URLSearchParams(location.search).get('feed') === 'worker';

const dataController = new PerspectiveDataProviderController({
  catalog,
  // Resolves {{session.trader}} in the catalog topics — both row models.
  appData: demoAppData,
  workerFeed,
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
  // The shared Perspective engine outlives every page that talks to it, so
  // its WASM heap is the number to watch when a tab dies with "Out of
  // Memory". Nothing else on the page can see it.
  engineStats: readSharedEngineStats,
  // What the engine is actually hosting. Several blotters on one origin
  // sharing a providerId should show ONE table here, not one per tab.
  hostedTables: async () => (await getPerspectiveClient()).get_hosted_table_names(),
  workerMode: getPerspectiveWorkerMode,
  // The (url, name) pair this tab's engine is keyed on. Two apps that mean
  // to share one engine must report the same pair here.
  workerTarget: getPerspectiveSharedWorkerTarget,
  // What this build speaks vs what the deployed worker speaks. They differ
  // legitimately during a rollout — the worker is deployed once per origin
  // while apps ship on their own cycles.
  workerProtocol: getSharedEngineProtocol,
  // Whether this page asked for a worker-side feed, and whether it could
  // have one. `requested && !available` is the fallback case, and the two
  // being separate is the point: telemetry's `feedRole` says what happened,
  // these say why.
  workerFeed: () => ({ requested: workerFeed, available: canUseWorkerFeed() }),
  // Feeds the engine is running, one per physical table. `subscribers` is
  // the count of tabs on each — the direct answer to "is ONE broker
  // connection serving all of them?".
  engineFeeds: async () => (await readSharedEngineStats())?.feeds ?? null,
};

window.addEventListener('beforeunload', () => {
  dataController.detach();
  ext.destroy();
});
