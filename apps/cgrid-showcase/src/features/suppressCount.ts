import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const suppressCount: Feature = {
  id: 'suppressCount',
  label: 'Suppress Count Badge',
  description: 'suppressCount: true — removes the "(n)" child-count badge from group rows. Set at construction time.',

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
      suppressCount: true,
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk'] });

    // Runtime toggle: suppressCount is a runtime-mutable option (Cycle 15.5
    // / Task 7), so flipping it via setGridOption repaints every group row's
    // (n) badge with no re-mount. Starts suppressed, so the button offers to
    // SHOW the badge; after the flip it offers to suppress it again.
    let suppressed = true;
    const btn = document.createElement('button');
    btn.className = 'ctrl-btn';
    btn.textContent = 'Show Count Badge';
    btn.addEventListener('click', () => {
      suppressed = !suppressed;
      grid.setGridOption('suppressCount', suppressed);
      btn.textContent = suppressed ? 'Show Count Badge' : 'Suppress Count Badge';
    });
    controls.appendChild(btn);

    const label = document.createElement('span');
    label.className = 'ctrl-label';
    label.textContent = 'Group rows show no child count — toggle to reveal the (n) badge';
    controls.appendChild(label);

    return grid;
  },
};
