/**
 * SSRM grid bootstrap — must run before `zone.js` is imported (see main.ts).
 */
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  perspectiveDataProviderModule,
  type VelocityGridExtConfig,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import {
  LocalStorageConfigBackend,
  resolveProviderConfig,
  registerDefaultTransports,
} from '@wellsfargo-starui/velocity-grid-data';
import { PersistedAppDataStore } from '@wellsfargo-starui/velocity-grid-appdata';
import { LocalStore } from '@wellsfargo-starui/velocity-grid-storage';
import {
  PerspectiveDataProviderController,
  type BookTelemetry,
} from '@wellsfargo-starui/velocity-grid-perspective';
import type { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import {
  buildSsrmProviderTemplate,
  SSRM_PROVIDER_ID,
  SSRM_PROVIDER_SEED_VERSION,
} from './provider-catalog';
import '@wellsfargo-starui/velocity-grid/style.css';

export type PositionRow = Record<string, unknown> & { positionId: string };

export type AngularSsrmHost = {
  ext: VelocityGridExt<PositionRow>;
  grid: VelocityGrid<PositionRow>;
  catalog: LocalStorageConfigBackend;
  storage: LocalStore;
  appData: PersistedAppDataStore;
  dataController: PerspectiveDataProviderController;
  getConfig: () => VelocityGridExtConfig;
  exportConfigJson: () => string;
  downloadConfig: () => void;
  importConfig: (config: VelocityGridExtConfig) => void;
  persistConfig: () => void;
  rebindFromAppData: (snapshotRows: number) => Promise<void>;
  onStatus: (fn: (text: string) => void) => () => void;
};

function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Full workspace blob from Ext `getConfig` (view + layouts + module slices). */
function isGridConfig(value: unknown): value is VelocityGridExtConfig {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** `wireEditIntoKernel`'s `commitUpdates` hands back untyped row clones — narrow
 *  them to `PositionRow[]` before handing off to `applyServerSideTransaction`,
 *  which requires a string `positionId` on every row. */
function assertPositionRows(rows: Record<string, unknown>[]): PositionRow[] {
  return rows.map((row) => {
    if (typeof row.positionId !== 'string' || row.positionId.length === 0) {
      throw new Error('commitUpdates: row is missing a string positionId');
    }
    return row as PositionRow;
  });
}

export async function mountSsrmGrid(host: HTMLElement): Promise<AngularSsrmHost> {
  registerDefaultTransports();

  const storage = new LocalStore();
  const catalog = new LocalStorageConfigBackend({ storage });
  const appData = new PersistedAppDataStore('angular-ssrm', { storage });
  appData.set('runtime', 'providerName', 'Angular SSRM Positions');
  appData.set('runtime', 'label', 'Angular · SSRM seed');
  appData.set('runtime', 'snapshotRows', 3_000);
  appData.set('runtime', 'tickRate', 30);

  const statusListeners = new Set<(text: string) => void>();
  const emitStatus = (text: string): void => {
    for (const fn of statusListeners) {
      try { fn(text); } catch { /* */ }
    }
  };

  const dataController = new PerspectiveDataProviderController({
    catalog,
    onTelemetry: (t: BookTelemetry) => {
      emitStatus([
        `phase ${t.phase === 'live' ? 'live' : t.phase}`,
        `book ${t.bookSize.toLocaleString()}`,
        `getRows ${t.getRowsTotal.toLocaleString()}`,
      ].join(' · '));
    },
    onActiveChange: (id, _p, status) => {
      if (status?.phase === 'error') {
        emitStatus(`Provider bind failed: ${status.message}`);
        return;
      }
      emitStatus(id ? `Active provider: ${id}` : 'No provider bound');
    },
  });

  let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

  const options = {
    gridId: 'angular-ssrm',
    theme: 'vg-theme-quartz',
    defaultColDef: {
      resizable: true,
      sortable: true,
      editable: true,
      minWidth: 80,
      floatingFilter: true,
      filter: true,
    },
    columnDefs: [],
    rowModelType: 'serverSide',
    serverSideEnableClientSidePipeline: false,
    groupDefaultExpanded: 0,
    cacheBlockSize: 100,
    serverSideMaxCachedLeafBlocks: 20,
    enableCellChangeFlash: true,
    cellSelection: { suppressHeader: true },
    getRowId: (r: PositionRow) => String(r.positionId ?? ''),
    sideBar: { toolPanels: ['columns', 'filters'] },
    rowBuffer: 8,
    rowGroupPanelShow: 'always',
    ext: {
      storage,
      extensions: [
        { remove: 'settings-launcher' },
        { remove: 'save' },
        ...titleBarExtensions({ name: 'Angular 16 · SSRM' }),
        ...ribbonExtensions({ edit: () => editHandle }),
        perspectiveDataProviderModule({ controller: dataController }),
      ],
    },
  } as unknown as VelocityGridExtOptions<PositionRow>;

  const ext = new VelocityGridExt<PositionRow>(host, options);
  wireFormat(ext.grid);
  wireCalc(ext.grid);
  wireRules(ext.grid);
  editHandle = wireEditIntoKernel(ext.grid, {
    commitUpdates: (rows) => {
      ext.grid.applyServerSideTransaction({ update: assertPositionRows(rows) });
    },
  });

  async function persistResolvedProvider(): Promise<void> {
    const template = buildSsrmProviderTemplate();
    const resolved = resolveProviderConfig(template, appData.lookup);
    await catalog.save(resolved);
  }

  const existing = await catalog.get(SSRM_PROVIDER_ID);
  let catalogChanged = false;
  if (!existing) {
    await persistResolvedProvider();
    catalogChanged = true;
  } else {
    const cfg = { ...(existing.config ?? {}) } as Record<string, unknown>;
    if (Number(cfg._seedVersion ?? 0) < SSRM_PROVIDER_SEED_VERSION) {
      cfg._seedVersion = SSRM_PROVIDER_SEED_VERSION;
      catalogChanged = true;
    }
    if (!Array.isArray(cfg.columnDefinitions) || cfg.columnDefinitions.length === 0) {
      const seeded = resolveProviderConfig(buildSsrmProviderTemplate(), appData.lookup);
      cfg.columnDefinitions = (seeded.config as Record<string, unknown>).columnDefinitions;
      catalogChanged = true;
    }
    if (catalogChanged) await catalog.save({ ...existing, config: cfg });
  }

  await ext.grid.whenReady();
  await ext.reapplyActiveProfile();
  if (catalogChanged || !dataController.getActiveProviderId()) {
    await dataController.setActiveProvider(SSRM_PROVIDER_ID, { force: true });
  }

  const api: AngularSsrmHost = {
    ext,
    grid: ext.grid,
    catalog,
    storage,
    appData,
    dataController,
    getConfig: () => ext.getConfig(),
    exportConfigJson: () => JSON.stringify(ext.getConfig(), null, 2),
    downloadConfig: () => {
      downloadJson('angular-ssrm-config.json', JSON.stringify(ext.getConfig(), null, 2));
      emitStatus('Downloaded angular-ssrm-config.json');
    },
    importConfig: (config) => {
      if (!isGridConfig(config)) {
        throw new Error('Import failed: expected a grid config object');
      }
      ext.loadConfig(config);
      ext.persistConfig();
      emitStatus('Imported grid config (view + layouts + modules)');
    },
    persistConfig: () => {
      ext.persistConfig();
      emitStatus('Persisted grid config to LocalStore / ConfigSession');
    },
    async rebindFromAppData(snapshotRows: number) {
      appData.set('runtime', 'snapshotRows', snapshotRows);
      emitStatus('Re-resolving AppData…');
      await persistResolvedProvider();
      await dataController.setActiveProvider(SSRM_PROVIDER_ID, { force: true });
      emitStatus(`Rebound · snapshotRows=${snapshotRows}`);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
  };

  return api;
}

export function destroySsrmGrid(api: AngularSsrmHost | null): void {
  if (!api) return;
  api.dataController.detach();
  api.ext.destroy();
}

declare global {
  interface Window {
    __angularSsrm?: AngularSsrmHost;
  }
}
