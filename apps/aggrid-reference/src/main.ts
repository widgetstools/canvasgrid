/**
 * AG Grid reference app — the control side of a VelocityGrid comparison.
 *
 * Four modes, chosen to cover what was asked:
 *
 *   flat          sorting / filtering / editing / column model / status bar
 *   group-pivot   row grouping + pivoting + aggregation, with the panels
 *   tree          tree data          (VelocityGrid: not implemented)
 *   master-detail master/detail      (VelocityGrid: not implemented)
 *
 * Configured to mirror `apps/velocitygrid-*-provider-demo` as closely as AG
 * Grid allows: same columns, same row-group/pivot panels always visible, same
 * side bar (columns + filters), same status-bar panels, dark theme. Anything
 * that differs should differ because the GRIDS differ, not the setup.
 *
 * LICENCE: row grouping, pivoting, tree data, master detail, the side bar and
 * the status bar are all AG Grid Enterprise. This app runs unlicensed, which
 * is permitted for evaluation and prints a console warning plus a watermark.
 * It is a comparison harness, not something to ship.
 */
import { ModuleRegistry, createGrid, themeQuartz, colorSchemeDark } from 'ag-grid-community';
import type { GridApi, GridOptions, ColDef, ColGroupDef } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { makeRows, makeTreeRows, makeTrades, seedFor } from './data';
import type { PositionRow, TradeRow } from './data';
import './styles.css';

ModuleRegistry.registerModules([AllEnterpriseModule]);

const ROW_COUNT = 10_000;
type Mode = 'flat' | 'group-pivot' | 'tree' | 'master-detail';

const theme = themeQuartz.withPart(colorSchemeDark);

/** Mirrors the VelocityGrid demo catalog's nine columns and their roles. */
function positionColumns(): (ColDef<PositionRow> | ColGroupDef<PositionRow>)[] {
  return [
    { field: 'positionId', headerName: 'Position', width: 150, filter: true },
    { field: 'ticker', headerName: 'Ticker', width: 110, filter: true, enableRowGroup: true, enablePivot: true },
    { field: 'desk', headerName: 'Desk', width: 150, filter: true, enableRowGroup: true, enablePivot: true },
    { field: 'region', headerName: 'Region', width: 110, filter: true, enableRowGroup: true, enablePivot: true },
    { field: 'instrumentType', headerName: 'Instrument', width: 130, filter: true, enableRowGroup: true, enablePivot: true },
    { field: 'notionalAmount', headerName: 'Notional', width: 140, filter: 'agNumberColumnFilter', aggFunc: 'sum', enableValue: true },
    { field: 'marketValue', headerName: 'Mkt Value', width: 140, filter: 'agNumberColumnFilter', aggFunc: 'sum', enableValue: true },
    { field: 'pnl', headerName: 'P&L', width: 120, filter: 'agNumberColumnFilter', aggFunc: 'sum', enableValue: true },
    { field: 'dailyPnl', headerName: 'Daily P&L', width: 120, filter: 'agNumberColumnFilter', aggFunc: 'sum', enableValue: true },
  ];
}

const detailColumns: ColDef<TradeRow>[] = [
  { field: 'tradeId', headerName: 'Trade', flex: 1 },
  { field: 'side', headerName: 'Side', width: 90 },
  { field: 'quantity', headerName: 'Qty', width: 110, type: 'numericColumn' },
  { field: 'price', headerName: 'Price', width: 110, type: 'numericColumn' },
  { field: 'tradeDate', headerName: 'Date', width: 130 },
];

function baseOptions(): GridOptions<PositionRow> {
  return {
    theme,
    columnDefs: positionColumns(),
    defaultColDef: {
      sortable: true,
      resizable: true,
      filter: true,
      floatingFilter: true,
      enableCellChangeFlash: true,
    },
    getRowId: (p) => String(p.data.positionId),
    // Same chrome as the VelocityGrid demos, so the comparison is of grids
    // rather than of configuration.
    rowGroupPanelShow: 'always',
    pivotPanelShow: 'always',
    sideBar: { toolPanels: ['columns', 'filters'] },
    statusBar: {
      statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
        { statusPanel: 'agSelectedRowCountComponent', align: 'center' },
        { statusPanel: 'agAggregationComponent', align: 'right' },
      ],
    },
    cellSelection: true,
    rowSelection: { mode: 'multiRow' },
    grandTotalRow: 'bottom',
    animateRows: false,
  };
}

