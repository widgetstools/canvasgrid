import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';

/**
 * Cycle 18 / Task 5 — pivot tool panel showcase.
 *
 * Demonstrates the columns tool panel's pivot wiring: the Pivot Mode
 * toggle, the Column Labels + Values drop zones, and the
 * pivotMode-dependent checkbox semantics. Side-bar opens with the
 * Columns panel active so the pivot affordances are visible on mount.
 *
 * Also covers Task 4 (pivot column-group expand/collapse) — toggling
 * "Pivot" with pre-seeded values and a single pivot column makes the
 * synthesized column groups paint expand chevrons.
 *
 * Pre-seeded config:
 *  - rowGroupCols: [desk]
 *  - pivotCols:    [sector]
 *  - valueCols:    [pnl(sum), notional(sum)]
 *
 * The "Pivot On / Off" button flips api.setPivotMode so users can see
 * the matrix appear and disappear without losing the configured roles.
 */
export const pivotToolPanel: Feature = {
  id: 'pivotToolPanel',
  label: 'Pivot Tool Panel',
  description:
    'Pivot Mode toggle + Column Labels + Values drop zones in the columns side panel. Open the Columns tab to drag columns between roles; checking a column in pivot mode adds it as a row group / value (per AG parity).',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<ShowcaseRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'region',   field: 'region',   headerName: 'Region',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', enableValue: true,    aggFunc: 'sum',    flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', enableValue: true,    aggFunc: 'sum',    flex: 1 },
      ],
      theme,
      rowGroupPanelShow: 'always',
      // Cycle 18 / Task 6 — mount the top-of-grid pivot panel so the
      // showcase exercises BOTH views over PivotState (sidebar plz
      // zone + top panel). Drag a column header into the strip to add
      // it as a pivot column; the sidebar pill list updates on the
      // next event tick (sync invariant — both surfaces subscribe to
      // `pivotStateChanged`).
      pivotPanelShow: 'always',
      sideBar: {
        toolPanels: ['columns', 'filters'],
        defaultToolPanel: 'agColumnsToolPanel',
      },
      pivotDefaultExpanded: 1,
    });

    grid.setRowData(makeRows(120));

    // Pre-seed the three role lists. PivotState retains them across
    // pivotMode flips so toggling Off + back On restores the matrix.
    grid.setRowGroupColumns(['desk']);
    grid.setPivotColumns(['sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.addValueColumn('notional', 'sum');
    grid.setPivotMode(true);
    grid.collapseAll();

    const pivotBtn = document.createElement('button');
    pivotBtn.className = 'ctrl-btn primary';
    pivotBtn.setAttribute('data-testid', 'btn-pivot-toggle');
    const refreshPivotLabel = () => {
      pivotBtn.textContent = grid.isPivotMode() ? 'Pivot: On' : 'Pivot: Off';
    };
    refreshPivotLabel();
    pivotBtn.addEventListener('click', () => {
      grid.setPivotMode(!grid.isPivotMode());
      refreshPivotLabel();
    });

    const expandBtn = document.createElement('button');
    expandBtn.className = 'ctrl-btn';
    expandBtn.textContent = 'Expand groups';
    expandBtn.setAttribute('data-testid', 'btn-expand');
    expandBtn.addEventListener('click', () => grid.expandAll());

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'ctrl-btn';
    collapseBtn.textContent = 'Collapse groups';
    collapseBtn.setAttribute('data-testid', 'btn-collapse');
    collapseBtn.addEventListener('click', () => grid.collapseAll());

    controls.appendChild(pivotBtn);
    controls.appendChild(expandBtn);
    controls.appendChild(collapseBtn);

    // Keep the button label in sync if pivotMode flips via the tool
    // panel toggle (or any other external surface).
    grid.addEventListener('pivotStateChanged', () => refreshPivotLabel());

    return grid;
  },
};
