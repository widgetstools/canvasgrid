import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const groupSort: Feature = {
  id: 'groupSort',
  label: 'Per-Level Group Sort',
  description: 'Use setRowGroupColumnSort to control the sort direction of each grouping level independently.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'desk',   field: 'desk',   headerName: 'Desk',   cellDataType: 'text',   enableRowGroup: true, flex: 1 },
        { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text',   enableRowGroup: true, flex: 1 },
        { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text',   enableRowGroup: true, flex: 1 },
        { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text',   enableRowGroup: true, flex: 1 },
        { colId: 'pnl',    field: 'pnl',    headerName: 'P&L',    cellDataType: 'number', aggFunc: 'sum',       flex: 1 },
      ],
      theme,
      rowGroupPanelShow: 'always',
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk', 'ticker'] });

    const mkBtn = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'ctrl-btn';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };

    controls.appendChild(
      mkBtn('Desk ↑', () => grid.setRowGroupColumnSort('desk', 'asc')),
    );
    controls.appendChild(
      mkBtn('Desk ↓', () => grid.setRowGroupColumnSort('desk', 'desc')),
    );
    controls.appendChild(
      mkBtn('Ticker ↑', () => grid.setRowGroupColumnSort('ticker', 'asc')),
    );
    controls.appendChild(
      mkBtn('Ticker ↓', () => grid.setRowGroupColumnSort('ticker', 'desc')),
    );
    controls.appendChild(
      mkBtn('Clear Sort', () => {
        grid.setRowGroupColumnSort('desk', null);
        grid.setRowGroupColumnSort('ticker', null);
      }),
    );

    return grid;
  },
};
