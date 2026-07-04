import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { GridApi, GridReadyEvent } from 'ag-grid-community';
import { darkTheme } from './theme';
import { columnDefs, defaultColDef, GROUP_IDS } from './columnDefs';
import { makeRows, type PositionRow } from './data';

export function App() {
  const apiRef = useRef<GridApi<PositionRow> | null>(null);
  const rowData = useMemo(() => makeRows(200), []);

  const onGridReady = useCallback((e: GridReadyEvent<PositionRow>) => {
    apiRef.current = e.api;
  }, []);

  const setAll = useCallback((open: boolean) => {
    const api = apiRef.current;
    if (!api) return;
    for (const id of GROUP_IDS) {
      api.setColumnGroupOpened(id, open);
    }
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <h1>AG-Grid Column Grouping</h1>
          <p>
            One grid, every grouping permutation — flat columns, fields-only groups, always /
            open / closed children, open-by-default, nested sub-groups, and married groups.
          </p>
        </div>
        <div className="toolbar">
          <button type="button" data-testid="btn-expand-all" onClick={() => setAll(true)}>
            Expand all groups
          </button>
          <button type="button" data-testid="btn-collapse-all" onClick={() => setAll(false)}>
            Collapse all groups
          </button>
        </div>
      </header>

      <div className="legend">
        <span className="chip chip-always">Always visible</span>
        <span className="chip chip-open">Shows when open ▸</span>
        <span className="chip chip-closed">Shows when closed ◂</span>
        <span className="legend-note">Groups #3 (closed) &amp; #4 (open) differ by <code>openByDefault</code>. Group #6 “Risk &amp; Analytics” mixes leaf fields and nested sub-groups, each in its own state.</span>
      </div>

      <div className="grid-wrap" data-testid="grid-wrap">
        <AgGridReact<PositionRow>
          theme={darkTheme}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rowData}
          onGridReady={onGridReady}
          getRowId={(p) => p.data.positionId}
          suppressDragLeaveHidesColumns
          animateRows={false}
        />
      </div>
    </div>
  );
}
