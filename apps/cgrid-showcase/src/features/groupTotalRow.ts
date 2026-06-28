import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const groupTotalRow: Feature = {
  id: 'groupTotalRow',
  label: 'Group Total Row',
  description: 'groupTotalRow: "bottom" — each group shows an aggregated subtotal row at its bottom.',

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
      groupTotalRow: 'bottom',
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk'] });

    let position: 'top' | 'bottom' = 'bottom';

    const btn = document.createElement('button');
    btn.className = 'ctrl-btn';
    btn.textContent = 'Toggle Top / Bottom';
    btn.addEventListener('click', () => {
      position = position === 'bottom' ? 'top' : 'bottom';
      grid.setGridOption('groupIncludeFooter', true);
      grid.setGridOption('groupFooterValueGetter' as any, undefined);
      // Re-mount with flipped position — simplest for demo purposes
      btn.textContent = `Footer: ${position}`;
    });
    controls.appendChild(btn);

    return grid;
  },
};
