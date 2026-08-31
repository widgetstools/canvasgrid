/**
 * VelocityGrid vs AG Grid — behavioural comparison harness.
 *
 * Drives BOTH grids with the same rows and the same operations, then diffs
 * what each one reports. The point is not "does the feature exist" (the
 * catalog in docs/catalog/FEATURE_MATRIX.md already tracks that) but "given
 * identical input, do they produce identical output".
 *
 * Data identity is enforced rather than assumed: the rows are generated once
 * here and pushed into both grids, so any difference is attributable to the
 * grid and not to the dataset.
 *
 * Usage:
 *   npm run dev:aggrid            # AG Grid reference   :5220
 *   npm run dev:csrm-provider     # VelocityGrid CSRM   :5210
 *   node scripts/compare-aggrid.mjs
 */
import { chromium } from '@playwright/test';

const AG = 'http://localhost:5220/';
const VG = 'http://localhost:5210/';
const ROWS = 2000;

// ── the shared dataset ───────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRows(count, seed = 42) {
  const rnd = mulberry32(seed);
  const DESKS = ['FX', 'Rates', 'Credit', 'Equities', 'Commodities'];
  const REGIONS = ['EMEA', 'AMER', 'APAC'];
  const INSTRUMENTS = ['Bond', 'Swap', 'Future', 'Option', 'Repo'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const notional = Math.round(rnd() * 5_000_000) + 100_000;
    const pnl = Math.round((rnd() - 0.5) * 400_000);
    out.push({
      positionId: `POS-${String(i).padStart(6, '0')}`,
      ticker: `TICK${Math.floor(rnd() * 900) + 100}`,
      desk: DESKS[Math.floor(rnd() * DESKS.length)],
      region: REGIONS[Math.floor(rnd() * REGIONS.length)],
      instrumentType: INSTRUMENTS[Math.floor(rnd() * INSTRUMENTS.length)],
      notionalAmount: notional,
      marketValue: notional + pnl,
      pnl,
      dailyPnl: Math.round((rnd() - 0.5) * 40_000),
    });
  }
  return out;
}

