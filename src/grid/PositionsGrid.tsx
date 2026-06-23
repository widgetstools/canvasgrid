import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GridApi, GridReadyEvent, RowSelectionOptions, StatusPanelDef } from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import type { PositionRow, StompFeedConfig, StompFeedState } from '../types';
import { useStompPositions } from '../stomp/useStompPositions';
import { autoGroupColumnDef, columnDefs, defaultColDef } from './columnDefs';

const gridTheme = themeQuartz.withParams(
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

function StatusBarPanel(props: { feed: StompFeedState; totalRows: number }) {
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

export function PositionsGrid({ config }: { config: StompFeedConfig }) {
  const gridApiRef = useRef<GridApi<PositionRow> | null>(null);
  const [totalRows, setTotalRows] = useState(0);

  const stompCallbacks = useMemo(
    () => ({
      onSnapshot: (rows: PositionRow[]) => {
        const api = gridApiRef.current;
        if (!api) return;
        api.setGridOption('rowData', rows);
        setTotalRows(rows.length);
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

  const statusBar = useMemo<{ statusPanels: StatusPanelDef[] }>(
    () => ({
      statusPanels: [
        {
          statusPanel: () => <StatusBarPanel feed={feed} totalRows={totalRows} />,
          align: 'left',
        },
        {
          statusPanel: 'agAggregationComponent',
          align: 'right',
        },
      ],
    }),
    [feed, totalRows],
  );

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
          <button type="button" onClick={() => gridApiRef.current?.expandAll()}>
            Expand groups
          </button>
          <button type="button" onClick={() => gridApiRef.current?.collapseAll()}>
            Collapse groups
          </button>
        </div>
      </header>

      <div className="ag-theme-root">
        <AgGridReact<PositionRow>
          theme={gridTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          autoGroupColumnDef={autoGroupColumnDef}
          getRowId={(p) => p.data.positionId}
          onGridReady={onGridReady}
          rowSelection={rowSelection}
          groupDisplayType="singleColumn"
          groupDefaultExpanded={1}
          rowGroupPanelShow="always"
          grandTotalRow="pinnedBottom"
          groupTotalRow="bottom"
          suppressAggFuncInHeader
          animateRows={false}
          cellFlashDuration={500}
          cellFadeDuration={800}
          asyncTransactionWaitMillis={50}
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
