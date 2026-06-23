import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GetDataPath,
  GridApi,
  GridReadyEvent,
  IDetailCellRendererParams,
  RowSelectionOptions,
  StatusPanelDef,
} from 'ag-grid-community';
import { themeAlpine, themeMaterial, themeQuartz } from 'ag-grid-community';
import type { PositionRow, StompFeedConfig, StompFeedState, Trade } from '../types';
import { useStompPositions } from '../stomp/useStompPositions';
import { autoGroupColumnDef, columnDefs, defaultColDef } from './columnDefs';

// ── Themes ──────────────────────────────────────────────────────────────────
type ThemeName = 'quartzLight' | 'quartzDark' | 'alpine' | 'material';

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

// ── Status bar panel ─────────────────────────────────────────────────────────
function StatusBarPhasePanel(props: { feed: StompFeedState; totalRows: number }) {
  const { feed, totalRows } = props;
  const phaseLabel =
    feed.phase === 'connecting'
      ? 'Connecting…'
      : feed.phase === 'snapshot'
        ? `Loading snapshot (${feed.rowsReceived.toLocaleString()} rows)…`
        : feed.phase === 'live'
          ? 'Live'
          : feed.phase === 'error'
            ? `Error: ${feed.error ?? 'unknown'}`
            : feed.phase;

  return (
    <div className="status-panel">
      <span className="status-dot" data-phase={feed.phase} />
      <strong>{phaseLabel}</strong>
      <span>Rows: {totalRows.toLocaleString()}</span>
      <span>Live updates: {feed.liveUpdates.toLocaleString()}</span>
    </div>
  );
}

// ── Feature-toggle state ──────────────────────────────────────────────────────
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