// ── scenarios: each returns a normalised observation from either grid ─────
const SCENARIOS = [
  {
    id: 'row-count',
    title: 'Row count after load',
    // AG counts its in-scroll grand-total row in getDisplayedRowCount;
    // VelocityGrid pins its own, so it is outside the count. Compare the
    // number of DATA rows so both sides mean the same thing.
    ag: async (p) => p.evaluate(() => {
      let n = 0; window.__ag.api.forEachNode((node) => { if (!node.group && node.data) n++; });
      return { dataRows: n };
    }),
    vg: async (p) => p.evaluate(() => ({ dataRows: window.__demo.grid.getDisplayedRowCount() })),
  },
  {
    id: 'sort-asc',
    title: 'Sort by pnl ascending — first 10 positionIds',
    ag: async (p) => p.evaluate(async () => {
      const api = window.__ag.api;
      api.applyColumnState({ state: [{ colId: 'pnl', sort: 'asc' }], defaultState: { sort: null } });
      await new Promise((r) => setTimeout(r, 600));
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push(api.getDisplayedRowAtIndex(i)?.data?.positionId ?? null);
      return { ids };
    }),
    vg: async (p) => p.evaluate(async () => {
      const g = window.__demo.grid;
      g.setSortModel([{ colId: 'pnl', direction: 'asc' }]);
      await new Promise((r) => setTimeout(r, 900));
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push(g.getCellValue(i, 'positionId') ?? null);
      return { ids };
    }),
  },
  {
    id: 'sort-desc',
    title: 'Sort by pnl descending — first 10 positionIds',
    ag: async (p) => p.evaluate(async () => {
      const api = window.__ag.api;
      api.applyColumnState({ state: [{ colId: 'pnl', sort: 'desc' }], defaultState: { sort: null } });
      await new Promise((r) => setTimeout(r, 600));
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push(api.getDisplayedRowAtIndex(i)?.data?.positionId ?? null);
      return { ids };
    }),
    vg: async (p) => p.evaluate(async () => {
      const g = window.__demo.grid;
      g.setSortModel([{ colId: 'pnl', direction: 'desc' }]);
      await new Promise((r) => setTimeout(r, 900));
      const ids = [];
      for (let i = 0; i < 10; i++) ids.push(g.getCellValue(i, 'positionId') ?? null);
      return { ids };
    }),
  },
  {
    id: 'filter-equals',
    title: 'Filter desk = FX — matching row count',
    ag: async (p) => p.evaluate(async () => {
      const api = window.__ag.api;
      // `filter: true` resolves to the SET filter for a text column in AG 36,
      // whose model shape is { values: [...] }. Force the text filter so both
      // grids receive the identical model and the test compares filtering.
      api.setColumnFilterModel('desk', null);
      api.setGridOption('columnDefs', api.getColumnDefs().map((c) =>
        c.field === 'desk' ? { ...c, filter: 'agTextColumnFilter' } : c));
      await new Promise((r) => setTimeout(r, 400));
      api.setFilterModel({ desk: { filterType: 'text', type: 'equals', filter: 'FX' } });
      await new Promise((r) => setTimeout(r, 700));
      // Data rows only — AG counts its grand-total row as displayed.
      let n = 0; api.forEachNodeAfterFilter((node) => { if (!node.group && node.data) n++; });
      return { matched: n };
    }),
    vg: async (p) => p.evaluate(async () => {
      const g = window.__demo.grid;
      g.setFilterModel({ desk: { filterType: 'text', type: 'equals', filter: 'FX' } });
      await new Promise((r) => setTimeout(r, 1200));
      return { matched: g.getDisplayedRowCount() };
    }),
  },
  {
    id: 'group-desk',
    title: 'Group by desk — group keys and sum(pnl) per group',
    ag: async (p) => p.evaluate(async () => {
      const api = window.__ag.api;
      api.setFilterModel(null);
      api.applyColumnState({ state: [{ colId: 'desk', rowGroup: true }], defaultState: { rowGroup: false, sort: null } });
      await new Promise((r) => setTimeout(r, 900));
      const groups = {};
      api.forEachNode((n) => { if (n.group && n.level === 0) groups[String(n.key)] = n.aggData?.pnl ?? null; });
      return { groups };
    }),
    vg: async (p) => p.evaluate(async () => {
      const g = window.__demo.grid;
      g.setFilterModel({});
      g.setSortModel([]);
      g.setRowGroupColumns(['desk']);
      g.setValueColumns([{ colId: 'pnl', aggFunc: 'sum' }]);
      await new Promise((r) => setTimeout(r, 1600));
      const groups = {};
      for (let i = 0; i < g.getDisplayedRowCount(); i++) {
        if (!g.isGroupRow(i)) continue;
        const key = g.getGroupKeyAtRow(i);
        // Strip VelocityGrid's composite `<field>:` prefix so the comparison
        // is of group identity, not of internal key encoding.
        if (key) groups[String(key).replace(/^[^:]+:/, '')] = g.getCellValue(i, 'pnl');
      }
      return { groups };
    }),
  },
  {
    id: 'pivot',
    title: 'Pivot desk x region, sum(pnl) — result column ids',
    ag: async (p) => p.evaluate(async () => {
      const api = window.__ag.api;
      // Only pnl carries an aggFunc, or AG pivots all four numeric columns
      // and the comparison measures my column config rather than the grids.
      api.applyColumnState({
        state: [
          { colId: 'desk', rowGroup: true },
          { colId: 'region', pivot: true },
          { colId: 'pnl', aggFunc: 'sum' },
          { colId: 'notionalAmount', aggFunc: null },
          { colId: 'marketValue', aggFunc: null },
          { colId: 'dailyPnl', aggFunc: null },
        ],
        defaultState: { rowGroup: false, pivot: false },
      });
      api.setGridOption('pivotMode', true);
      await new Promise((r) => setTimeout(r, 1400));
      return {
        pivotMode: api.isPivotMode(),
        // Decoded, not raw: AG spells a result column `pivot_region_AMER_pnl`
        // and VelocityGrid `pivotcol<sep>AMER<sep>pnl`. The encoding is
        // internal; the cross-tab it describes is what has to match.
        crossTab: (api.getPivotResultColumns() ?? [])
          .map((c) => c.getColId().replace(/^pivot_region_/, '').replace(/_/g, '/')).sort(),
      };
    }),
    vg: async (p) => p.evaluate(async () => {
      const g = window.__demo.grid;
      g.setRowGroupColumns(['desk']);
      g.setPivotColumns(['region']);
      g.setValueColumns([{ colId: 'pnl', aggFunc: 'sum' }]);
      g.setPivotMode(true);
      await new Promise((r) => setTimeout(r, 2500));
      return {
        pivotMode: g.isPivotMode(),
        // Decoded the same way as AG above: drop the `pivotcol` marker and
        // join the remaining path segments, so what is compared is the
        // cross-tab (pivot key / value column) rather than the id spelling.
        crossTab: g.getPivotResultColumns()
          .map((c) => c.split(String.fromCharCode(1)).slice(1).join('/')).sort(),
      };
    }),
  },
];

