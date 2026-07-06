/**
 * cgrid Customizer Demo — Cycle 21i interactive testbed.
 *
 * ZERO feature code lives here: this app is a plain consumer that
 * instantiates CGrid with the features under test enabled and pipes in the
 * stomp-view-server feed (ws://localhost:8081 — run it from
 * /Users/develop/wfh/starui/apps/stomp-view-server). If something can't be
 * done through the public API, that's a kernel gap to fix in the kernel,
 * never worked around here.
 */
import { CGrid, formatPrice32, DEFAULT_LAYOUT_ID, themeStarui, type CColDef, type CColGroupDef, type GridLayoutsBundle, type CgThemeParams } from '@cgrid/kernel';
import '@cgrid/kernel/style.css';
import { wireIntoKernel as wireFormat } from '@cgrid/format';
import { wireEditIntoKernel } from '@cgrid/edit';
import { wireIntoKernel as wireCalc } from '@cgrid/calc';
import { wireIntoKernel as wireRules, type ConditionalStyleRule } from '@cgrid/rules';
import { connectStomp, STOMP_PUBLISH_RATE_PER_SEC, type Position } from './stomp';

const DESKS = ['RATES', 'CREDIT', 'FX', 'EQD'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const TRADERS = ['patel', 'okafor', 'lindqvist', 'tanaka', 'reyes'];

/** Deterministic categoricals derived from positionId so grouping/pivot
 *  demos have stable dimensions across snapshots and live updates. */
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

// Cycle 21i / Task 5 — seed a couple of NESTED column groups so the new
// "Column Groups" tab opens with real content to inspect/edit. Everything
// else stays flat/ungrouped. Only the placement changed — the underlying
// `num(...)`/`cat(...)` call sites (and their options) are untouched.
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
        // Task 10 — starts OPEN so the seeded grid shows marketValue by
        // default; the caret's collapse affordance is what hides it.
        openByDefault: true,
        children: [
          num('Notional', 'notionalAmount', { valueFormatter: '#,##0', aggFunc: 'sum' }),
          // Task 10 — `columnGroupShow: 'open'` so collapsing "Valuation"
          // has a visible effect (this column drops out of the viewport)
          // and the group header caret has something real to demonstrate.
          num('Mkt Value', 'marketValue', { valueFormatter: '#,##0', aggFunc: 'sum', columnGroupShow: 'open' }),
        ],
      },
      num('P&L', 'pnl', {
        aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)',
        cellClassRules: {
          pnlpos: (p: { value: unknown }) => Number(p.value) > 0,
          pnlneg: (p: { value: unknown }) => Number(p.value) < 0,
        },
      }),
      // CSS-driven styling demo (WS-B) — the *appearance* of these classes
      // lives entirely in CSS custom properties in style.css
      // (`--cg-cell-class-{loss,gain}-*`): left border, corner decorator glyph,
      // fg colour, font-weight — all mapped onto the canvas paint artifacts.
      // Only the predicate (which class a cell gets) is code.
      num('Daily P&L', 'dailyPnl', {
        aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)',
        cellClassRules: {
          loss: (p: { value: unknown }) => Number(p.value) < 0,
          gain: (p: { value: unknown }) => Number(p.value) > 0,
        },
      }),
    ],
  },
  // Price uses the reference 32nds bond editor: displayed as `101-16`, edited
  // in the same notation. Try it with the Edit trigger set to "Excel-style"
  // in the Grid Options panel — type a digit to enter quick-entry, F2 /
  // double-click to caret-edit, and enter e.g. `101-16+` (half-tick).
  num('Price', 'currentPrice', {
    cellEditor: 'price32',
    valueFormatter: (p: { value: unknown }) => formatPrice32(p.value as number),
  }),
  num('Unrealized', 'unrealizedPnl', {
    aggFunc: 'sum', valueFormatter: '#,##0;[Red](#,##0)',
    cellClassRules: {
      pnlpos: (p: { value: unknown }) => Number(p.value) > 0,
      pnlneg: (p: { value: unknown }) => Number(p.value) < 0,
    },
  }),
  {
    groupId: 'risk',
    headerName: 'Risk',
    children: [
      num('DV01', 'dv01', { aggFunc: 'sum' }),
      num('PV01', 'pv01', { aggFunc: 'sum' }),
      num('Yield', 'yield', { valueFormatter: '0.000' }),
      // Token-referenceable cellStyle demo (WS-C) — the fg colour is authored
      // as a theme-token reference, resolved through the active theme's CSS
      // (starui/quartz both declare --cg-info-color) instead of a hardcoded hex.
      num('Spread', 'spread', { cellStyle: { fg: 'var(--cg-info-color)' } }),
    ],
  },
];

