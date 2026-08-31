/**
 * Tree data on VelocityGridExt — both row models, side by side.
 *
 * The hierarchy comes from the DATA (`treeData` + `getDataPath`) rather than
 * from column values, which is AG Grid's tree-data model. Two grids are
 * mounted so the same tree can be compared across row models:
 *
 *   clientSide  the whole book is in the grid; the worker builds the tree
 *   serverSide  rows arrive through a datasource in windows
 *
 * Both run the full Ext chrome (title bar, ribbon, Customize drawer) so tree
 * data is exercised alongside the rest of the product rather than in a bare
 * harness — the auto group column, expand/collapse, aggregation and the
 * columns panel all have to keep working with it.
 *
 * Every desk / region / book node is a REAL row as well as a parent. That is
 * the case column grouping cannot express, so the demo leads with it.
 */
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import { makeTreeRows, TREE_COLUMNS, type TreeRow } from './treeData';
import './styles.css';

const THEME = 'vg-theme-cursor-dark';
document.documentElement.classList.add(THEME);
document.body.classList.add(THEME);

const ROWS = makeTreeRows();

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="bar">
    <strong>VelocityGrid · Tree Data</strong>
    <span class="tag">treeData + getDataPath</span>
    <span class="hint">
      desk → region → book → position. Every desk/region/book node is a row
      <em>and</em> a parent.
    </span>
    <span class="counts" id="counts"></span>
  </div>
  <div class="grids">
    <section class="pane">
      <header>Client-side<span>rowModelType: 'clientSide'</span></header>
      <div class="host" id="csrm"></div>
    </section>
    <section class="pane">
      <header>Server-side<span>rowModelType: 'serverSide'</span></header>
      <div class="host" id="ssrm"></div>
    </section>
  </div>
`;

/** Options shared by both grids — only the row model differs. */
function baseOptions(): Record<string, unknown> {
  return {
    theme: THEME,
    columnDefs: TREE_COLUMNS.map((c) => ({ ...c })),
    getRowId: (r: TreeRow) => String(r.positionId),

    // ── the tree ────────────────────────────────────────────────────────
    treeData: true,
    getDataPath: (r: TreeRow) => r.path,
    autoGroupColumnDef: {
      headerName: 'Book hierarchy',
      width: 300,
      pinned: 'left',
    },

    // Open with the top two levels showing. Left unset, VelocityGrid treats
    // the expansion set as 'expand everything', which on a large tree means
    // painting every leaf on load — AG collapses to `groupDefaultExpanded`
    // (default 0) instead. Set explicitly here rather than relying on either.
    groupDefaultExpanded: 1,

    rowGroupPanelShow: 'always',
    sideBar: { toolPanels: ['columns', 'filters'] },
    statusBar: {
      statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
        { statusPanel: 'agAggregationComponent', align: 'right' },
      ],
    },
    grandTotalRow: 'pinnedBottom',
  };
}

function mountExt(hostId: string, extra: Record<string, unknown>): VelocityGridExt<TreeRow> {
  let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;
  const ext = new VelocityGridExt<TreeRow>(document.getElementById(hostId)!, {
    ...baseOptions(),
    ...extra,
    ext: {
      extensions: [
        ...titleBarExtensions({ name: extra.rowModelType === 'serverSide' ? 'SSRM tree' : 'CSRM tree' }),
        ...ribbonExtensions({ edit: () => editHandle }),
      ],
    },
  } as unknown as VelocityGridExtOptions<TreeRow>);
  wireFormat(ext.grid);
  wireCalc(ext.grid);
  editHandle = wireEditIntoKernel(ext.grid, {});
  return ext;
}

// ── client side: the whole book goes in ────────────────────────────────
const csrm = mountExt('csrm', { gridId: 'tree-csrm', rowModelType: 'clientSide' });

// ── server side: the same rows, delivered in windows ───────────────────
const ssrm = mountExt('ssrm', {
  gridId: 'tree-ssrm',
  rowModelType: 'serverSide',
  serverSideEnableClientSidePipeline: true,
});

void (async () => {
  await csrm.grid.whenReady();
  csrm.grid.setRowData(ROWS);

  await ssrm.grid.whenReady();
  // A tree needs the whole book to know its own shape, so this datasource
  // serves windows out of one array rather than pretending to page a remote
  // store. `serverSideEnableClientSidePipeline` lets the worker build the tree
  // from the hydrated rows, which is the supported route for a server-side
  // grid that wants client-side shaping.
  ssrm.grid.setServerSideDatasource({
    getRows: ({ request, success }: {
      request: { startRow: number; endRow: number };
      success: (p: { rowData: TreeRow[]; rowCount: number }) => void;
    }) => {
      success({
        rowData: ROWS.slice(request.startRow, request.endRow),
        rowCount: ROWS.length,
      });
    },
  } as never);

  const counts = document.getElementById('counts')!;
  const paint = (): void => {
    counts.textContent =
      `${ROWS.length} rows · csrm shows ${csrm.grid.getDisplayedRowCount()}`
      + ` · ssrm shows ${ssrm.grid.getDisplayedRowCount()}`;
  };
  setTimeout(paint, 1500);
  setInterval(paint, 3000);

  (window as unknown as { __tree: unknown }).__tree = {
    rows: ROWS,
    csrm: csrm.grid,
    ssrm: ssrm.grid,
  };
})();
