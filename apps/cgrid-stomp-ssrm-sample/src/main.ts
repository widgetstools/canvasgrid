/**
 * Standalone sample: VelocityGridExt SSRM grid + hub STOMP DataProvider,
 * authored/selected through Customize → Data provider.
 *
 * Prerequisites: stomp-view-server on ws://localhost:8082
 *   npm run dev:stomp
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
  registerDefaultTransports,
} from '@wellsfargo-starui/velocity-grid-data';
import { LocalStorageAppDataStore } from '@wellsfargo-starui/velocity-grid-appdata';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import {
  buildStompSsrmProviderConfig,
  STOMP_SSRM_PROVIDER_ID,
} from './providerCatalog';

registerDefaultTransports();

const banner = document.getElementById('banner');
document.getElementById('banner-dismiss')?.addEventListener('click', () => {
  banner?.remove();
});

const host = document.getElementById('grid-host');
if (!host) throw new Error('#grid-host missing');

/** Provider catalog — localStorage (`vg-data:provider-catalog`). */
const catalog = new LocalStorageConfigBackend();
/** AppData bags — localStorage (`vg-appdata:stomp-ssrm-sample`). */
const appData = new LocalStorageAppDataStore('stomp-ssrm-sample');

// Seed the STOMP provider once; later edits in Manage… persist across reloads.
void catalog.get(STOMP_SSRM_PROVIDER_ID).then((existing) => {
  if (!existing) void catalog.save(buildStompSsrmProviderConfig());
});

const dataController = new DataProviderController({
  catalog,
  appData,
  inProcess: true,
  onActiveChange: (providerId, provider) => {
    if (!providerId || !provider) {
      console.info(
        '[stomp-ssrm-sample] no provider — Customize (Settings) → Data → Apply “STOMP SSRM Positions”',
      );
      return;
    }
    void provider.getRows({ startRow: 0, endRow: 1 }).then(
      (r) => {
        console.info(
          `[stomp-ssrm-sample] active · ${providerId} · ${provider.getStatus()} · hub rows ${r.rowCount}`,
        );
      },
      () => {
        console.info(`[stomp-ssrm-sample] active · ${providerId} · ${provider.getStatus()}`);
      },
    );
  },
});

let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const options = {
  gridId: 'stomp-ssrm-sample',
  theme: 'vg-theme-quartz-dark',
  defaultColDef: { resizable: true, sortable: true, minWidth: 80 },
  // Columns come from the active DataProvider (`config.columnDefinitions`)
  // when Apply / restore binds — not hardcoded here.
  columnDefs: [],
  rowModelType: 'serverSide',
  cacheBlockSize: 100,
  maxBlocksInCache: 20,
  enableCellChangeFlash: true,
  // Header click sorts only — don't paint a full-column range selection.
  cellSelection: { suppressHeader: true },
  // No placeholder datasource — hub bind (or restore) installs the live one.
  // A construction-time empty DS used to overwrite a racing hub restore.
  getRowId: (r: { positionId: string }) => r.positionId,
  sideBar: { toolPanels: ['columns', 'filters'] },
  statusBar: {
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent' },
      { statusPanel: 'agSelectedRowCountComponent' },
    ],
  },
  rowBuffer: 8,
  ext: {
    extensions: [
      { remove: 'settings-launcher' },
      { remove: 'save' },
      ...titleBarExtensions({
        name: 'SSRM · STOMP Positions',
        date: new Date().toISOString().slice(0, 10),
      }),
      ...ribbonExtensions({ edit: () => editHandle }),
      dataProviderModule({ controller: dataController }),
    ],
  },
} as unknown as VelocityGridExtOptions;

const ext = new VelocityGridExt(host, options);

wireFormat(ext.grid);
editHandle = wireEditIntoKernel(ext.grid);
wireCalc(ext.grid);
wireRules(ext.grid);

// Wait for SSRM mount, then re-apply profile modules (incl. data-provider).
void (async () => {
  // Ensure seed landed before restore tries to resolve the active provider id.
  if (!(await catalog.get(STOMP_SSRM_PROVIDER_ID))) {
    await catalog.save(buildStompSsrmProviderConfig());
  }
  await ext.grid.whenReady();
  await ext.reapplyActiveProfile();
})();

(window as unknown as { __sample: unknown }).__sample = {
  ext,
  grid: ext.grid,
  catalog,
  appData,
  dataController,
  providerId: STOMP_SSRM_PROVIDER_ID,
  async applySeeded() {
    await dataController.setActiveProvider(STOMP_SSRM_PROVIDER_ID, { force: true });
  },
};

window.addEventListener('beforeunload', () => {
  dataController.detach();
  ext.destroy();
});

console.info(
  `[stomp-ssrm-sample] Ready. Broker ws://localhost:8082 · catalog id "${STOMP_SSRM_PROVIDER_ID}".\n`
  + 'Catalog + AppData + grid config persist in localStorage. Customize → Data → Apply to bind.',
);