const appEl = document.querySelector<HTMLDivElement>('.app')!;
const gridHost = document.getElementById('grid')!;
const themeBtn = document.getElementById('theme')!;
const resetBtn = document.getElementById('reset-state')!;
const statusPhase = document.querySelector<HTMLElement>('[data-testid="status-phase"]')!;
const statusRows = document.querySelector<HTMLElement>('[data-testid="status-rows"]')!;
const statusUps = document.querySelector<HTMLElement>('[data-testid="status-ups"]')!;

const savedTheme = localStorage.getItem('custdemo:theme');
let dark = savedTheme !== 'light';

const grid = new CGrid<Position>(gridHost, {
  gridId: 'customizer-demo',
  persistState: true,
  getRowId: (r) => r.positionId,
  columnDefs,
  theme: dark ? 'cg-theme-starui-dark' : 'cg-theme-starui',
  // editable: true so the testbed can exercise the edit trigger (single /
  // double click) out of the box; group / totals / pivot cells stay
  // read-only via the editable predicate.
  defaultColDef: { resizable: true, sortable: true, editable: true, flex: 1, minWidth: 80 },
  rowGroupPanelShow: 'always',
  sideBar: { toolPanels: ['columns', 'filters', 'gridOptions', 'columnGroups'] },
  enableCellChangeFlash: true,
  cellSelection: {},
});

// The format compiler registers after construction; re-issue the defs so
// string valueFormatters ('#,##0.00', '[Red]…') compile through the DSL.
wireFormat(grid);
grid.updateGridOptions({ columnDefs });

// Programmatic CgTheme demo hook — build a theme object from the starui
// built-in and apply it, so live re-tinting (accent → focus/hover/selection
// derived via color-mix) can be exercised from the console:
//   __cgTheme.apply({ accentColor: '#e0873a' })  // orange accent, everything re-tints
//   __cgTheme.apply({})                            // back to plain starui
//   __cgTheme.mode('dark' | 'light')
(window as unknown as { __cgTheme: unknown }).__cgTheme = {
  apply: (params: CgThemeParams = {}) => grid.setTheme(themeStarui.withParams(params)),
  mode: (m: 'light' | 'dark') => grid.setThemeMode(m),
};

// Cycle 21i Phase 2 — wire the edit engine; its settings persist through
// the kernel module-state registry (GridState.modules.editSettings). The
// editing UI returns as SettingsSheet modules in the Phase 3 pivot.
wireEditIntoKernel(grid);

// Grid Layouts / Phase B — wire the calc engine. This lights up the styling
// TEMPLATE library + calculated columns (both persist through the module
// registry and ride in layouts). The returned engine is used below only to
// register a calculated column; everything else goes through the public
// CGridApi template methods (getTemplates / saveTemplate / applyTemplate /
// editColumn).
const { calc } = wireCalc(grid);

// Grid Layouts / Phase C — wire the conditional-rules engine. Rules ride the
// layout-tier `rules` module (so they save/switch/import/export with layouts)
// and paint through the kernel's render-time rule fold. Everything below goes
// through the PUBLIC CGridApi rule methods (addRule / deleteRule / getRules).
const { rules } = wireRules(grid);


