import { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import type { Feature } from './index';
import { makeRows } from '../seedData';
import {
  ClientSideRowModelModule,
  ModuleRegistry,
  ValidationModule,
  createGrid,
  themeQuartz,
} from 'ag-grid-community';
import {
  ColumnMenuModule,
  ColumnsToolPanelModule,
  ContextMenuModule,
  FiltersToolPanelModule,
  PivotModule,
  RowGroupingPanelModule,
} from 'ag-grid-enterprise';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  PivotModule,
  RowGroupingPanelModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  ColumnMenuModule,
  ContextMenuModule,
  ValidationModule,
]);

/**
 * Cycle 18 — cgrid vs AG-Grid pivot side-by-side comparison.
 *
 * Two grids on the same data, same config; one toolbar mutates both.
 * Use this to diff visual + behavioural pivot output between cgrid
 * and AG-Grid. AG Enterprise watermark is expected (dev only).
 *
 * AG-Grid v35 API: imports core + per-feature enterprise modules at the
 * module top-level so Vite bundles ag-grid-community + ag-grid-enterprise
 * into the same chunk (separate dynamic imports caused duplicate core
 * bundles and the "mixing modules and packages" runtime error).
 * Uses the new Theming API (themeQuartz) instead of legacy CSS classes.
 */
