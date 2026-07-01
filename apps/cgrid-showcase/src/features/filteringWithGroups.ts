import { CGrid } from '@cgrid/kernel';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

export const filteringWithGroups: Feature = {
  id: 'filteringWithGroups',
  label: 'Filtering with Groups',
  description: 'Floating filters sit below each column header. Type a value to filter leaf rows; groups with no matching leaves collapse. Number columns accept ranges like <code>&gt;0</code>, <code>-5000..5000</code>, or comma-separated values.',

  mount(gridHost, controls, theme) {
    const grid = new CGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'desk',   field: 'desk',   headerName: 'Desk',   cellDataType: 'text',   flex: 1 },
        { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text',   filter: 'set', flex: 1 },
        { colId: 'region', field: 'region', headerName: 'Region', cellDataType: 'text',   flex: 1 },
        { colId: 'sector', field: 'sector', headerName: 'Sector', cellDataType: 'text',   flex: 1 },
        { colId: 'pnl',    field: 'pnl',    headerName: 'P&L',    cellDataType: 'number', aggFunc: 'sum', flex: 1 },
      ],
      theme,
      floatingFilter: true,
    });

    grid.setRowData(makeRows(100));
    grid.setGroupModel({ rowGroupCols: ['desk'] });

    // Cross-column quick filter. Typing ships `quickFilterText` to the
    // worker (runtime option); leaf rows are filtered and groups with no
    // surviving leaves drop out, so the visible row count falls.
    const quickInput = document.createElement('input');
    quickInput.type = 'search';
    quickInput.className = 'ctrl-input';
    quickInput.placeholder = 'Quick filter…';
    quickInput.setAttribute('data-testid', 'quick-filter-input');
    quickInput.addEventListener('input', () => {
      grid.setGridOption('quickFilterText', quickInput.value);
    });
    controls.appendChild(quickInput);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'ctrl-btn';
    clearBtn.textContent = 'Clear All Filters';
    clearBtn.addEventListener('click', () => {
      quickInput.value = '';
      grid.setGridOption('quickFilterText', '');
      grid.setFilterModel({});
    });
    controls.appendChild(clearBtn);

    return grid;
  },
};
