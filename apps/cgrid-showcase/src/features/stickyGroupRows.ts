import { CGrid } from '@cgrid/kernel';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const stickyGroupRows: Feature = {
  id: 'stickyGroupRows',
  label: 'Sticky Group Rows',
  description: 'With 320 rows grouped by Desk (80 each), scroll down to see the current group header stick to the top of the viewport.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   flex: 1 },
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   flex: 1 },
        { colId: 'region',   field: 'region',   headerName: 'Region',   cellDataType: 'text',   flex: 1 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   cellDataType: 'text',   flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', aggFunc: 'sum', flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', aggFunc: 'sum', flex: 1 },
      ],
      theme,
    });

    grid.setRowData(makeRows(320));
    grid.setGroupModel({ rowGroupCols: ['desk'] });

    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = 'Scroll inside the grid — the current group header stays visible';
    controls.appendChild(label);

    return grid;
  },
};
