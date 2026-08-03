// Headless smoke for the CGridExt + SSRM demo.
// Run `npm run dev:ext-ssrm-demo` first, then `node scripts/smoke.mjs`.
// Drives the wrapped grid through the sparse-SSRM lifecycle: grouped boot
// (colDef rowGroup seeding), expand (local reflow + lazy leaf fetch),
// live ticks, ungroup to the flat 50k window, regroup. Exits non-zero on
// any page error. Screenshot lands in test-results/ (gitignored).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto('http://localhost:5195/', { waitUntil: 'domcontentloaded' });

await page.waitForSelector('.cgext-grid canvas', { timeout: 15000 });
await page.waitForFunction(() => !!window.__demo?.grid, null, { timeout: 15000 });

// Grouped boot: desk → region seeded from colDefs; 6 desks collapsed.
await page.waitForFunction(
  () => window.__demo.grid.getDisplayedRowCount() >= 6,
  null, { timeout: 15000 },
);
console.log('boot:', JSON.stringify(await page.evaluate(() => ({
  rows: window.__demo.grid.getDisplayedRowCount(),
  groups: window.__demo.grid.getState().rowGroupColumns,
  ssrmV2: window.__demo.grid.ssrmV2,
}))));

// Expand one desk — skeleton children appear via local reflow.
await page.evaluate(() => window.__demo.grid.setExpanded('desk:Commodities', true));
await page.waitForFunction(
  () => window.__demo.grid.getDisplayedRowCount() > 6,
  null, { timeout: 15000 },
);
console.log('after expand:', await page.evaluate(() => window.__demo.grid.getDisplayedRowCount()));

// Live ticks keep the server busy (soft refresh + leaf refetch).
const reqA = await page.evaluate(() => window.__demo.server.requestCount);
await wait(2500);
const reqB = await page.evaluate(() => window.__demo.server.requestCount);
console.log('server requests over 2.5s:', reqA, '->', reqB);

// Ungroup → flat SSRM windowing over the whole book.
await page.evaluate(() => window.__demo.grid.setRowGroupColumns([]));
await page.waitForFunction(
  () => window.__demo.grid.getDisplayedRowCount() > 40_000,
  null, { timeout: 20000 },
);
console.log('flat rows:', await page.evaluate(() => window.__demo.grid.getDisplayedRowCount()));

// Regroup by region only — assert the count SETTLES AND HOLDS: sampled
// in-page every 50ms, the final 1.5s of an (up to) 8s window must be
// entirely in the group range. A stale flat count reasserting late fails
// with the full transition log.
const settle = await page.evaluate(async () => {
  const g = window.__demo.grid;
  const transitions = [];
  let prev = null;
  const t0 = performance.now();
  g.setRowGroupColumns(['region']);
  let heldSince = null;
  while (performance.now() - t0 < 8000) {
    const n = g.getDisplayedRowCount();
    const t = performance.now() - t0;
    if (n !== prev) { transitions.push(`${Math.round(t)}ms -> ${n}`); prev = n; }
    const inRange = n >= 3 && n <= 10;
    heldSince = inRange ? (heldSince ?? t) : null;
    if (heldSince !== null && t - heldSince >= 1500) {
      return { ok: true, n, transitions };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { ok: false, n: prev, transitions };
});
console.log('regrouped by region (held 1.5s):', settle.n, '—', settle.transitions.join(', '));
if (!settle.ok) errors.push(`regroup never settled: ${settle.transitions.join(', ')}`);

await wait(800);
mkdirSync(new URL('../test-results/', import.meta.url), { recursive: true });
await page.screenshot({ path: new URL('../test-results/smoke.png', import.meta.url).pathname.slice(1) });

if (errors.length) {
  console.log('PAGE ERRORS:');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('SMOKE OK — no page errors');
}
await browser.close();