function applyTheme() {
  appEl.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.textContent = dark ? 'Light theme' : 'Dark theme';
  grid.setGridOption('theme', dark ? 'cg-theme-starui-dark' : 'cg-theme-starui');
  localStorage.setItem('custdemo:theme', dark ? 'dark' : 'light');
}
applyTheme();
themeBtn.addEventListener('click', () => { dark = !dark; applyTheme(); });

resetBtn.addEventListener('click', () => {
  grid.clearPersistedState();
  location.reload();
});

// ─── Demo switches ───────────────────────────────────────────────────────
// Live updates: pause/resume applying the STOMP stream to the grid.
let liveUpdates = true;
const liveSwitch = document.getElementById('live-updates') as HTMLInputElement;
liveSwitch.addEventListener('change', () => { liveUpdates = liveSwitch.checked; });

// Editable: toggle defaultColDef.editable so the whole grid becomes
// read-only or editable on demand.
const editableSwitch = document.getElementById('editable') as HTMLInputElement;
editableSwitch.addEventListener('change', () => {
  const dcd = (grid.getGridOption('defaultColDef') ?? {}) as Record<string, unknown>;
  grid.setGridOption('defaultColDef', { ...dcd, editable: editableSwitch.checked });
});

// ─── Layouts control ─────────────────────────────────────────────────────
// Exercises the Grid Layouts API (Phase A): save the current view as a named
// layout, switch between layouts, delete, and export/import as JSON. The
// <select> mirrors the active layout and re-syncs on every `layoutChanged`
// (including the restore that fires after persisted state loads).
const layoutSelect = document.getElementById('layout-select') as HTMLSelectElement;
const layoutSaveBtn = document.getElementById('layout-save') as HTMLButtonElement;
const layoutDeleteBtn = document.getElementById('layout-delete') as HTMLButtonElement;
const layoutExportBtn = document.getElementById('layout-export') as HTMLButtonElement;
const layoutImportBtn = document.getElementById('layout-import') as HTMLButtonElement;
const layoutFileInput = document.getElementById('layout-file') as HTMLInputElement;

function refreshLayoutControl() {
  const activeId = grid.getActiveLayoutId();
  layoutSelect.replaceChildren(
    ...grid.getLayouts().map((layout) => {
      const opt = document.createElement('option');
      opt.value = layout.id;
      opt.textContent = layout.name;
      opt.selected = layout.id === activeId;
      return opt;
    }),
  );
  // The Default layout can't be deleted.
  layoutDeleteBtn.disabled = activeId === DEFAULT_LAYOUT_ID;
}

layoutSelect.addEventListener('change', () => { grid.loadLayout(layoutSelect.value); });

layoutSaveBtn.addEventListener('click', () => {
  const name = prompt('Save the current view as a layout named:');
  if (!name || !name.trim()) return;
  try {
    grid.saveLayout(name.trim());
  } catch (err) {
    alert((err as Error).message);
  }
});

layoutDeleteBtn.addEventListener('click', () => {
  const id = layoutSelect.value;
  if (id !== DEFAULT_LAYOUT_ID) grid.deleteLayout(id);
});

layoutExportBtn.addEventListener('click', () => {
  const json = JSON.stringify(grid.exportLayouts(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgrid-layouts.json';
  a.click();
  URL.revokeObjectURL(url);
});

layoutImportBtn.addEventListener('click', () => layoutFileInput.click());
layoutFileInput.addEventListener('change', async () => {
  const file = layoutFileInput.files?.[0];
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text()) as GridLayoutsBundle;
    grid.importLayouts(bundle, { mode: 'merge' });
  } catch (err) {
    alert(`Couldn't import layouts: ${(err as Error).message}`);
  } finally {
    layoutFileInput.value = ''; // let the same file be re-selected
  }
});

grid.on('layoutChanged', refreshLayoutControl);

