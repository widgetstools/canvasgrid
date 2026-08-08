/**
 * VelocityGridExt + SSRM demo — the batteries-included extension shell
 * (`@wellsfargo-starui/velocity-grid-ext`) driving a sparse Server-Side Row Model v2 grid.
 *
 * Everything is self-contained: `MockSSRMDataProvider` plays the server role
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
import {
  MockSSRMDataProvider,
  MOCK_POSITION_COLUMNS,
  type MockPositionRow,
} from '@wellsfargo-starui/velocity-grid-perspective';

const app = document.getElementById('app')!;

const provider = new MockSSRMDataProvider({ rowCount: 50_000 });

// The ribbon's Editing toolbar reads the edit handle lazily so undo/redo +
// Smart Edit / Bulk Update bind to the real engine once it's wired (below).
let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const options = {
  gridId: 'ext-ssrm-demo',
  theme: 'vg-theme-quartz-dark',
  defaultColDef: { resizable: true, sortable: true, minWidth: 80 },
  ...provider.gridOptions(),

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
} as VelocityGridExtOptions<MockPositionRow>;

const ext = new VelocityGridExt<MockPositionRow>(app, options);

// Wire cgrid's engines onto the owned grid — without these the ribbon's
// format/editing toolbars and the auto-format menu items are inert chrome:
// format compiles the string valueFormatters the pickers write, edit powers
// the editors + Smart Edit / Bulk Update, calc/rules back the Expressions
// module + conditional styling. Defs are re-issued right after wireFormat
// (and BEFORE calc/rules) so the compiler owns them from the start —
// same ordering contract as cgrid-ext-demo.
wireFormat(ext.grid);
ext.grid.updateGridOptions({ columnDefs: MOCK_POSITION_COLUMNS });
editHandle = wireEditIntoKernel(ext.grid, {
  // SSRM: journal undo/redo + smart/bulk commits must write the mock
  // provider book and hydrate via SSRM txs — default applyTransaction is
  // CSRM-shaped and would leave the authoritative book untouched.
  commitUpdates: (_rows, { patches, direction }) => {
    const byId = new Map<string, MockPositionRow>();
    for (const p of patches) {
      const value = direction === 'undo' ? p.oldValue : p.newValue;
      const updated = provider.applyEdit(p.rowId, p.field, value);
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
// repaint, but the authoritative book lives in the mock provider — persist
// there and echo the round-trip so a later block re-hydrate keeps the edit.
ext.on('cellValueChanged', (e) => {
  const { rowId, colId, newValue } = e as { rowId: string; colId: string; newValue: unknown };
  const updated = provider.applyEdit(rowId, colId, newValue);
  if (updated) ext.grid.applyServerSideTransaction({ update: [updated] });
});

// Live ticks + soft aggregate refresh (scroll-deferred) via provider.attach.
const detach = provider.attach(ext.grid);

// Exposed for e2e / console poking.
(window as unknown as { __demo: unknown }).__demo = { ext, grid: ext.grid, provider, editHandle };

window.addEventListener('beforeunload', () => {
  detach();
  provider.destroy();
  ext.destroy();
});
