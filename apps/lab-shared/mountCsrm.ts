import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import { wireRenderersIntoKernel } from '@wellsfargo-starui/velocity-grid-renderers';
import { defaultColDef, type LabRow } from './columns';
import { buildLabBook, startCsrmTicks, type CsrmTickHandle } from './csrmBook';
import type { LabFeature } from './features';
import { getLabCatalog, installLabDemoLayouts } from './profiles';
import { applyLabUiHints } from './profiles/uiHints';

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

  const chrome = feature.chrome ?? {};
  const rowCount = chrome.rowCount ?? 500;
  const rows = buildLabBook(rowCount);

  const showFormatRibbon = chrome.showFormattingToolbar === true
    || (chrome.showFormattingToolbar !== false && feature.id !== 'live' && feature.id !== 'renderers');
  const showEditRibbon = chrome.showEditingToolbar === true
    || ['editing', 'bulk-update', 'plus-minus', 'shortcuts', 'overview', 'formatting', 'toolbar'].includes(feature.id);
  const showRibbon = showFormatRibbon || showEditRibbon;
  const pauseBtn = consoleEl.querySelector<HTMLButtonElement>('[data-console="pause"]');
  const status = consoleEl.querySelector<HTMLElement>('[data-console-status]');
  let unsubLayouts: (() => void) | undefined;

  const syncConsole = () => {
    if (!pauseBtn || !status) return;
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
  const options = {
    gridId,
    getRowId: (r: LabRow) => r.id,
    columnDefs: feature.getColumnDefs(),
    defaultColDef: feature.defaultColDef ?? defaultColDef,
    theme: 'vg-theme-quartz-dark',
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
        ...(showRibbon ? ribbonExtensions({ edit: () => editHandle }) : []),
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
      ext?.destroy();
      ext = null;
    },
  };
}