// ─── Styling templates control ───────────────────────────────────────────
// Exercises the Grid Layouts Phase-B template API through the PUBLIC CGridApi
// (no reach into the engine except registerCalculatedColumn). Demonstrates the
// four spec behaviours: apply a template, reuse ONE template across columns,
// edit a column → auto-template, and a calculated column styled by a template
// (which stays non-editable). The readout mirrors the library on templatesChanged.
const tplApplyBtn = document.getElementById('tpl-apply') as HTMLButtonElement;
const tplEditBtn = document.getElementById('tpl-edit') as HTMLButtonElement;
const tplCalcBtn = document.getElementById('tpl-calc') as HTMLButtonElement;
const tplCount = document.querySelector<HTMLElement>('[data-testid="tpl-count"]')!;

const MONEY_TEMPLATE_ID = 'money';

function refreshTemplateCount() {
  const n = grid.getTemplates().length;
  tplCount.textContent = `${n} template${n === 1 ? '' : 's'}`;
}

// Apply: save one "$ bold" template and assign it to TWO columns — proves a
// single template is reused across columns (not copied per-column).
tplApplyBtn.addEventListener('click', () => {
  grid.saveTemplate({
    id: MONEY_TEMPLATE_ID,
    name: 'Money ($)',
    overrides: { format: '$#,##0', cellStyle: { fontWeight: '600' } },
  });
  grid.applyTemplate('notionalAmount', MONEY_TEMPLATE_ID);
  grid.applyTemplate('marketValue', MONEY_TEMPLATE_ID);
});

// Edit → auto-template: patch the Yield column's format; the change lands in
// the column's OWN template (created on first edit) and rides in layouts.
tplEditBtn.addEventListener('click', () => {
  grid.editColumn('yield', { format: '0.0000' });
});

// Calc column styled by a template: register a calculated column, then apply
// the shared $ template to it. Calculated columns are forced non-editable by
// the kernel even when a template is attached.
tplCalcBtn.addEventListener('click', () => {
  const res = calc.registerCalculatedColumn({
    colId: 'pnlBps',
    headerName: 'P&L bps',
    expression: '[pnl] / [notionalAmount] * 10000',
    cellDataType: 'number',
  });
  if (!res.ok) { alert(`Calc column failed: ${res.errors.map((e) => e.message).join(', ')}`); return; }
  // Ensure the $ template exists to style it (idempotent save).
  grid.saveTemplate({
    id: MONEY_TEMPLATE_ID, name: 'Money ($)',
    overrides: { format: '$#,##0', cellStyle: { fontWeight: '600' } },
  });
  grid.applyTemplate('pnlBps', MONEY_TEMPLATE_ID);
});

grid.on('templatesChanged', refreshTemplateCount);
// Library-changing restores/imports mutate the engine directly (no
// templatesChanged), but they DO fire layoutChanged — re-sync the readout there
// too so it never goes stale after an import or a persisted-state restore.
grid.on('layoutChanged', refreshTemplateCount);

// ─── Conditional rules control ───────────────────────────────────────────
// Exercises the Grid Layouts Phase-C rules API through the PUBLIC CGridApi.
// Two rules demonstrate BOTH targets (spec §3.2): a CELL rule flags negative
// P&L red, a ROW rule tints large positions. Because rules ride the layout-tier
// `rules` module, saving a layout captures them and switching layouts swaps the
// set — the Layout cluster above drives that. The readout mirrors the rule
// count on `rulesChanged` + `layoutChanged` (restores/imports re-sync there).
const ruleLossBtn = document.getElementById('rule-loss') as HTMLButtonElement;
const ruleRowBtn = document.getElementById('rule-row') as HTMLButtonElement;
const ruleClearBtn = document.getElementById('rule-clear') as HTMLButtonElement;
const ruleCount = document.querySelector<HTMLElement>('[data-testid="rule-count"]')!;

