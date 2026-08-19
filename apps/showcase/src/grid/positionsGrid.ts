import { createGrid, themeAlpine, themeMaterial, themeQuartz } from 'ag-grid-community';
import type {
  ColDef,
  GetDataPath,
  GridApi,
  GridOptions,
  IDetailCellRendererParams,
  RowSelectionOptions,
  StatusPanelDef,
} from 'ag-grid-community';
import type { PositionRow, StompFeedConfig, Trade } from '../types';
import { StompPositionsFeed } from '../stomp/stompPositionsFeed';
import { autoGroupColumnDef, columnDefs, defaultColDef } from './columnDefs';
import { PhasePanelContext, StatusBarPhasePanel } from './statusBarPhasePanel';

type ThemeName = 'quartzLight' | 'quartzDark' | 'alpine' | 'material';

interface FeatureToggles {
  grouping: boolean;
  editing: boolean;
  cellSelectionFill: boolean;
  suppressAggFuncInHeader: boolean;
  pivotMode: boolean;
  masterDetail: boolean;
  treeData: boolean;
  charts: boolean;
  theme: ThemeName;
  richStatusBar: boolean;
}

const DEFAULT_TOGGLES: FeatureToggles = {
  grouping: true,
  editing: false,
  cellSelectionFill: false,
  suppressAggFuncInHeader: true,
  pivotMode: false,
  masterDetail: false,
  treeData: false,
  charts: false,
  theme: 'quartzLight',
  richStatusBar: true,
};

const quartzLightTheme = themeQuartz.withParams(
  {
    accentColor: '#0d9488',
    backgroundColor: '#f4f6f8',
    borderColor: '#23202029',
    browserColorScheme: 'light',
    columnBorder: true,
    fontFamily: { googleFont: 'Inter' },
    fontSize: 13,
    headerBackgroundColor: '#e8ecef',
    headerFontFamily: { googleFont: 'Inter' },
    headerFontSize: 13,
    headerFontWeight: 600,
    oddRowBackgroundColor: '#eef1f3',
    spacing: 6,
    wrapperBorderRadius: 4,
  },
  'light',
);

const quartzDarkTheme = themeQuartz.withParams(
  {
    accentColor: '#2dd4bf',
    backgroundColor: '#1a1f2e',
    foregroundColor: '#e2e8f0',
    browserColorScheme: 'dark',
    columnBorder: true,
    fontFamily: { googleFont: 'Inter' },
    fontSize: 13,
    headerBackgroundColor: '#0f1320',
    headerFontFamily: { googleFont: 'Inter' },
    headerFontSize: 13,
    headerFontWeight: 600,
    oddRowBackgroundColor: '#1e2436',
    spacing: 6,
    wrapperBorderRadius: 4,
  },
  'dark',
);

const themeMap = {
  quartzLight: quartzLightTheme,
  quartzDark: quartzDarkTheme,
  alpine: themeAlpine,
  material: themeMaterial,
} as const;

const rowSelection: RowSelectionOptions = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  selectAll: 'filtered',
  groupSelects: 'descendants',
  checkboxLocation: 'autoGroupColumn',
  enableClickSelection: true,
};

const treeAutoGroupColDef: ColDef<PositionRow> = {
  headerName: 'Book / Portfolio / Position',
  minWidth: 280,
  pinned: 'left',
  cellRendererParams: { suppressCount: false },
};

const sideBar = {
  toolPanels: [
    {
      id: 'columns',
      labelDefault: 'Columns',
      labelKey: 'columns',
      iconKey: 'columns',
      toolPanel: 'agColumnsToolPanel',
    },
    {
      id: 'filters',
      labelDefault: 'Filters',
      labelKey: 'filters',
      iconKey: 'filter',
      toolPanel: 'agFiltersToolPanel',
    },
  ],
  defaultToolPanel: '',
};

function editableColumnDefs(): ColDef<PositionRow>[] {
  const editableFields = new Set(['notionalAmount', 'currentPrice', 'pnl', 'yield']);
  return columnDefs.map((col) => {
    if (col.field && editableFields.has(col.field)) {
      return { ...col, editable: true };
    }
    return col;
  });
}

