/**
 * cgrid-ext demo — live-STOMP testbed for `@cgrid/ext`.
 *
 * ZERO feature code lives here: this app is a plain consumer that
 * instantiates CGridExt (the batteries-included kernel + extension shell)
 * with cgrid's existing tooling enabled — the StarUI theme, the `sideBar`
 * tool panels (Columns / Filters / Grid Options / Column Groups), the
 * row-group panel, formatted + grouped + conditionally-styled columns — and
 * pipes in the stomp-view-server feed (ws://localhost:8081, run it from
 * /Users/develop/wfh/starui/apps/stomp-view-server). The shell mounts even
 * if the feed never connects; STOMP errors only affect data. Anything not
 * doable through the public @cgrid/ext / @cgrid/kernel API is a gap to fix
 * upstream, never worked around here.
 */
import { CGridExt, titleBarExtensions, ribbonExtensions } from '@cgrid/ext';
import { formatPrice32, type CColDef, type CColGroupDef } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireEditIntoKernel } from '@cgrid/edit';
import { wireIntoKernel as wireCalc } from '@cgrid/calc';
import { wireIntoKernel as wireRules } from '@cgrid/rules';
import { connectStomp, type Position } from './stomp';

// ─── Pixel-invariance test harness ──────────────────────────────────────
// `?paintHarness` swaps the live STOMP feed for a fixed, deterministic
// 200-row dataset and exposes `window.__paintHarness` so an E2E spec can
// hash the live `.cg-canvas` pixels and diff a `suppressPartialRepaint:
// true` run against the default damage-region run. Never default-on:
// `getImageData` on the live canvas can force it off the GPU compositing
// path for the page's whole lifetime (see `snapshot()` below), so this
// path is opt-in and disconnected from the real feed entirely.
const harnessParams = new URLSearchParams(location.search);
const PAINT_HARNESS = harnessParams.has('paintHarness');
const SUPPRESS_PARTIAL = harnessParams.has('suppressPartial');
// Closeout fix wave (I5) — two more harness-only variants, each locking a
// specific bug the base `?paintHarness` boot couldn't reach:
//   `&grouped`  — row-groups the `desk` column (C4: sticky ancestor totals).
//   `&noFlash`  — boots with `enableCellChangeFlash: false`, the DEFAULT
//                 for a real app but never exercised by the base harness,
//                 which always ran with flash on (C3).
const GROUPED = harnessParams.has('grouped');
const NO_FLASH = harnessParams.has('noFlash');

/** Deterministic PRNG (public-domain mulberry32) — same seed on every boot
 *  so the two harness pages (partial vs. suppressed) see identical data. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed 200-row seed, same `Position` shape stomp.ts publishes, ids
 *  `HARNESS-0000`…`HARNESS-0199` (the invariance spec's STEPS reference
 *  a couple of these ids directly). */
function seedHarnessRows(): Position[] {
  const rng = mulberry32(42);
  const rows: Position[] = [];
  for (let i = 0; i < 200; i++) {
    const notional = Math.round(rng() * 9_000_000 + 1_000_000);
    const price = 95 + rng() * 10;
    rows.push({
      positionId: `HARNESS-${String(i).padStart(4, '0')}`,
      cusip: `CUSIP${String(i).padStart(5, '0')}`,
      ticker: `TICK${i % 40}`,
      notionalAmount: notional,
      marketValue: Math.round(notional * (price / 100)),
      currentPrice: price,
      pnl: Math.round((rng() - 0.5) * 200_000),
      dailyPnl: Math.round((rng() - 0.5) * 50_000),
      unrealizedPnl: Math.round((rng() - 0.5) * 100_000),
      yield: rng() * 8,
      spread: rng() * 300,
      dv01: rng() * 5000,
      pv01: rng() * 5000,
    });
  }
  return rows;
}

const DESKS = ['RATES', 'CREDIT', 'FX', 'EQD'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes'];

/** Deterministic categoricals derived from positionId so grouping affordances
 *  (row-group panel, Columns tool panel) have stable dimensions. */
function decorateWithCategoricals(row: Position): Position {
  let h = 0;
  for (let i = 0; i < row.positionId.length; i++) {
    h = (h * 31 + row.positionId.charCodeAt(i)) >>> 0;
  }
  row.desk = DESKS[h % DESKS.length];
  row.region = REGIONS[(h >>> 2) % REGIONS.length];
  row.currency = CURRENCIES[(h >>> 4) % CURRENCIES.length];
  row.trader = TRADERS[(h >>> 6) % TRADERS.length];
  return row;
}

const num = (headerName: string, field: keyof Position, extra: Partial<CColDef<Position>> = {}): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'number',
  enableValue: true,
  valueFormatter: '#,##0.00',
  ...extra,
});

const cat = (headerName: string, field: keyof Position): CColDef<Position> => ({
  colId: field,
  field,
  headerName,
  cellDataType: 'text',
  enableRowGroup: true,
  enablePivot: true,
});