// ── Main component ────────────────────────────────────────────────────────────
export function PositionsGrid({ config }: { config: StompFeedConfig }) {
  const gridApiRef = useRef<GridApi<PositionRow> | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [toggles, setToggles] = useState<FeatureToggles>(DEFAULT_TOGGLES);

  const toggle = useCallback(
    <K extends keyof FeatureToggles>(key: K, value?: FeatureToggles[K]) => {
      setToggles((prev) => {
        const next = { ...prev };
        if (value !== undefined) {
          next[key] = value;
        } else {
          // boolean toggle
          (next[key] as boolean) = !(prev[key] as boolean);
        }
        // Mutual exclusion: treeData disables grouping and masterDetail
        if (key === 'treeData' && next.treeData) {
          next.grouping = false;
          next.masterDetail = false;
        }
        // If grouping or masterDetail turned on, disable treeData
        if ((key === 'grouping' || key === 'masterDetail') && (next[key] as boolean)) {
          next.treeData = false;
        }
        // If pivotMode turned on, disable treeData and masterDetail
        if (key === 'pivotMode' && next.pivotMode) {
          next.treeData = false;
          next.masterDetail = false;
        }
        return next;
      });
    },
    [],
  );

  // ── Enriched snapshot data ────────────────────────────────────────────────
  const stompCallbacks = useMemo(
    () => ({
      onSnapshot: (rows: PositionRow[]) => {
        const api = gridApiRef.current;
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
        setTotalRows(enriched.length);
      },
      onLiveUpdate: (updates: PositionRow[]) => {
        const api = gridApiRef.current;
        if (!api || updates.length === 0) return;
        api.applyTransactionAsync({ update: updates });
      },
    }),
    [],
  );

  const { feed, reconnect } = useStompPositions(config, stompCallbacks);

  const onGridReady = useCallback((event: GridReadyEvent<PositionRow>) => {
    gridApiRef.current = event.api;
  }, []);

  const rowSelection = useMemo<RowSelectionOptions>(
    () => ({
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
      selectAll: 'filtered',
      groupSelects: 'descendants',
      checkboxLocation: 'autoGroupColumn',
      enableClickSelection: true,
    }),
    [],
  );

  // ── Theme ─────────────────────────────────────────────────────────────────
  const gridTheme = useMemo(() => themeMap[toggles.theme], [toggles.theme]);

  // ── Column defs (with editable flag applied) ──────────────────────────────
  const activeColumnDefs = useMemo<ColDef<PositionRow>[]>(() => {
    if (!toggles.editing) return columnDefs;
    const editableFields = new Set(['notionalAmount', 'currentPrice', 'pnl', 'yield']);
    return columnDefs.map((col) => {
      if (col.field && editableFields.has(col.field)) {
        return { ...col, editable: true };
      }
      return col;
    });
  }, [toggles.editing]);

  // ── Cell selection ────────────────────────────────────────────────────────
  const cellSelection = useMemo(() => {
    if (toggles.charts) {
      return { handle: { mode: 'range' as const } };
    }
    if (toggles.cellSelectionFill) {
      return { handle: { mode: 'fill' as const } };
    }
    return undefined;
  }, [toggles.cellSelectionFill, toggles.charts]);

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = useMemo<{ statusPanels: StatusPanelDef[] }>(() => {
    const phasePanel: StatusPanelDef = {
      statusPanel: () => <StatusBarPhasePanel feed={feed} totalRows={totalRows} />,
      align: 'left',
    };
    if (!toggles.richStatusBar) {
      return {
        statusPanels: [
          phasePanel,
          { statusPanel: 'agAggregationComponent', align: 'right' },
        ],
      };
    }
    return {
      statusPanels: [
        phasePanel,
        { statusPanel: 'agTotalRowCountComponent', align: 'center' },
        { statusPanel: 'agFilteredRowCountComponent', align: 'center' },
        { statusPanel: 'agSelectedRowCountComponent', align: 'center' },
        { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'center' },
        { statusPanel: 'agAggregationComponent', align: 'right' },
      ],
    };
  }, [feed, totalRows, toggles.richStatusBar]);

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sideBar = useMemo(
    () => ({
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
    }),
    [],
  );

  // ── Master/Detail params ──────────────────────────────────────────────────
  const detailCellRendererParams = useMemo<IDetailCellRendererParams<PositionRow, Trade> | undefined>(() => {
    if (!toggles.masterDetail) return undefined;
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
            valueFormatter: (p) =>
              p.value == null ? '' : Number(p.value).toLocaleString(),
          },
          {
            field: 'price',
            headerName: 'Price',
            type: 'numericColumn',
            width: 100,
            valueFormatter: (p) =>
              p.value == null ? '' : Number(p.value).toFixed(2),
          },
        ],
        defaultColDef: { sortable: true, resizable: true },
      },
      getDetailRowData: (params) => {
        params.successCallback(params.data.trades ?? []);
      },
    } as IDetailCellRendererParams<PositionRow, Trade>;
  }, [toggles.masterDetail, gridTheme]);

  // ── Tree data path getter ─────────────────────────────────────────────────
  const getDataPath = useCallback<GetDataPath<PositionRow>>(
    (data) => data.path ?? [data.positionId],
    [],
  );

  // ── Grouping columns (modified when grouping is off) ──────────────────────
  const groupDisplayType = toggles.grouping && !toggles.treeData ? 'singleColumn' : undefined;

  // ── Chart button handler ──────────────────────────────────────────────────
  const handleCreateChart = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    // cellRange is required but can be an empty partial — AG Grid uses the current selection
    api.createRangeChart({ chartType: 'line', cellRange: {} });
  }, []);

  // ── Row data for tree data mode (needs autoGroupColumnDef override) ───────
  const treeAutoGroupColDef = useMemo<ColDef<PositionRow>>(() => ({
    headerName: 'Book / Portfolio / Position',
    minWidth: 280,
    pinned: 'left',
    cellRendererParams: { suppressCount: false },
  }), []);

  const activeAutoGroupColDef = toggles.treeData ? treeAutoGroupColDef : autoGroupColumnDef;

  return (
    <div className="grid-shell">
      <header className="grid-toolbar">
        <div>
          <h1>Fixed Income Positions</h1>
          <p>
            Real-time STOMP feed from <code>{config.wsUrl}</code> · sparse live mode ·{' '}
            {config.snapshotRows.toLocaleString()} row snapshot
          </p>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={() => reconnect()}>
            Restart stream
          </button>
          {!toggles.treeData && toggles.grouping && (
            <>
              <button type="button" onClick={() => gridApiRef.current?.expandAll()}>
                Expand groups
              </button>
              <button type="button" onClick={() => gridApiRef.current?.collapseAll()}>
                Collapse groups
              </button>
            </>
          )}
          {toggles.charts && (
            <button type="button" onClick={handleCreateChart}>
              Chart selected range
            </button>
          )}
        </div>
      </header>

      {/* ── Feature toggle row ──────────────────────────────────────────────── */}
      <div className="feature-toggles">
        {/* 1. Grouping */}
        <label className={toggles.grouping && !toggles.treeData ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.grouping && !toggles.treeData}
            disabled={toggles.treeData}
            onChange={() => toggle('grouping')}
          />
          Grouping
        </label>

        {/* 2. Editing */}
        <label className={toggles.editing ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.editing}
            onChange={() => toggle('editing')}
          />
          Editing
        </label>

        {/* 3. Cell selection + fill handle */}
        <label className={toggles.cellSelectionFill && !toggles.charts ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.cellSelectionFill && !toggles.charts}
            disabled={toggles.charts}
            onChange={() => toggle('cellSelectionFill')}
          />
          Fill Handle
        </label>

        {/* 4. suppressAggFuncInHeader */}
        <label className={toggles.suppressAggFuncInHeader ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.suppressAggFuncInHeader}
            onChange={() => toggle('suppressAggFuncInHeader')}
          />
          Suppress Agg Header
        </label>

        {/* 5. Pivot mode */}
        <label className={toggles.pivotMode ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.pivotMode}
            onChange={() => toggle('pivotMode')}
          />
          Pivot Mode
        </label>

        {/* 6. Master/Detail */}
        <label className={toggles.masterDetail && !toggles.treeData && !toggles.pivotMode ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.masterDetail && !toggles.treeData && !toggles.pivotMode}
            disabled={toggles.treeData || toggles.pivotMode}
            onChange={() => toggle('masterDetail')}
          />
          Master/Detail
        </label>

        {/* 7. Tree Data */}
        <label className={toggles.treeData ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.treeData}
            disabled={toggles.pivotMode}
            onChange={() => toggle('treeData')}
          />
          Tree Data
        </label>

        {/* 8. Charts */}
        <label className={toggles.charts ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.charts}
            onChange={() => toggle('charts')}
          />
          Charts
        </label>

        {/* 9. Theme selector */}
        <span className="feature-toggle-label">Theme:</span>
        <select
          value={toggles.theme}
          onChange={(e) => toggle('theme', e.target.value as ThemeName)}
        >
          <option value="quartzLight">Quartz Light</option>
          <option value="quartzDark">Quartz Dark</option>
          <option value="alpine">Alpine</option>
          <option value="material">Material</option>
        </select>

        {/* 10. Status bar variants */}
        <label className={toggles.richStatusBar ? 'active' : ''}>
          <input
            type="checkbox"
            checked={toggles.richStatusBar}
            onChange={() => toggle('richStatusBar')}
          />
          Rich Status Bar
        </label>
      </div>

      <div className="ag-theme-root">
        <AgGridReact<PositionRow>
          theme={gridTheme}
          columnDefs={activeColumnDefs}
          defaultColDef={defaultColDef}
          autoGroupColumnDef={activeAutoGroupColDef}
          getRowId={(p) => p.data.positionId}
          onGridReady={onGridReady}
          rowSelection={rowSelection}
          // Grouping
          groupDisplayType={groupDisplayType}
          groupDefaultExpanded={toggles.grouping && !toggles.treeData ? 1 : undefined}
          rowGroupPanelShow={!toggles.treeData && !toggles.pivotMode ? 'always' : 'never'}
          grandTotalRow={!toggles.treeData ? 'pinnedBottom' : undefined}
          groupTotalRow={!toggles.treeData ? 'bottom' : undefined}
          // Aggregation header
          suppressAggFuncInHeader={toggles.suppressAggFuncInHeader}
          // Pivot
          pivotMode={toggles.pivotMode}
          // Master/Detail
          masterDetail={toggles.masterDetail && !toggles.treeData && !toggles.pivotMode}
          detailCellRendererParams={detailCellRendererParams}
          // Tree Data
          treeData={toggles.treeData}
          getDataPath={toggles.treeData ? getDataPath : undefined}
          // Charts
          enableCharts={toggles.charts}
          // Cell selection
          cellSelection={cellSelection}
          // Animation & performance
          animateRows={false}
          cellFlashDuration={500}
          cellFadeDuration={800}
          asyncTransactionWaitMillis={50}
          // UI
          sideBar={sideBar}
          statusBar={statusBar}
          pagination={false}
          tooltipShowDelay={500}
          maintainColumnOrder
        />
      </div>
    </div>
  );
}
