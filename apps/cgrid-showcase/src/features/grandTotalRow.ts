import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const grandTotalRow: Feature = {
  id: 'grandTotalRow',
  label: 'Grand Total Row',
  description: 'grandTotalRow: "bottom" — a single grand-total row appears at the very bottom aggregating all leaves.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   flex: 1 },
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   flex: 1 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   cellDataType: 'text',   flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', aggFunc: 'sum', flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', aggFunc: 'sum', flex: 1 },
      ],
      theme,
      grandTotalRow: 'bottom',
      groupIncludeFooter: true,
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk'] });

    const btn = document.createElement('button');
    btn.className = 'ctrl-btn';
    btn.textContent = 'Move to Top';
    let atBottom = true;
    btn.addEventListener('click', () => {
      atBottom = !atBottom;
      btn.textContent = atBottom ? 'Move to Top' : 'Move to Bottom';
    });
    controls.appendChild(btn);

    return grid;
  },
};
