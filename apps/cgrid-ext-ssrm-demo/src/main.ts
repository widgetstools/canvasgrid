/**
 * VelocityGridExt + SSRM demo — the batteries-included extension shell
 * (`@wellsfargo-starui/velocity-grid-ext`) driving a sparse Server-Side Row Model v2 grid.
 *
 * Everything is self-contained: `MockTradingServer` plays the server role
 * (skeleton + leaf + flat queries with simulated latency, live ticks), so
 * `npm run dev:ext-ssrm-demo` needs no external processes.
 *
 * What to try in the browser:
 *  - expand/collapse Desk → Region groups (local reflow, leaf blocks fetch
 *    lazily per group with visible latency);
 *  - drag columns in/out of the row-group panel (skeleton refetch);
 *  - sort an aggregated column (group order re-fetches server-side);
 *  - watch the pinned Grand Total + group aggregates tick live;
 *  - the VelocityGridExt chrome: title bar, profiles, settings sheet, Columns /
 *    Filters tool panels — all state round-trips through the profile store.
 */
import { VelocityGridExt, titleBarExtensions, ribbonExtensions, type VelocityGridExtOptions } from '@wellsfargo-starui/velocity-grid-ext';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid-rules';
import { MockTradingServer, type PositionRow } from './mockServer';
import { COLUMNS } from './columns';

const app = document.getElementById('app')!;

const server = new MockTradingServer({ rowCount: 50_000 });

// The ribbon's Editing toolbar reads the edit handle lazily so undo/redo +
// Smart Edit / Bulk Update bind to the real engine once it's wired (below).
let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const options = {
  gridId: 'ext-ssrm-demo',
  getRowId: (r: PositionRow) => r.positionId,
  columnDefs: COLUMNS,
  theme: 'vg-theme-quartz-dark',
  defaultColDef: { resizable: true, sortable: true, minWidth: 80 },

  // ── Sparse SSRM v2 (client-owned skeleton) ──────────────────────────
  rowModelType: 'serverSide',
  serverSideDatasource: server.datasource(),
  // Host owns filter/sort/group/agg — keep the worker's client-side
  // pipeline off so the sparse path serves everything.
  serverSideEnableClientSidePipeline: false,
  cacheBlockSize: 100,
  maxConcurrentDatasourceRequests: 2,

  // ── Live-tick smoothness (same shape as the SSRM blotter demo) ─────
  deferAsyncTransactionsWhileScrolling: true,
  asyncTransactionConflate: true,
  asyncTransactionWaitMillis: 50,
  enableCellChangeFlash: true,

  // ── Grouping chrome ────────────────────────────────────────────────
  suppressAggFuncInHeader: true,
  rowGroupPanelShow: 'always',
  // AG levels-open semantics: 0 = all collapsed (click carets to expand).
  groupDefaultExpanded: 0,
  grandTotalRow: 'pinnedBottom',
  groupDisplayType: 'singleColumn',
  autoGroupColumnDef: {
    cellRendererParams: {
      totalValueGetter: (p: { isGrandTotal: boolean; value: string }) =>
        p.isGrandTotal ? 'Grand Total' : `Total ${p.value}`,
    },
  },

  // ── VelocityGridExt / tooling chrome ──────────────────────────────────────
  sideBar: { toolPanels: ['columns', 'filters'] },
  statusBar: {
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent' },
      { statusPanel: 'agSelectedRowCountComponent' },
    ],
  },
  rowBuffer: 8,
  ext: {
    // Full MarketsGrid-style title bar + formatting/editing ribbon in place
    // of the default bare Settings/Save spine (same composition as
    // cgrid-ext-demo).
    extensions: [
      { remove: 'settings-launcher' },
      { remove: 'save' },
      ...titleBarExtensions({
        name: 'SSRM Blotter',
        date: new Date().toISOString().slice(0, 10),
      }),
      ...ribbonExtensions({ edit: () => editHandle }),
    ],
  },
} as VelocityGridExtOptions<PositionRow>;

const ext = new VelocityGridExt<PositionRow>(app, options);

// Wire cgrid's engines onto the owned grid — without these the ribbon's
// format/editing toolbars and the auto-format menu items are inert chrome:
// format compiles the string valueFormatters the pickers write, edit powers
// the editors + Smart Edit / Bulk Update, calc/rules back the Expressions
// module + conditional styling. Defs are re-issued right after wireFormat
// (and BEFORE calc/rules) so the compiler owns them from the start —
// same ordering contract as cgrid-ext-demo.
wireFormat(ext.grid);
ext.grid.updateGridOptions({ columnDefs: COLUMNS });
editHandle = wireEditIntoKernel(ext.grid, {
  // SSRM: journal undo/redo + smart/bulk commits must write the mock
  // server book and hydrate via SSRM txs — default applyTransaction is
  // CSRM-shaped and would leave the authoritative book untouched.
  commitUpdates: (_rows, { patches, direction }) => {
    const byId = new Map<string, PositionRow>();
    for (const p of patches) {
      const value = direction === 'undo' ? p.oldValue : p.newValue;
      const updated = server.applyEdit(p.rowId, p.field, value);
      if (updated) byId.set(updated.positionId, updated);
    }
    if (byId.size > 0) {
      ext.grid.applyServerSideTransaction({ update: [...byId.values()] });
    }
  },
});
wireCalc(ext.grid);
wireRules(ext.grid);

void ext.reapplyActiveProfile();

// Committed cell edits: the kernel patches its hydrated store for the
// repaint, but the authoritative book lives in the (mock) server — persist
// there and echo the round-trip so a later block re-hydrate keeps the edit.
ext.on('cellValueChanged', (e) => {
  const { rowId, colId, newValue } = e as { rowId: string; colId: string; newValue: unknown };
  const updated = server.applyEdit(rowId, colId, newValue);
  if (updated) ext.grid.applyServerSideTransaction({ update: [updated] });
});

// Live ticks ride the SSRM transaction path (in-place leaf patches);
// a 1s soft refresh re-syncs the skeleton so group aggregates + the
// pinned grand total track the ticking book.
server.startTicking((tx) => ext.grid.applyServerSideTransaction(tx));
const refreshTimer = setInterval(() => ext.grid.refreshServerSide({ purge: false }), 1000);

// Exposed for e2e / console poking.
(window as unknown as { __demo: unknown }).__demo = { ext, grid: ext.grid, server, editHandle };

window.addEventListener('beforeunload', () => {
  clearInterval(refreshTimer);
  server.stopTicking();
  ext.destroy();
});
