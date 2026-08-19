import { createGrid } from 'ag-grid-community';
import type { GridApi, GridOptions } from 'ag-grid-community';
import { darkTheme } from './theme';
import { columnDefs, defaultColDef, GROUP_IDS } from './columnDefs';
import { makeRows, type PositionRow } from './data';

export function mountColgroupsDemo(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="page">
      <header class="masthead">
        <div>
          <h1>AG-Grid Column Grouping</h1>
          <p>
            One grid, every grouping permutation — flat columns, fields-only groups, always /
            open / closed children, open-by-default, nested sub-groups, and married groups.
          </p>
        </div>
        <div class="toolbar">
          <button type="button" data-testid="btn-expand-all">Expand all groups</button>
          <button type="button" data-testid="btn-collapse-all">Collapse all groups</button>
        </div>
      </header>

      <div class="legend">
        <span class="chip chip-always">Always visible</span>
        <span class="chip chip-open">Shows when open ▸</span>
        <span class="chip chip-closed">Shows when closed ◂</span>
        <span class="legend-note">
          Click a group header’s caret (<span class="caret-hint">▸</span>) to expand or collapse it.
          <b>Book&nbsp;&amp;&nbsp;Coverage</b> starts collapsed, <b>Valuation</b> starts open (
          <code>openByDefault</code>).
          <b>Risk&nbsp;&amp;&nbsp;Analytics</b> mixes leaf fields and nested sub-groups, each in its own state.
        </span>
      </div>

      <div class="grid-wrap" data-testid="grid-wrap"></div>
    </div>
  `;

  const gridWrap = root.querySelector('.grid-wrap') as HTMLElement;
  let api: GridApi<PositionRow> | null = null;

  const gridOptions: GridOptions<PositionRow> = {
    theme: darkTheme,
    columnDefs,
    defaultColDef,
    rowData: makeRows(200),
    sideBar: {
      toolPanels: [
        {
          id: 'columns',
          labelDefault: 'Columns',
          labelKey: 'columns',
          iconKey: 'columns',
          toolPanel: 'agColumnsToolPanel',
        },
        {
          id: 'filters',
          labelDefault: 'Filters',
          labelKey: 'filters',
          iconKey: 'filter',
          toolPanel: 'agFiltersToolPanel',
        },
      ],
      defaultToolPanel: '',
    },
    onGridReady: (e) => {
      api = e.api;
    },
    getRowId: (p) => p.data.positionId,
    suppressDragLeaveHidesColumns: true,
    animateRows: false,
  };

  createGrid(gridWrap, gridOptions);

  const setAll = (open: boolean) => {
    if (!api) return;
    for (const id of GROUP_IDS) {
      api.setColumnGroupOpened(id, open);
    }
  };

  const onExpandAll = () => setAll(true);
  const onCollapseAll = () => setAll(false);
  root.querySelector('[data-testid="btn-expand-all"]')?.addEventListener('click', onExpandAll);
  root.querySelector('[data-testid="btn-collapse-all"]')?.addEventListener('click', onCollapseAll);

  return () => {
    root.querySelector('[data-testid="btn-expand-all"]')?.removeEventListener('click', onExpandAll);
    root.querySelector('[data-testid="btn-collapse-all"]')?.removeEventListener('click', onCollapseAll);
    api?.destroy();
  };
}
