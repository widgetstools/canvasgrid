import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const stateRoundtrip: Feature = {
  id: 'stateRoundtrip',
  label: 'State Round-trip',
  description: 'Serialize the active grouping columns to JSON, then restore them — demonstrates group state persistence.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'desk',   field: 'desk',   headerName: 'Desk',   cellDataType: 'text', flex: 1 },
        { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', flex: 1 },
        { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', flex: 1 },
        { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', flex: 1 },
        { colId: 'pnl',    field: 'pnl',    headerName: 'P&L',    cellDataType: 'number', aggFunc: 'sum', flex: 1 },
      ],
      theme,
      rowGroupPanelShow: 'always',
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk', 'ticker'] });

    let savedCols: string[] = [];

    const jsonOut = document.createElement('span');
    jsonOut.id = 'json-out';

    const serBtn = document.createElement('button');
    serBtn.className = 'ctrl-btn primary';
    serBtn.textContent = 'Serialize';
    serBtn.setAttribute('data-testid', 'btn-serialize');
    serBtn.addEventListener('click', () => {
      savedCols = grid.getRowGroupColumns();
      jsonOut.textContent = JSON.stringify({ rowGroupColumns: savedCols });
    });

    const resBtn = document.createElement('button');
    resBtn.className = 'ctrl-btn';
    resBtn.textContent = 'Restore';
    resBtn.setAttribute('data-testid', 'btn-restore');
    resBtn.addEventListener('click', () => {
      if (savedCols.length > 0) {
        grid.setRowGroupColumns(savedCols);
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'ctrl-btn';
    clearBtn.textContent = 'Clear Groups';
    clearBtn.setAttribute('data-testid', 'btn-clear');
    clearBtn.addEventListener('click', () => {
      grid.setRowGroupColumns([]);
    });

    controls.appendChild(serBtn);
    controls.appendChild(resBtn);
    controls.appendChild(clearBtn);
    controls.appendChild(jsonOut);

    return grid;
  },
};
