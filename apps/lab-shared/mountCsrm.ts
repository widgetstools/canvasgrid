import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  wireFormatContextMenu,
  dataProviderModule,
  DataProviderController,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import { MemoryConfigBackend } from '@wellsfargo-starui/velocity-grid-data';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { wireRenderersIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/renderers';
import { defaultColDef, type LabRow } from './columns';
import { buildLabBook, startCsrmTicks, type CsrmTickHandle } from './csrmBook';
import type { LabFeature } from './features';
import { getLabCatalog, installLabDemoLayouts } from './profiles';
import { applyLabUiHints } from './profiles/uiHints';

/** Seed a mock hub provider so Settings → Data provider has something to open. */
function seedLabDataCatalog(catalog: MemoryConfigBackend, rowCount: number): void {
  // MemoryConfigBackend.save writes synchronously before its Promise settles.
  void catalog.save({
    providerId: 'lab-mock-positions',
    name: 'Lab mock positions',
    description: 'Hub mock feed (in-process in the lab). Apply to rebind the grid.',
    providerType: 'mock',
    rowModel: 'clientSide',
    config: {
      keyColumn: 'id',
      rowCount: Math.min(rowCount, 2_000),
      tickMs: 250,
      updatesPerTick: 8,
      shape: 'positions',
      throttleEnabled: true,
      throttleMs: 100,
      conflateEnabled: true,
      columnDefinitions: [
        { field: 'id', headerName: 'Id', filter: true, sortable: true },
        { field: 'positionId', headerName: 'Position', filter: true, sortable: true },
        { field: 'ticker', headerName: 'Ticker', filter: true, sortable: true },
        { field: 'desk', headerName: 'Desk', filter: true, sortable: true },
        { field: 'notional', headerName: 'Notional', cellDataType: 'number', filter: true, sortable: true },
        { field: 'pnl', headerName: 'PnL', cellDataType: 'number', filter: true, sortable: true },
        { field: 'region', headerName: 'Region', filter: true, sortable: true },
      ],
    },
  });
}

export interface MountedCsrmFeature {
  destroy: () => void;
  ticks: CsrmTickHandle | null;
}

/** Mount VelocityGridExt + CSRM mock book with Markets-style multi-profiles. */
export function mountCsrmFeature(
  host: HTMLElement,
  feature: LabFeature,
  consoleEl: HTMLElement,
): MountedCsrmFeature {
  let ext: VelocityGridExt<LabRow> | null = null;
  let ticks: CsrmTickHandle | null = null;
  let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;
  let dataController: DataProviderController | null = null;

  const chrome = feature.chrome ?? {};
  const rowCount = chrome.rowCount ?? 500;
  const rows = buildLabBook(rowCount);

  // Mount toolbars for More → Editing/Formatting toggles. Compact tabs start
  // with both strips hidden (formatting via context menu / More when needed).
  const formatHidden = chrome.showFormattingToolbar !== true;
  const editHidden = chrome.showEditingToolbar !== true;
  const pauseBtn = consoleEl.querySelector<HTMLButtonElement>('[data-console="pause"]');
  const status = consoleEl.querySelector<HTMLElement>('[data-console-status]');
  let unsubLayouts: (() => void) | undefined;

  const syncConsole = () => {
    if (!pauseBtn || !status) return;
    const hubId = dataController?.getActiveProviderId() ?? null;
    if (hubId) {
      const n = dataController?.getProvider()?.getData().length ?? 0;
      pauseBtn.disabled = true;
      status.textContent = `hub · ${hubId} · ${n} rows · ${feature.id}`;
      return;
    }
    if (!ticks) {
      pauseBtn.disabled = chrome.enableUpdates === false;
      status.textContent = chrome.enableUpdates === false
        ? `ticks off · switch Layouts in title bar · ${feature.id}`
        : `loading · ${feature.id}`;
      return;
    }
    pauseBtn.disabled = false;
    pauseBtn.setAttribute('aria-pressed', ticks.paused ? 'true' : 'false');
    pauseBtn.textContent = ticks.paused ? 'Resume ticks' : 'Pause ticks';
    status.textContent = `${ticks.tickMs} ms · ${rowCount} rows · ${feature.id}`;
  };
  syncConsole();
  pauseBtn?.addEventListener('click', () => {
    if (!ticks) return;
    if (ticks.paused) ticks.resume();
    else ticks.pause();
    syncConsole();
  });

  const catalog = getLabCatalog(feature.id, 'csrm');
  const gridId = catalog?.gridId ?? feature.gridId;

  // Data-provider hub UI (Settings → Data provider). In-process hub for the lab.
  const dataCatalog = new MemoryConfigBackend();
  seedLabDataCatalog(dataCatalog, rowCount);
  dataController = new DataProviderController({
    catalog: dataCatalog,
    inProcess: true,
    onActiveChange: (providerId) => {
      // Stop the built-in CSRM tick book so it doesn't fight the hub feed.
      if (providerId) {
        ticks?.stop();
        ticks = null;
      }
      syncConsole();
    },
  });

  const options = {
    gridId,
    getRowId: (r: LabRow) => r.id,
    columnDefs: feature.getColumnDefs(),
    defaultColDef: feature.defaultColDef ?? defaultColDef,
    theme: 'vg-theme-cursor-dark',
    rowData: rows,
    enableCellChangeFlash: true,
    rowGroupPanelShow: feature.id === 'live' || feature.id === 'renderers'
      || feature.id.startsWith('edit') || feature.id === 'bulk-update'
      || feature.id === 'plus-minus' || feature.id === 'shortcuts'
      ? 'never'
      : 'always',
    sideBar: chrome.sideBar === false
      ? undefined
      : (chrome.sideBar ?? { toolPanels: ['columns', 'filters'] }),
    statusBar: {
      statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent' },
        { statusPanel: 'agSelectedRowCountComponent' },
      ],
    },
    ext: {
      extensions: [
        { remove: 'settings-launcher' },
        { remove: 'save' },
        ...titleBarExtensions({
          name: feature.label,
          date: new Date().toISOString().slice(0, 10),
        }),
        ...ribbonExtensions({
          edit: () => editHandle,
          formatHidden,
          editHidden,
        }),
        dataProviderModule({ controller: dataController! }),
      ],
    },
  } as VelocityGridExtOptions<LabRow>;

  ext = new VelocityGridExt<LabRow>(host, options);
  wireFormat(ext.grid);
  wireCalc(ext.grid);
  wireRules(ext.grid);
  if (feature.id === 'renderers' || feature.id === 'overview' || feature.id === 'live') {
    wireRenderersIntoKernel(ext.grid, {
      statsColumns: ['oas', 'marketValue', 'dailyPnL', 'modifiedDuration'],
    });
  }
  editHandle = wireEditIntoKernel(ext.grid);
  wireFormatContextMenu(ext.context);

  if (catalog) {
    unsubLayouts = installLabDemoLayouts(ext, catalog);
  }
  applyLabUiHints(feature.id, 'csrm', ext.grid);

  if (chrome.enableUpdates !== false) {
    ticks = startCsrmTicks({
      rows,
      updateIntervalMs: chrome.updateIntervalMs ?? 500,
      enableUpdates: true,
      onTick: (update) => {
        ext?.grid.applyTransactionAsync({ update });
      },
    });
  }

  syncConsole();
  (window as unknown as { __labGrid: unknown }).__labGrid = ext.grid;

  return {
    get ticks() { return ticks; },
    destroy: () => {
      unsubLayouts?.();
      ticks?.stop();
      ticks = null;
      dataController?.detach();
      dataController = null;
      ext?.destroy();
      ext = null;
    },
  };
}
