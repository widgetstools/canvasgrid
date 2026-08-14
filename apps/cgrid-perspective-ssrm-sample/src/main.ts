/**
 * VelocityGridExt + Perspective SSRM sample.
 * Customize → Data → Data provider uses the **real** DataProvider editor;
 * Apply maps the catalog STOMP config onto StompPerspectiveProvider.
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
import { LocalStore } from '@wellsfargo-starui/velocity-grid-storage';
import {
  PerspectiveDataProviderController,
  type BookTelemetry,
} from '@wellsfargo-starui/velocity-grid-perspective';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import {
  buildPerspectiveSsrmProviderConfig,
  PERSPECTIVE_SSRM_PROVIDER_ID,
  PERSPECTIVE_SSRM_SEED_VERSION,
} from './providerCatalog';

registerDefaultTransports();

const banner = document.getElementById('banner');
document.getElementById('banner-dismiss')?.addEventListener('click', () => {
  banner?.remove();
});

const host = document.getElementById('grid-host');
if (!host) throw new Error('#grid-host missing');
const statusEl = document.getElementById('status');

/** One shared KV transport for catalog + Ext ConfigSession. */
const storage = new LocalStore();

/** Same catalog backend as hub DataProvider editor. */
const catalog = new LocalStorageConfigBackend({ storage });

function paintStatus(t: BookTelemetry): void {
  if (!statusEl) return;
  const phaseCls = t.phase === 'live' ? 'ok' : t.phase === 'error' ? 'err' : '';
  statusEl.innerHTML = [
    `<span class="${phaseCls}">phase <b>${t.phase}</b></span>`,
    `<span>engine <b>${t.workerMode}</b></span>`,
    ...(t.workerMode === 'shared' ? [`<span>feed <b>${t.feedRole}</b></span>`] : []),
    `<span>book <b>${t.bookSize.toLocaleString()}</b></span>`,
    `<span>live rows/s <b>${t.liveUpdatesPerSec.toLocaleString()}</b></span>`,
    `<span>getRows <b>${t.getRowsTotal.toLocaleString()}</b></span>`,
  ].join('');
}

const dataController = new PerspectiveDataProviderController({
  catalog,
  onTelemetry: paintStatus,
  onActiveChange: (providerId, provider) => {
    if (!providerId || !provider) {
      console.info(
        '[perspective-ssrm-sample] no provider — Customize → Data → Apply',
      );
      if (statusEl) statusEl.textContent = 'No provider — Customize → Data → Apply.';
      return;
    }
    console.info(`[perspective-ssrm-sample] active · ${providerId}`);
  },
});

const options = {
  gridId: 'perspective-ssrm-sample',
  theme: 'vg-theme-cursor-dark',
  defaultColDef: { resizable: true, sortable: true, minWidth: 80, floatingFilter: true, filter: true },
  columnDefs: [],
  rowModelType: 'serverSide',
  // Sparse Perspective SSRM — host owns group/expand; do not enable CSRM pipeline.
  serverSideEnableClientSidePipeline: false,
  groupDefaultExpanded: 0,
  cacheBlockSize: 100,
  maxBlocksInCache: 20,
  enableCellChangeFlash: true,
  cellSelection: { suppressHeader: true },
  getRowId: (r: { positionId: string }) => String(r.positionId ?? ''),
  sideBar: { toolPanels: ['columns', 'filters'] },
  rowBuffer: 8,
  rowGroupPanelShow: 'always',
  grandTotalRow: 'pinnedBottom',
  groupDisplayType: 'singleColumn',
  ext: {
    storage,
    extensions: [
      { remove: 'settings-launcher' },
      { remove: 'save' },
      ...titleBarExtensions({
        name: 'SSRM · Perspective Positions',
        date: new Date().toISOString().slice(0, 10),
      }),
      ...ribbonExtensions(),
      perspectiveDataProviderModule({ controller: dataController }),
    ],
  },
} as unknown as VelocityGridExtOptions;

const ext = new VelocityGridExt(host, options);

wireFormat(ext.grid);
wireCalc(ext.grid);
wireRules(ext.grid);

void (async () => {
  const seeded = buildPerspectiveSsrmProviderConfig();
  const existing = await catalog.get(PERSPECTIVE_SSRM_PROVIDER_ID);
  let catalogChanged = false;
  if (!existing) {
    await catalog.save(seeded);
    catalogChanged = true;
  } else {
    const cfg = { ...(existing.config ?? {}) } as Record<string, unknown>;
    const seedVer = Number(cfg._pspSeedVersion ?? 0);
    // Migrate stale localStorage seeds (snapshot size only).
    // columnDefinitions stay owned by the DataProvider editor — never overwrite.
    if (seedVer < PERSPECTIVE_SSRM_SEED_VERSION) {
      cfg.messageRate = seeded.config.messageRate;
      cfg.snapshotRows = seeded.config.snapshotRows;
      cfg._pspSeedVersion = PERSPECTIVE_SSRM_SEED_VERSION;
      catalogChanged = true;
    }
    if (!Array.isArray(cfg.columnDefinitions) || cfg.columnDefinitions.length === 0) {
      cfg.columnDefinitions = seeded.config.columnDefinitions;
      catalogChanged = true;
    }
    if (catalogChanged) await catalog.save({ ...existing, config: cfg });
  }
  await ext.grid.whenReady();
  await ext.reapplyActiveProfile();
  // Force rebind when seed size changed so the book reconnects with new
  // `snapshot-rows` (shared-book key includes snapshotRows).
  if (catalogChanged || !dataController.getActiveProviderId()) {
    await dataController.setActiveProvider(PERSPECTIVE_SSRM_PROVIDER_ID, { force: true });
  }
})();

(window as unknown as { __pspSample: unknown }).__pspSample = {
  ext,
  grid: ext.grid,
  catalog,
  storage,
  dataController,
  providerId: PERSPECTIVE_SSRM_PROVIDER_ID,
  async applySeeded() {
    await dataController.setActiveProvider(PERSPECTIVE_SSRM_PROVIDER_ID, { force: true });
  },
};

window.addEventListener('beforeunload', () => {
  dataController.detach();
  ext.destroy();
});

console.info(
  `[perspective-ssrm-sample] Ready. Broker ws://localhost:8082 · catalog id "${PERSPECTIVE_SSRM_PROVIDER_ID}".\n`
  + 'Customize → Data → Edit… opens the real DataProvider editor; Apply binds Perspective SSRM.',
);