export const pivotAgComparison: Feature = {
  id: 'pivotAgComparison',
  label: 'Pivot vs AG-Grid (side-by-side)',
  description:
    'Side-by-side comparison of cgrid pivot vs AG-Grid (v35) pivot on identical data + config. Linked toolbar drives both grids. AG Enterprise watermark is expected (dev only).',

  mount(gridHost, controls, theme) {
    const cgridTheme = theme;

    // ─── Split host into two columns ─────────────────────────────────────────
    gridHost.style.display = 'flex';
    gridHost.style.flexDirection = 'row';
    gridHost.style.gap = '8px';
    gridHost.style.width = '100%';
    gridHost.style.height = '100%';
    gridHost.style.minHeight = '0';

    const makePane = (label: string): { wrap: HTMLDivElement; body: HTMLDivElement } => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex:1 1 0; min-width:0; display:flex; flex-direction:column; min-height:0;';
      const head = document.createElement('div');
      head.textContent = label;
      head.style.cssText = 'padding:4px 8px; font-size:12px; font-weight:600; color:var(--cg-color-text, #ccc); border-bottom:1px solid rgba(127,127,127,0.2);';
      const body = document.createElement('div');
      body.style.cssText = 'flex:1 1 auto; min-height:0; min-width:0;';
      wrap.appendChild(head);
      wrap.appendChild(body);
      gridHost.appendChild(wrap);
      return { wrap, body };
    };

    const left = makePane('cgrid');
    const right = makePane('AG-Grid Enterprise (v35)');

    // ─── cgrid (left) ────────────────────────────────────────────────────────
    const fmt = (params: { value: unknown }) => {
      const v = params.value;
      if (v === null || v === undefined || v === '') return '';
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? `£${n.toLocaleString()}` : String(v);
    };

    const grid = new CGrid<ShowcaseRow>(left.body, {
      getRowId: (r) => r.id,
      columnDefs: [
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'region',   field: 'region',   headerName: 'Region',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   cellDataType: 'text',   enableRowGroup: true, enablePivot: true, flex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      cellDataType: 'number', enableValue: true, aggFunc: 'sum', flex: 1 },
        { colId: 'notional', field: 'notional', headerName: 'Notional', cellDataType: 'number', enableValue: true, aggFunc: 'sum', flex: 1 },
      ],
      theme: cgridTheme,
      rowGroupPanelShow: 'always',
      pivotPanelShow: 'always',
      pivotDefaultExpanded: 1,
      pivotColumnGroupTotals: 'after',
      sideBar: { toolPanels: ['columns'], defaultToolPanel: 'agColumnsToolPanel' },
      processPivotResultColDef: (def) => { def.valueFormatter = fmt; },
    });

    const rows = makeRows(120);
    grid.setRowData(rows);
    grid.setRowGroupColumns(['desk']);
    grid.setPivotColumns(['region', 'sector']);
    grid.addValueColumn('pnl', 'sum');
    grid.addValueColumn('notional', 'sum');
    grid.setPivotMode(true);

    // ─── AG-Grid (right) — v35 with new Theming API ──────────────────────────
    const isDark = cgridTheme.includes('dark');
    const agTheme = isDark
      ? themeQuartz.withParams({
          backgroundColor: '#1f1f1f',
          foregroundColor: '#fff',
          headerTextColor: '#fff',
          headerBackgroundColor: '#2b2b2b',
          oddRowBackgroundColor: '#262626',
          borderColor: '#3a3a3a',
        })
      : themeQuartz;

    const agApi = createGrid<ShowcaseRow>(right.body, {
      theme: agTheme,
      rowData: rows,
      columnDefs: [
        { colId: 'ticker',   field: 'ticker',   headerName: 'Ticker' },
        { colId: 'desk',     field: 'desk',     headerName: 'Desk',     rowGroup: true, hide: true },
        { colId: 'region',   field: 'region',   headerName: 'Region',   pivot: true, pivotIndex: 0 },
        { colId: 'sector',   field: 'sector',   headerName: 'Sector',   pivot: true, pivotIndex: 1 },
        { colId: 'pnl',      field: 'pnl',      headerName: 'P&L',      aggFunc: 'sum' },
        { colId: 'notional', field: 'notional', headerName: 'Notional', aggFunc: 'sum' },
      ],
      defaultColDef: {
        flex: 1,
        minWidth: 100,
        enableValue: true,
        enableRowGroup: true,
        enablePivot: true,
      },
      autoGroupColumnDef: { minWidth: 160 },
      pivotMode: true,
      groupDefaultExpanded: 0,
      pivotDefaultExpanded: 1,
      pivotColumnGroupTotals: 'after',
      rowGroupPanelShow: 'always',
      pivotPanelShow: 'always',
      sideBar: 'columns',
      processPivotResultColDef: (def) => { def.valueFormatter = fmt; },
    });

    // ─── Linked controls ─────────────────────────────────────────────────────
    let pivotOn = true;
    let rowTotals: 'before' | 'after' | null = null;
    let colGroupTotals: 'before' | 'after' | null = 'after';

    const makeBtn = (testid: string) => {
      const b = document.createElement('button');
      b.className = 'ctrl-btn';
      b.setAttribute('data-testid', testid);
      return b;
    };

    const pivotBtn = makeBtn('cmp-btn-pivot');
    pivotBtn.classList.add('primary');
    const refreshPivot = () => { pivotBtn.textContent = `Pivot: ${pivotOn ? 'On' : 'Off'}`; };
    refreshPivot();
    pivotBtn.addEventListener('click', () => {
      pivotOn = !pivotOn;
      grid.setPivotMode(pivotOn);
      agApi.setGridOption('pivotMode', pivotOn);
      refreshPivot();
    });

    const rowTotalsBtn = makeBtn('cmp-btn-row-totals');
    const refreshRow = () => { rowTotalsBtn.textContent = `Row totals: ${rowTotals ?? 'off'}`; };
    refreshRow();
    rowTotalsBtn.addEventListener('click', () => {
      rowTotals = rowTotals === null ? 'after' : rowTotals === 'after' ? 'before' : null;
      grid.setGridOption('pivotRowTotals', rowTotals);
      agApi.setGridOption('pivotRowTotals', rowTotals ?? undefined);
      refreshRow();
    });

    const colGroupBtn = makeBtn('cmp-btn-col-group-totals');
    const refreshCol = () => { colGroupBtn.textContent = `Col-group totals: ${colGroupTotals ?? 'off'}`; };
    refreshCol();
    colGroupBtn.addEventListener('click', () => {
      colGroupTotals = colGroupTotals === null ? 'after' : colGroupTotals === 'after' ? 'before' : null;
      grid.setGridOption('pivotColumnGroupTotals', colGroupTotals);
      agApi.setGridOption('pivotColumnGroupTotals', colGroupTotals ?? undefined);
      refreshCol();
    });

    const resetBtn = makeBtn('cmp-btn-reset');
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      pivotOn = true;
      rowTotals = null;
      colGroupTotals = 'after';
      grid.setPivotMode(true);
      grid.setGridOption('pivotRowTotals', null);
      grid.setGridOption('pivotColumnGroupTotals', 'after');
      agApi.setGridOption('pivotMode', true);
      agApi.setGridOption('pivotRowTotals', undefined);
      agApi.setGridOption('pivotColumnGroupTotals', 'after');
      refreshPivot();
      refreshRow();
      refreshCol();
    });

    controls.appendChild(pivotBtn);
    controls.appendChild(rowTotalsBtn);
    controls.appendChild(colGroupBtn);
    controls.appendChild(resetBtn);

    // The showcase shell calls activeGrid.destroy() on teardown — wrap so
    // the AG-Grid instance is also torn down when navigating away.
    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      try { agApi.destroy(); } catch { /* ignore */ }
      origDestroy();
    };

    return grid;
  },
};
