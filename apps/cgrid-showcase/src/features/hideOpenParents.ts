import { CGrid } from '@cgrid/kernel';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const hideOpenParents: Feature = {
  id: 'hideOpenParents',
  label: 'Hide Open Parents',
  description: 'groupHideOpenParents: true — expanding a group hides the parent row, showing only its children inline.',

  mount(gridHost, _controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', flex: 1 },
        { colId: 'desk',   field: 'desk',   headerName: 'Desk',   cellDataType: 'text', flex: 1 },
        { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text', flex: 1 },
        { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text', flex: 1 },
        { colId: 'pnl',    field: 'pnl',    headerName: 'P&L',    cellDataType: 'number', aggFunc: 'sum', flex: 1 },
      ],
      theme,
      groupHideOpenParents: true,
      rowGroupPanelShow: 'always',
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk', 'ticker'] });

    return grid;
  },
};