// ── feature probes: presence, not behaviour ──────────────────────────────
const PROBES = [
  { id: 'tree-data', title: 'Tree data (getDataPath)',
    ag: () => true, vgKey: 'treeData' },
  { id: 'master-detail', title: 'Master / detail (nested grids)',
    ag: () => true, vgKey: 'masterDetail' },
];

async function open(browser, url, readySelectorFn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await readySelectorFn(page);
  return { page, errors };
}

const rows = makeRows(ROWS);
const browser = await chromium.launch();

const ag = await open(browser, AG, async (p) => {
  await p.waitForSelector('.ag-root-wrapper', { timeout: 45000 });
  await p.waitForTimeout(3000);
});
const vg = await open(browser, VG, async (p) => {
  await p.waitForFunction(() => window.__demo?.ext !== undefined, { timeout: 45000 });
  await p.waitForTimeout(4000);
});

// Identical data in both. AG gets it via setGridOption, VG via setRowData.
await ag.page.evaluate((rows) => {
  window.__ag.api.setGridOption('rowData', rows);
}, rows);
await vg.page.evaluate((rows) => {
  window.__demo.grid.setRowData(rows);
}, rows);
await ag.page.waitForTimeout(2000);
await vg.page.waitForTimeout(2500);

console.log('\n' + '='.repeat(78));
console.log(`VelocityGrid vs AG Grid 36.1.0 — ${ROWS} identical rows`);
console.log('='.repeat(78));

const results = [];
for (const s of SCENARIOS) {
  let a, v, err = null;
  try { a = await s.ag(ag.page); } catch (e) { a = { error: String(e).slice(0, 120) }; }
  try { v = await s.vg(vg.page); } catch (e) { v = { error: String(e).slice(0, 120) }; }
  const same = JSON.stringify(a) === JSON.stringify(v);
  results.push({ id: s.id, title: s.title, ag: a, vg: v, same, err });
  console.log(`\n${same ? 'MATCH  ' : 'DIFFER '} ${s.title}`);
  if (!same) {
    console.log('   ag:', JSON.stringify(a).slice(0, 300));
    console.log('   vg:', JSON.stringify(v).slice(0, 300));
  } else {
    console.log('   both:', JSON.stringify(a).slice(0, 200));
  }
}

console.log('\n' + '-'.repeat(78));
console.log('Feature presence (from the kernel source, not a runtime probe):');
for (const probe of PROBES) {
  console.log(`  ${probe.title.padEnd(38)} ag: yes   velocitygrid: no`);
}

console.log('\n' + '-'.repeat(78));
console.log('page errors — ag:', ag.errors.length || 'none', ' vg:', vg.errors.length || 'none');
if (ag.errors.length) console.log('  ag:', ag.errors.slice(0, 2));
if (vg.errors.length) console.log('  vg:', vg.errors.slice(0, 2));

const matched = results.filter((r) => r.same).length;
console.log(`\nBehavioural scenarios: ${matched}/${results.length} identical`);
console.log('='.repeat(78) + '\n');

await browser.close();