function optionsFor(mode: Mode): GridOptions<PositionRow> {
  const o = baseOptions();
  switch (mode) {
    case 'flat':
      o.rowData = makeRows(ROW_COUNT);
      break;

    case 'group-pivot': {
      // Arrives already grouped by desk and pivoted by region on sum(P&L) —
      // the exact configuration the VelocityGrid determinism suite drives, so
      // the two can be put side by side without any setup steps in between.
      o.rowData = makeRows(ROW_COUNT);
      const cols = o.columnDefs as ColDef<PositionRow>[];
      for (const c of cols) {
        if (c.field === 'desk') c.rowGroup = true;
        if (c.field === 'region') c.pivot = true;
      }
      o.pivotMode = true;
      o.autoGroupColumnDef = { headerName: 'Group', minWidth: 240, pinned: 'left' };
      o.groupDefaultExpanded = 0;
      break;
    }

    case 'tree': {
      // Tree data: a flat array where every row declares its own path. There
      // is no VelocityGrid counterpart — `getDataPath` does not exist there.
      const rows = makeTreeRows();
      o.rowData = rows as unknown as PositionRow[];
      o.treeData = true;
      o.getDataPath = (d: unknown) => (d as { path: string[] }).path;
      o.autoGroupColumnDef = {
        headerName: 'Book hierarchy',
        minWidth: 320,
        pinned: 'left',
        cellRendererParams: { suppressCount: false },
      };
      o.groupDefaultExpanded = 1;
      break;
    }

    case 'master-detail':
      // Fewer masters: each expands into its own nested grid, and the point is
      // the mechanism, not the volume.
      o.rowData = makeRows(500);
      o.masterDetail = true;
      // The expand chevron only appears on a column using the group cell
      // renderer — without it master/detail is enabled but unreachable.
      (o.columnDefs as ColDef<PositionRow>[])[0]!.cellRenderer = 'agGroupCellRenderer';
      o.detailCellRendererParams = {
        detailGridOptions: {
          theme,
          columnDefs: detailColumns,
          defaultColDef: { sortable: true, resizable: true, flex: 1 },
        },
        getDetailRowData: (params: { data: PositionRow; successCallback: (rows: TradeRow[]) => void }) => {
          params.successCallback(makeTrades(params.data.positionId, seedFor(params.data.positionId)));
        },
      };
      o.detailRowAutoHeight = true;
      break;
  }
  return o;
}

// ── shell ────────────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="bar">
    <strong>AG Grid ${'36.1.0'}</strong>
    <span class="tag">reference</span>
    <span class="modes">
      <button data-mode="flat">Flat</button>
      <button data-mode="group-pivot">Group + Pivot</button>
      <button data-mode="tree">Tree Data</button>
      <button data-mode="master-detail">Master / Detail</button>
    </span>
    <span class="hint" id="hint"></span>
  </div>
  <div id="grid" class="grid"></div>
`;

const HINTS: Record<Mode, string> = {
  'flat': 'sort / filter / edit / columns — the areas VelocityGrid also covers',
  'group-pivot': 'drag columns into Row Groups and Column Labels',
  'tree': 'getDataPath hierarchy — VelocityGrid: not implemented',
  'master-detail': 'expand a row for its nested trades grid — VelocityGrid: not implemented',
};

let api: GridApi<PositionRow> | null = null;
let mode: Mode = 'flat';

function mount(next: Mode): void {
  mode = next;
  api?.destroy();
  const host = document.getElementById('grid')!;
  host.replaceChildren();
  api = createGrid<PositionRow>(host, optionsFor(next));
  document.getElementById('hint')!.textContent = HINTS[next];
  for (const b of document.querySelectorAll<HTMLButtonElement>('.modes button')) {
    b.classList.toggle('is-active', b.dataset.mode === next);
  }
  // Expose for the comparison harness, mirroring the VelocityGrid demos'
  // `window.__demo` so one script can drive both products.
  (window as unknown as { __ag: unknown }).__ag = { get api() { return api; }, mode: () => mode, mount };
}

for (const b of document.querySelectorAll<HTMLButtonElement>('.modes button')) {
  b.addEventListener('click', () => mount(b.dataset.mode as Mode));
}
mount('flat');