/** Mode-aware ± sign colouring via theme tokens (resolved per active theme). */
const signStyle = (p: { value: unknown }) => {
  const n = Number(p.value);
  return Number.isFinite(n) && n !== 0
    ? { fg: n > 0 ? 'var(--cg-pos-color)' : 'var(--cg-neg-color)' }
    : {};
};

const columnDefs: (CColDef<Position> | CColGroupDef<Position>)[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', pinned: 'left', width: 130 },
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', enableRowGroup: true, enablePivot: true, width: 90 },
  { colId: 'cusip', field: 'cusip', headerName: 'CUSIP', cellDataType: 'text', width: 110 },
  cat('Desk', 'desk'),
  cat('Region', 'region'),
  cat('Ccy', 'currency'),
  cat('Trader', 'trader'),
  {
    groupId: 'trade',
    headerName: 'Trade',
    openByDefault: true,
    children: [
      {
        groupId: 'valuation',
        headerName: 'Valuation',
        openByDefault: true,
        children: [
          num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
          num('Mkt Value', 'marketValue', { valueFormatter: '#,##0', aggFunc: 'sum', columnGroupShow: 'open' }),
        ],
      },
      num('P&L', 'pnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)', cellStyle: signStyle }),
      num('Daily P&L', 'dailyPnl', {
        aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)',
        cellStyle: (p: { value: unknown }) => {
          const n = Number(p.value);
          if (!Number.isFinite(n) || n === 0) return {};
          if (n > 0) {
            return {
              fg: 'var(--cg-pos-color)', fontWeight: 700,
              decorators: [{ position: 'tr', kind: 'emoji', value: '▲', color: 'var(--cg-pos-color)', size: 9 }],
            };
          }
          return {
            fg: 'var(--cg-neg-color)', fontWeight: 700,
            border: { left: { width: 3, style: 'solid', color: 'var(--cg-neg-color)' } },
            decorators: [{ position: 'tr', kind: 'emoji', value: '▼', color: 'var(--cg-neg-color)', size: 9 }],
          };
        },
      }),
    ],
  },
  // 32nds bond price: displayed and edited as `101-16`.
  num('Price', 'currentPrice', {
    cellEditor: 'price32',
    valueFormatter: (p: { value: unknown }) => formatPrice32(p.value as number),
  }),
  num('Unrealized', 'unrealizedPnl', { aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)', cellStyle: signStyle }),
  {
    groupId: 'risk',
    headerName: 'Risk',
    children: [
      num('DV01', 'dv01', { aggFunc: 'sum' }),
      num('PV01', 'pv01', { aggFunc: 'sum' }),
      num('Yield', 'yield', { valueFormatter: '0.000' }),
      num('Spread', 'spread', { cellStyle: { fg: 'var(--cg-info-color)' } }),
    ],
  },
];

const app = document.querySelector<HTMLDivElement>('#app')!;

// The edit engine is wired just after construction (below); the ribbon's
// Editing toolbar reads it lazily so undo/redo + smart/bulk bind to the real
// handle once it exists.
let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

const ext = new CGridExt<Position>(app, {
  gridId: 'ext-demo',
  persistState: true,
  getRowId: (r) => r.positionId,
  columnDefs,
  theme: 'cg-theme-cursor-dark',
  defaultColDef: { resizable: true, sortable: true, editable: true, flex: 1, minWidth: 80 },
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions', 'columnGroups'] },
  // `&noFlash` (closeout fix wave, I5/C3) boots with flash OFF — the real
  // default for a plain grid, and the exact configuration C3's bug needed
  // (the base harness always ran with flash on, which happened to mask it).
  enableCellChangeFlash: !NO_FLASH,
  cellSelection: {},
  // `&suppressPartial` (only meaningful alongside `?paintHarness`) forces
  // every repaint to the full-surface path — the invariance spec's control
  // arm for damage-region rendering.
  ...(SUPPRESS_PARTIAL ? { suppressPartialRepaint: true } : {}),
  // `&grouped` (closeout fix wave, I5/C4) — every desk group expanded with
  // footer totals on, so a live tick on an aggregated column changes a
  // group's total while scrolling can pin that group's ancestor in the
  // sticky band above the fetch window.
  ...(GROUPED ? { groupIncludeFooter: true, groupDefaultExpanded: 'all' as const } : {}),
  ext: {
    // Replace the spine's bare Settings/Save with the full MarketsGrid-style
    // title bar (brand, search, notifications, profiles, save, date, settings,
    // overflow). The Grid Options module still opens from the settings icon.
    extensions: [
      { remove: 'settings-launcher' },
      { remove: 'save' },
      ...titleBarExtensions({ name: 'MarketsGrid', date: new Date().toISOString().slice(0, 10) }),
      ...ribbonExtensions({ edit: () => editHandle }),
    ],
  },
});