function detailCellRendererParams(
  gridTheme: (typeof themeMap)[ThemeName],
): IDetailCellRendererParams<PositionRow, Trade> {
  return {
    detailGridOptions: {
      theme: gridTheme,
      columnDefs: [
        { field: 'id', headerName: 'Trade ID', width: 140 },
        { field: 'timestamp', headerName: 'Time', width: 200 },
        { field: 'side', headerName: 'Side', width: 80 },
        {
          field: 'quantity',
          headerName: 'Quantity',
          type: 'numericColumn',
          width: 110,
          valueFormatter: (p) => (p.value == null ? '' : Number(p.value).toLocaleString()),
        },
        {
          field: 'price',
          headerName: 'Price',
          type: 'numericColumn',
          width: 100,
          valueFormatter: (p) => (p.value == null ? '' : Number(p.value).toFixed(2)),
        },
      ],
      defaultColDef: { sortable: true, resizable: true },
    },
    getDetailRowData: (params) => {
      params.successCallback(params.data.trades ?? []);
    },
  } as IDetailCellRendererParams<PositionRow, Trade>;
}

const getDataPath: GetDataPath<PositionRow> = (data) => data.path ?? [data.positionId];

export function mountPositionsGrid(root: HTMLElement, config: StompFeedConfig): () => void {
  root.innerHTML = `
    <div class="grid-shell">
      <header class="grid-toolbar">
        <div>
          <h1>Fixed Income Positions</h1>
          <p>
            Real-time STOMP feed from <code>${config.wsUrl}</code> · sparse live mode ·
            ${config.snapshotRows.toLocaleString()} row snapshot
          </p>
        </div>
        <div class="toolbar-actions">
          <button type="button" data-action="reconnect">Restart stream</button>
          <button type="button" data-action="expand" hidden>Expand groups</button>
          <button type="button" data-action="collapse" hidden>Collapse groups</button>
          <button type="button" data-action="chart" hidden>Chart selected range</button>
        </div>
      </header>
      <div class="feature-toggles"></div>
      <div class="ag-theme-root"></div>
    </div>
  `;

  const togglesEl = root.querySelector('.feature-toggles') as HTMLElement;
  const gridHost = root.querySelector('.ag-theme-root') as HTMLElement;
  const expandBtn = root.querySelector('[data-action="expand"]') as HTMLButtonElement;
  const collapseBtn = root.querySelector('[data-action="collapse"]') as HTMLButtonElement;
  const chartBtn = root.querySelector('[data-action="chart"]') as HTMLButtonElement;

  let api: GridApi<PositionRow> | null = null;
  let totalRows = 0;
  let toggles: FeatureToggles = { ...DEFAULT_TOGGLES };
  let phasePanel: StatusBarPhasePanel | null = null;

  const phaseContext: PhasePanelContext = {
    getFeed: () => feed.getFeed(),
    getTotalRows: () => totalRows,
  };

  const refreshPhasePanel = () => {
    phasePanel?.refresh();
  };

  const feed = new StompPositionsFeed(config, {
    onSnapshot: (rows) => {
      if (!api) return;
      const enriched = rows.map((row) => {
        const center = row.currentPrice ?? 100;
        const priceHistory = Array.from({ length: 30 }, (_, i) => {
          const noise = (Math.sin(i * 0.7) + Math.cos(i * 0.3)) * 0.4;
          return Number((center + noise + (Math.random() - 0.5) * 0.3).toFixed(2));
        });
        const tradeCount = 3 + Math.floor(Math.random() * 6);
        const trades: Trade[] = Array.from({ length: tradeCount }, (_, i) => ({
          id: `${row.positionId}-T${i + 1}`,
          timestamp: new Date(Date.now() - i * 86_400_000).toISOString(),
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          quantity: Math.round(Math.random() * 5000) + 100,
          price: Number((center + (Math.random() - 0.5) * 2).toFixed(2)),
        }));
        const path = [row.bookName ?? 'BOOK', row.portfolio ?? 'PF', row.positionId];
        return { ...row, priceHistory, trades, path };
      });
      api.setGridOption('rowData', enriched);
      totalRows = enriched.length;
      refreshPhasePanel();
    },
    onLiveUpdate: (updates) => {
      if (!api || updates.length === 0) return;
      api.applyTransactionAsync({ update: updates });
    },
    onFeedChange: () => refreshPhasePanel(),
  });

  const buildStatusBar = (): { statusPanels: StatusPanelDef[] } => {
    const phasePanelDef: StatusPanelDef = {
      key: 'phase',
      statusPanel: StatusBarPhasePanel,
      statusPanelParams: { context: phaseContext },
      align: 'left',
    };
    if (!toggles.richStatusBar) {
      return {
        statusPanels: [phasePanelDef, { key: 'agg', statusPanel: 'agAggregationComponent', align: 'right' }],
      };
    }
    return {
      statusPanels: [
        phasePanelDef,
        { key: 'total', statusPanel: 'agTotalRowCountComponent', align: 'center' },
        { key: 'filtered', statusPanel: 'agFilteredRowCountComponent', align: 'center' },
        { key: 'selected', statusPanel: 'agSelectedRowCountComponent', align: 'center' },
        { key: 'totalFiltered', statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'center' },
        { key: 'agg', statusPanel: 'agAggregationComponent', align: 'right' },
      ],
    };
  };

  const applyGridOptions = (): void => {
    if (!api) return;
    const gridTheme = themeMap[toggles.theme];
    const activeColumnDefs = toggles.editing ? editableColumnDefs() : columnDefs;
    const cellSelection = toggles.charts
      ? { handle: { mode: 'range' as const } }
      : toggles.cellSelectionFill
        ? { handle: { mode: 'fill' as const } }
        : undefined;

    api.setGridOption('theme', gridTheme);
    api.setGridOption('columnDefs', activeColumnDefs);
    api.setGridOption(
      'autoGroupColumnDef',
      toggles.treeData ? treeAutoGroupColDef : autoGroupColumnDef,
    );
    api.setGridOption(
      'groupDisplayType',
      toggles.grouping && !toggles.treeData ? 'singleColumn' : undefined,
    );
    api.setGridOption(
      'groupDefaultExpanded',
      toggles.grouping && !toggles.treeData ? 1 : undefined,
    );
    api.setGridOption(
      'rowGroupPanelShow',
      !toggles.treeData && !toggles.pivotMode ? 'always' : 'never',
    );
    api.setGridOption('grandTotalRow', !toggles.treeData ? 'pinnedBottom' : undefined);
    api.setGridOption('groupTotalRow', !toggles.treeData ? 'bottom' : undefined);
    api.setGridOption('suppressAggFuncInHeader', toggles.suppressAggFuncInHeader);
    api.setGridOption('pivotMode', toggles.pivotMode);
    api.setGridOption(
      'masterDetail',
      toggles.masterDetail && !toggles.treeData && !toggles.pivotMode,
    );
    api.setGridOption(
      'detailCellRendererParams',
      toggles.masterDetail && !toggles.treeData && !toggles.pivotMode
        ? detailCellRendererParams(gridTheme)
        : undefined,
    );
    api.setGridOption('treeData', toggles.treeData);
    api.setGridOption('enableCharts', toggles.charts);
    api.setGridOption('cellSelection', cellSelection);
    api.setGridOption('statusBar', buildStatusBar());
    phasePanel = (api.getStatusPanel('phase') as StatusBarPhasePanel | undefined) ?? null;

    expandBtn.hidden = toggles.treeData || !toggles.grouping;
    collapseBtn.hidden = toggles.treeData || !toggles.grouping;
    chartBtn.hidden = !toggles.charts;
  };

  const renderToggles = (): void => {
    togglesEl.innerHTML = `
      <label class="${toggles.grouping && !toggles.treeData ? 'active' : ''}">
        <input type="checkbox" data-toggle="grouping" ${toggles.grouping && !toggles.treeData ? 'checked' : ''} ${toggles.treeData ? 'disabled' : ''} />
        Grouping
      </label>
      <label class="${toggles.editing ? 'active' : ''}">
        <input type="checkbox" data-toggle="editing" ${toggles.editing ? 'checked' : ''} />
        Editing
      </label>
      <label class="${toggles.cellSelectionFill && !toggles.charts ? 'active' : ''}">
        <input type="checkbox" data-toggle="cellSelectionFill" ${toggles.cellSelectionFill && !toggles.charts ? 'checked' : ''} ${toggles.charts ? 'disabled' : ''} />
        Fill Handle
      </label>
      <label class="${toggles.suppressAggFuncInHeader ? 'active' : ''}">
        <input type="checkbox" data-toggle="suppressAggFuncInHeader" ${toggles.suppressAggFuncInHeader ? 'checked' : ''} />
        Suppress Agg Header
      </label>
      <label class="${toggles.pivotMode ? 'active' : ''}">
        <input type="checkbox" data-toggle="pivotMode" ${toggles.pivotMode ? 'checked' : ''} />
        Pivot Mode
      </label>
      <label class="${toggles.masterDetail && !toggles.treeData && !toggles.pivotMode ? 'active' : ''}">
        <input type="checkbox" data-toggle="masterDetail" ${toggles.masterDetail && !toggles.treeData && !toggles.pivotMode ? 'checked' : ''} ${toggles.treeData || toggles.pivotMode ? 'disabled' : ''} />
        Master/Detail
      </label>
      <label class="${toggles.treeData ? 'active' : ''}">
        <input type="checkbox" data-toggle="treeData" ${toggles.treeData ? 'checked' : ''} ${toggles.pivotMode ? 'disabled' : ''} />
        Tree Data
      </label>
      <label class="${toggles.charts ? 'active' : ''}">
        <input type="checkbox" data-toggle="charts" ${toggles.charts ? 'checked' : ''} />
        Charts
      </label>
      <span class="feature-toggle-label">Theme:</span>
      <select data-toggle="theme">
        <option value="quartzLight" ${toggles.theme === 'quartzLight' ? 'selected' : ''}>Quartz Light</option>
        <option value="quartzDark" ${toggles.theme === 'quartzDark' ? 'selected' : ''}>Quartz Dark</option>
        <option value="alpine" ${toggles.theme === 'alpine' ? 'selected' : ''}>Alpine</option>
        <option value="material" ${toggles.theme === 'material' ? 'selected' : ''}>Material</option>
      </select>
      <label class="${toggles.richStatusBar ? 'active' : ''}">
        <input type="checkbox" data-toggle="richStatusBar" ${toggles.richStatusBar ? 'checked' : ''} />
        Rich Status Bar
      </label>
    `;
  };

  const setToggle = <K extends keyof FeatureToggles>(key: K, value?: FeatureToggles[K]): void => {
    const next = { ...toggles };
    if (value !== undefined) {
      next[key] = value;
    } else if (typeof next[key] === 'boolean') {
      (next[key] as boolean) = !(next[key] as boolean);
    }
    if (key === 'treeData' && next.treeData) {
      next.grouping = false;
      next.masterDetail = false;
    }
    if ((key === 'grouping' || key === 'masterDetail') && next[key]) {
      next.treeData = false;
    }
    if (key === 'pivotMode' && next.pivotMode) {
      next.treeData = false;
      next.masterDetail = false;
    }
    toggles = next;
    renderToggles();
    applyGridOptions();
  };

  const gridOptions: GridOptions<PositionRow> = {
    theme: themeMap[toggles.theme],
    columnDefs,
    defaultColDef,
    autoGroupColumnDef,
    getRowId: (p) => p.data.positionId,
    rowSelection,
    groupDisplayType: toggles.grouping ? 'singleColumn' : undefined,
    groupDefaultExpanded: toggles.grouping ? 1 : undefined,
    rowGroupPanelShow: 'always',
    grandTotalRow: 'pinnedBottom',
    groupTotalRow: 'bottom',
    suppressAggFuncInHeader: toggles.suppressAggFuncInHeader,
    getDataPath,
    animateRows: false,
    cellFlashDuration: 500,
    cellFadeDuration: 800,
    asyncTransactionWaitMillis: 50,
    sideBar,
    statusBar: buildStatusBar(),
    pagination: false,
    tooltipShowDelay: 500,
    maintainColumnOrder: true,
    onGridReady: (event) => {
      api = event.api;
      const panel = event.api.getStatusPanel('phase') as StatusBarPhasePanel | undefined;
      phasePanel = panel ?? null;
      applyGridOptions();
    },
  };

  createGrid(gridHost, gridOptions);
  renderToggles();

  const onToggleChange = (event: Event) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    const key = target.dataset.toggle as keyof FeatureToggles | undefined;
    if (!key) return;
    if (target instanceof HTMLSelectElement) {
      setToggle(key, target.value as FeatureToggles[typeof key]);
    } else {
      setToggle(key);
    }
  };

  togglesEl.addEventListener('change', onToggleChange);
  root.querySelector('[data-action="reconnect"]')?.addEventListener('click', () => feed.reconnect());
  expandBtn.addEventListener('click', () => api?.expandAll());
  collapseBtn.addEventListener('click', () => api?.collapseAll());
  chartBtn.addEventListener('click', () => api?.createRangeChart({ chartType: 'line', cellRange: {} }));

  return () => {
    togglesEl.removeEventListener('change', onToggleChange);
    feed.destroy();
    api?.destroy();
  };
}
