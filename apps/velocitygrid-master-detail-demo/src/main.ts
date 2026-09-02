/**
 * Master / detail on VelocityGrid.
 *
 * Two panes so the feature can be judged on its own AND in the product:
 *
 *   left    the bare kernel grid — `masterDetail` + `detailCellRendererParams`
 *           and nothing else, which is the whole public surface.
 *   right   the same thing inside a grouped grid with the Ext chrome, because
 *           a master row that only works in isolation is not much use: the
 *           auto group column has to keep its own chevron on group rows while
 *           leaves get the master one.
 *
 * The controls exercise the parts that are easy to get wrong and invisible in
 * a screenshot: `keepDetailRows` (does a reopened detail remember its sort?),
 * `detailRowAutoHeight` (do the bands resize and the rows below reflow?), and
 * a live tick against `refreshStrategy` (does an open detail follow its
 * master?).
 */
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import '@wellsfargo-starui/velocity-grid/style.css';
import {
  makeAccounts,
  addCall,
  MASTER_COLUMNS,
  DETAIL_COLUMNS,
  type Account,
} from './data';
import './styles.css';

const THEME = 'vg-theme-cursor-dark';
document.documentElement.classList.add(THEME);
document.body.classList.add(THEME);

let ROWS = makeAccounts();
const byId = new Map(ROWS.map((r) => [r.id, r]));

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="bar">
    <strong>VelocityGrid · Master / Detail</strong>
    <span class="tag">masterDetail + detailCellRendererParams</span>
    <span class="hint">
      Click the caret on <em>Name</em> to open an account's calls. Every 7th
      account has none — <em>isRowMaster</em> gives it no caret.
    </span>
    <span class="controls">
      <button id="expand3">Open 3</button>
      <button id="collapse">Collapse all</button>
      <label><input type="checkbox" id="keep" /> keepDetailRows</label>
      <label><input type="checkbox" id="auto" /> detailRowAutoHeight</label>
      <label><input type="checkbox" id="tick" /> live tick</label>
    </span>
    <span class="counts" id="counts"></span>
  </div>
  <div class="grids">
    <section class="pane">
      <header>Kernel<span>plain VelocityGrid</span></header>
      <div class="host" id="plain"></div>
    </section>
    <section class="pane">
      <header>Ext · grouped<span>row groups + master rows together</span></header>
      <div class="host" id="ext"></div>
    </section>
  </div>
`;

/**
 * The master/detail configuration, shared by both panes.
 *
 * `getDetailRowData` is called once per master row when its band first
 * mounts; `successCallback` may be called later (it is deliberately deferred
 * one frame here to prove an async source works).
 */
function masterDetailOptions(): Record<string, unknown> {
  return {
    masterDetail: true,
    detailRowHeight: 260,
    isRowMaster: (row: Account) => row.callRecords.length > 0,
    detailCellRendererParams: {
      refreshStrategy: 'rows',
      detailGridOptions: {
        columnDefs: DETAIL_COLUMNS.map((c) => ({ ...c })),
        rowSelection: 'multiple',
        floatingFilter: false,
        statusBar: false,
        rowHeight: 26,
        headerHeight: 28,
      },
      getDetailRowData: (params: {
        data: Account;
        successCallback: (rows: unknown[]) => void;
      }) => {
        // Deferred a frame on purpose — a synchronous callback would hide the
        // "detail arrives later" path that any real datasource takes.
        setTimeout(() => params.successCallback(params.data.callRecords), 0);
      },
    },
  };
}

function baseOptions(): Record<string, unknown> {
  return {
    theme: THEME,
    columnDefs: MASTER_COLUMNS.map((c) => ({ ...c })),
    getRowId: (r: Account) => r.id,
    rowHeight: 30,
    rowSelection: 'multiple',
    enableCellChangeFlash: true,
    ...masterDetailOptions(),
  };
}

// ── left: the bare kernel grid ──────────────────────────────────────────
const plain = new VelocityGrid<Account>(
  document.getElementById('plain')!,
  baseOptions() as never,
);

// ── right: the same feature inside a grouped grid with the Ext chrome ───
const ext = new VelocityGridExt<Account>(document.getElementById('ext')!, {
  ...baseOptions(),
  gridId: 'master-detail-ext',
  // Grouped as well as expandable: group rows keep the group caret, leaf rows
  // get the master caret, and the auto group column carries both.
  autoGroupColumnDef: { headerName: 'Country', width: 240, pinned: 'left' },
  groupDefaultExpanded: 1,
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters'] },
  ext: { extensions: [...titleBarExtensions({ name: 'Master / detail' }), ...ribbonExtensions({})] },
} as unknown as VelocityGridExtOptions<Account>);

void (async () => {
  await plain.whenReady();
  plain.setRowData(ROWS);
  await ext.grid.whenReady();
  ext.grid.setRowData(ROWS);
  ext.grid.setRowGroupColumns(['country']);

  const grids = [plain, ext.grid];

  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  $('expand3').addEventListener('click', () => {
    const masters = ROWS.filter((r) => r.callRecords.length > 0).slice(0, 3);
    for (const g of grids) for (const r of masters) g.setDetailExpanded(r.id, true);
  });
  $('collapse').addEventListener('click', () => {
    for (const g of grids) g.collapseAllDetailRows();
  });
  $<HTMLInputElement>('keep').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    for (const g of grids) g.setGridOption('keepDetailRows', on);
  });
  $<HTMLInputElement>('auto').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    for (const g of grids) g.setGridOption('detailRowAutoHeight', on);
  });

  // Live tick — one account gains a call per beat. With
  // `refreshStrategy: 'rows'` any OPEN detail grid picks the new call up
  // without the user touching it.
  let timer: number | null = null;
  let seed = 1;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  $<HTMLInputElement>('tick').addEventListener('change', (e) => {
    if (timer !== null) { clearInterval(timer); timer = null; }
    if (!(e.target as HTMLInputElement).checked) return;
    timer = window.setInterval(() => {
      const target = ROWS[Math.floor(rnd() * ROWS.length)]!;
      if (target.callRecords.length === 0) return;
      const next = addCall(target, rnd);
      byId.set(next.id, next);
      ROWS = ROWS.map((r) => (r.id === next.id ? next : r));
      for (const g of grids) g.applyTransaction({ update: [next] });
    }, 900);
  });

  const counts = $('counts');
  const paint = (): void => {
    const open = plain.getExpandedDetailRowIds().length;
    counts.textContent =
      `${ROWS.length} accounts · ${open} open · ${plain.getDisplayedRowCount()} displayed rows`;
  };
  paint();
  setInterval(paint, 500);

  // Handy in the console: `__md.plain.getDetailGridInfo('detail_A100001').api`
  (window as unknown as { __md: unknown }).__md = { plain, ext: ext.grid, rows: () => ROWS, byId };
})();