// Wire cgrid's engines onto the owned grid: format (compiles the string
// valueFormatters / DSL above), edit (editors + Smart Edit / Bulk Update),
// calc (calculated columns + styling templates), rules (conditional styles).
wireFormat(ext.grid);
// Re-issue defs so the now-registered format compiler picks up the string
// valueFormatters ('#,##0.00', '[Red]…'). Must run right after wireFormat and
// BEFORE calc/rules wire — re-issuing after calc resets its override baseline
// so later editColumn() edits don't repaint.
ext.grid.updateGridOptions({ columnDefs });
editHandle = wireEditIntoKernel(ext.grid);
(window as unknown as { __edit: unknown }).__edit = editHandle;
wireCalc(ext.grid);
wireRules(ext.grid);

// Expose for console poking + the hermetic E2E suite.
(window as unknown as { __ext: unknown }).__ext = ext;

// cgrid's side-panel rail (Columns / Filters / Grid Options / Column Groups)
// must always be visible on load. persistState can restore it hidden from a
// prior session, and that restore runs async after construction — so force it
// visible now and again after the restore settles.
const showSidebar = () => { try { ext.grid.setSideBarVisible(true); } catch { /* ignore */ } };
showSidebar();
requestAnimationFrame(showSidebar);
setTimeout(showSidebar, 250);

if (PAINT_HARNESS) {
  // ─── Pixel-invariance harness boot ────────────────────────────────────
  // No STOMP feed at all — both the partial and suppressed harness pages
  // must see byte-identical data, so the feed (async, server-driven) is
  // never in the loop.
  const rows = seedHarnessRows();
  rows.forEach(decorateWithCategoricals);
  ext.setRowData(rows);

  // Closeout fix wave (I5 / C4) — `&grouped` row-groups the `desk` column
  // (4 distinct values across 200 harness rows, ~50 rows/group) with every
  // group expanded + footer totals on, so scrolling partway into a group
  // pins its ancestor(s) in the sticky band above the fetch window — the
  // exact "grouped + sticky + live tick" configuration C4 targets. A
  // colDef-level `rowGroup: true` does NOT auto-activate grouping at
  // construction (`GroupingCoordinator` is always seeded with an empty
  // `rowGroupCols` — see cgrid.ts's ctor comment), so this goes through
  // the real runtime API instead, same as a user dragging the column into
  // the row-group panel would.
  if (GROUPED) {
    ext.grid.setRowGroupColumns(['desk']);
  }

  (window as unknown as { __paintHarness: unknown }).__paintHarness = {
    rows,
    snapshot(): string {
      const c = document.querySelector('.cg-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let h = 0; // FNV-1a over every 16th byte — fast, deterministic
      for (let i = 0; i < d.length; i += 16) { h ^= d[i]!; h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    },
    /** Resolves once `getPaintStats().paints` is unchanged for at least two
     *  consecutive animation frames AND a short quiet window — the "fully
     *  settled" signal the invariance spec waits on before hashing. A pure
     *  frame-count check (e.g. "2 RAFs with no change") is too tight here:
     *  a mutation's repaint often depends on an async worker round-trip
     *  (postMessage for the recomputed viewport chunk) that can still be
     *  in flight after 2 RAFs have already ticked with no visible change,
     *  which would report "settled" before the real repaint ever lands.
     *  The quiet-time floor absorbs that latency regardless of how many
     *  frames it spans. */
    waitSettled(): Promise<void> {
      const QUIET_MS = 250;
      const MAX_MS = 8000;
      return new Promise((resolve) => {
        const g = ext.grid;
        let last = g.getPaintStats().paints;
        let lastChangeTime = performance.now();
        let framesSinceChange = 0;
        const start = performance.now();
        const tick = () => {
          requestAnimationFrame(() => {
            const now = performance.now();
            const cur = g.getPaintStats().paints;
            if (cur !== last) {
              last = cur;
              lastChangeTime = now;
              framesSinceChange = 0;
            } else {
              framesSinceChange++;
            }
            const settled = framesSinceChange >= 2 && (now - lastChangeTime) >= QUIET_MS;
            if (settled || (now - start) > MAX_MS) { resolve(); return; }
            tick();
          });
        };
        tick();
      });
    },
  };
} else {
  // ─── STOMP feed ────────────────────────────────────────────────────────
  // The shell + grid are already mounted above and stay visible regardless
  // of feed state; connectStomp's onPhase('error') only affects these logs.
  connectStomp({
    onPhase: (phase) => { console.info(`[cgrid-ext-demo] stomp phase: ${phase}`); },
    onSnapshot: (rows) => { rows.forEach(decorateWithCategoricals); ext.setRowData(rows); },
    onLiveUpdate: (updates) => { updates.forEach(decorateWithCategoricals); ext.grid.applyTransactionAsync({ update: updates }); },
  });
}