function refreshRuleCount() {
  const n = grid.getRules().length;
  ruleCount.textContent = `${n} rule${n === 1 ? '' : 's'}`;
}

// Cell-target rule: negative P&L cells get a red background tint + bold weight.
// (The P&L column already reds negative TEXT via its `[Red]` formatter, so the
// rule uses a background so its effect is unmistakably distinct — this layers
// OVER the formatter at paint time.) Theme-aware: a darker tint in dark mode.
const LOSS_RULE: ConditionalStyleRule = {
  kind: 'style', id: 'loss', name: 'Losses', enabled: true, priority: 10,
  condition: '[pnl] < 0', scope: { kind: 'cell', columnIds: ['pnl'] },
  style: { base: { backgroundColor: '#fee2e2', fontWeight: 'bold' }, dark: { backgroundColor: '#4a1d1d' } },
};

// Row-target rule: large positions tint the whole row.
const BIG_ROW_RULE: ConditionalStyleRule = {
  kind: 'style', id: 'big-row', name: 'Big positions', enabled: true, priority: 5,
  condition: '[notionalAmount] > 5000000', scope: { kind: 'row' },
  style: { base: { backgroundColor: '#fef3c7' }, dark: { backgroundColor: '#3a3520' } },
};

// addRule is idempotent by id (no-op on a duplicate), so re-clicking is safe.
ruleLossBtn.addEventListener('click', () => grid.addRule(LOSS_RULE));
ruleRowBtn.addEventListener('click', () => grid.addRule(BIG_ROW_RULE));
ruleClearBtn.addEventListener('click', () => {
  for (const r of grid.getRules()) grid.deleteRule(r.id);
});

grid.on('rulesChanged', refreshRuleCount);
grid.on('layoutChanged', refreshRuleCount);

// ─── STOMP feed ──────────────────────────────────────────────────────────
let updatesThisSecond = 0;
setInterval(() => {
  statusUps.textContent = `${updatesThisSecond} of ${STOMP_PUBLISH_RATE_PER_SEC} upd/s`;
  updatesThisSecond = 0;
}, 1000);

connectStomp({
  onPhase: (phase) => { statusPhase.textContent = phase; },
  onSnapshot: (rows) => {
    rows.forEach(decorateWithCategoricals);
    grid.setRowData(rows);
    statusRows.textContent = `Rows: ${rows.length.toLocaleString()}`;
  },
  onLiveUpdate: (updates) => {
    if (!liveUpdates) return; // paused — drop the batch, keep the grid static
    updates.forEach(decorateWithCategoricals);
    grid.applyTransactionAsync({ update: updates });
    updatesThisSecond += updates.length;
  },
});

// Console access for poking at the public API while testing, and hooks the
// hermetic E2E suite drives (see apps/cgrid-customizer-demo/e2e/). `__cgapi`
// is the object handed to `gridReady` (has `getColumnGroupDefs()` etc.) —
// distinct from `__cgrid`, which is the CGrid instance itself.
(window as unknown as { __cgrid: unknown }).__cgrid = grid;
// Calc engine test hook (same role as __cgrid/__cgapi) — lets the templates
// E2E assert override assignments + calc-column non-editability through the
// engine's read accessors.
(window as unknown as { __cgcalc: unknown }).__cgcalc = calc;
// Rules engine test hook — lets the rules E2E assert eval + watched-column
// behaviour through the engine's read accessors (evaluateCell / getRules).
(window as unknown as { __cgrules: unknown }).__cgrules = rules;
grid.on('gridReady', (e) => {
  (window as unknown as { __cgapi: unknown }).__cgapi = e.api;
  (window as unknown as { __cgridReady: boolean }).__cgridReady = true;
  refreshLayoutControl(); // seed the switcher; a persisted-state restore re-syncs it via layoutChanged
  refreshTemplateCount(); // seed the template readout; templatesChanged re-syncs it
  refreshRuleCount(); // seed the rule readout; rulesChanged re-syncs it
});
