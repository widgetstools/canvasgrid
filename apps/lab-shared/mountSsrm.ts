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
import {
  MockSSRMDataProvider,
  MOCK_POSITION_COLUMNS,
  type MockPositionRow,
} from '@wellsfargo-starui/velocity-grid-perspective';
import type { LabFeature } from './features';
import { getLabCatalog, installLabDemoLayouts } from './profiles';
import { applyLabUiHints } from './profiles/uiHints';
import { withSsrmRendererParams } from './rendererColumns';

export interface MountedSsrmFeature {
  destroy: () => void;
  provider: MockSSRMDataProvider | null;
}

/**
 * Mount VelocityGridExt + MockSSRMDataProvider.
 * Demo curricula install as kernel Layouts (title-bar Layouts picker only).
 */
export function mountSsrmFeature(
  host: HTMLElement,
  feature: LabFeature,
  consoleEl: HTMLElement,
): MountedSsrmFeature {
  let ext: VelocityGridExt<MockPositionRow> | null = null;
  let provider: MockSSRMDataProvider | null = null;
  let detach: (() => void) | null = null;
  let unsubLayouts: (() => void) | undefined;
  let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

  const chrome = feature.chrome ?? {};
  const heavy = feature.id === 'live' || feature.id === 'overview' || feature.id === 'groups';
  const rowCount = chrome.rowCount ?? (heavy ? 8_000 : 2_500);

  const showRibbon =
    chrome.showFormattingToolbar !== false ||
    chrome.showEditingToolbar !== false ||
    ['editing', 'bulk-update', 'plus-minus', 'shortcuts', 'formatting', 'toolbar'].includes(feature.id);

  const pauseBtn = consoleEl.querySelector<HTMLButtonElement>('[data-console="pause"]');
  const status = consoleEl.querySelector<HTMLElement>('[data-console-status]');
  let paused = chrome.enableUpdates === false;

  const syncConsole = () => {
    if (!pauseBtn || !status) return;
    if (!provider) {
      status.textContent = `loading · SSRM · ${feature.id}`;
      pauseBtn.disabled = true;
      return;
    }
    if (chrome.enableUpdates === false) {
      pauseBtn.disabled = true;
      status.textContent = `ticks off · switch Layouts in title bar · ${feature.id}`;
      return;
    }
    pauseBtn.disabled = false;
    status.textContent = `${chrome.updateIntervalMs ?? 750} ms · ${rowCount} rows · SSRM · ${feature.id}`;
    pauseBtn.textContent = paused ? 'Resume ticks' : 'Pause ticks';
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  };
  syncConsole();

  pauseBtn?.addEventListener('click', () => {
    if (!provider || !ext || chrome.enableUpdates === false) return;
    if (paused) {
      provider.startTicking((tx) => ext!.grid.applyServerSideTransaction(tx));
      paused = false;
    } else {
      provider.stopTicking();
      paused = true;
    }
    syncConsole();
  });

  const catalog = getLabCatalog(feature.id, 'ssrm');
  provider = new MockSSRMDataProvider({
    rowCount,
    enableUpdates: chrome.enableUpdates !== false,
    updateIntervalMs: chrome.updateIntervalMs ?? (feature.id === 'live' ? 400 : 750),
    softRefreshIntervalMs: chrome.enableUpdates === false ? 0 : 1000,
    updatesPerTick: feature.id === 'live' ? 120 : 40,
  });

  const gridId = catalog?.gridId ?? `ssrm-${feature.gridId}`;
  const options = {
    gridId,
    theme: 'vg-theme-quartz-dark',
    defaultColDef: { resizable: true, sortable: true, minWidth: 80 },
    ...provider.gridOptions(),
    columnDefs: feature.id === 'renderers'
      ? withSsrmRendererParams(MOCK_POSITION_COLUMNS)
      : MOCK_POSITION_COLUMNS,
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
  } as VelocityGridExtOptions<MockPositionRow>;

  ext = new VelocityGridExt<MockPositionRow>(host, options);
  wireFormat(ext.grid);
  wireCalc(ext.grid);
  wireRules(ext.grid);
  if (feature.id === 'renderers' || feature.id === 'overview' || feature.id === 'live') {
    wireRenderersIntoKernel(ext.grid, {
      statsColumns: ['notional', 'marketValue', 'price', 'pnl', 'dailyPnl'],
    });
  }
  editHandle = wireEditIntoKernel(ext.grid, {
    commitUpdates: (_rows, { patches, direction }) => {
      if (!provider || !ext) return;
      const byId = new Map<string, MockPositionRow>();
      for (const p of patches) {
        const value = direction === 'undo' ? p.oldValue : p.newValue;
        const updated = provider.applyEdit(p.rowId, p.field, value);
        if (updated) byId.set(updated.positionId, updated);
      }
      if (byId.size > 0) {
        ext.grid.applyServerSideTransaction({ update: [...byId.values()] });
      }
    },
  });
  ext.on('cellValueChanged', (e) => {
    if (!provider || !ext) return;
    const { rowId, colId, newValue } = e as { rowId: string; colId: string; newValue: unknown };
    const updated = provider.applyEdit(rowId, colId, newValue);
    if (updated) ext.grid.applyServerSideTransaction({ update: [updated] });
  });

  detach = provider.attach(ext.grid);
  if (catalog) {
    unsubLayouts = installLabDemoLayouts(ext, catalog);
  }
  applyLabUiHints(feature.id, 'ssrm', ext.grid);
  syncConsole();
  (window as unknown as { __labGrid: unknown }).__labGrid = ext.grid;

  return {
    get provider() { return provider; },
    destroy: () => {
      unsubLayouts?.();
      detach?.();
      detach = null;
      provider?.destroy();
      provider = null;
      ext?.destroy();
      ext = null;
    },
  };
}
