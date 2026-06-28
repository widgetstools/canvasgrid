import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const groupSelects: Feature = {
  id: 'groupSelects',
  label: 'Group Selects Children',
  description: 'groupSelects: "descendants" — clicking a group row\'s checkbox cascades selection to all its descendants.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   flex: 1 },
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   flex: 1 },
        { colId: 'region',   field: 'region',   headerName: 'Region',   cellDataType: 'text',   flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', aggFunc: 'sum', flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', aggFunc: 'sum', flex: 1 },
      ],
      theme,
      rowSelection: 'multiple',
      groupSelects: 'descendants',
      groupSelectsChildren: true,
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk'] });

    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = 'Click a group row checkbox to cascade selection';
    controls.appendChild(label);

    return grid;
  },
};
