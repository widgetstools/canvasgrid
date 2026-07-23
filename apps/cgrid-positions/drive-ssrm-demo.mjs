/**
 * Drive the SSRM demo (localhost:5191) headlessly and screenshot it.
 * Temporary driver — run via `node drive-ssrm-demo.mjs <outDir>`.
 */
import { chromium } from '@playwright/test';

const outDir = process.argv[2] ?? '.';
const consoleErrors = [];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
});
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${String(err).slice(0, 300)}`));

await page.goto('http://localhost:5191/?feed=seed', { waitUntil: 'domcontentloaded' });

// Connect only when idle — the button is a TOGGLE, and clicking while the
// demo's auto-connect is mid-flight would disconnect it.
await page.waitForFunction(() => window.__book != null, null, { timeout: 15_000 });
await page.waitForTimeout(1000);
const phase0 = await page.evaluate(() => window.__book.getPhase());
if (phase0 === 'idle' || phase0 === 'error') {
  await page.getByRole('button', { name: 'Connect' }).click({ timeout: 15_000 });
}

// Wait for a mounted blotter with data (seed snapshot streams 10k rows).
await page.waitForFunction(() => {
  const b = window.__blotters;
  if (!b || b.size === 0) return false;
  const grid = [...b.values()][0].grid;
  return grid.getDisplayedRowCount() > 9000;
}, null, { timeout: 45_000 });

const flatCount = await page.evaluate(() => [...window.__blotters.values()][0].grid.getDisplayedRowCount());
await page.waitForTimeout(1500); // let live ticks + totals settle
await page.screenshot({ path: `${outDir}/1-flat.png` });

// Group by region → desk through the public API (same path the panel uses).
await page.evaluate(() => {
  [...window.__blotters.values()][0].grid.setRowGroupColumns(['region', 'desk']);
});
await page.waitForFunction(() => {
  const grid = [...window.__blotters.values()][0].grid;
  const n = grid.getDisplayedRowCount();
  return n > 0 && n <= 10; // collapsed region roots
}, null, { timeout: 20_000 });
const collapsedCount = await page.evaluate(() => [...window.__blotters.values()][0].grid.getDisplayedRowCount());
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/2-grouped-collapsed.png` });

// Expand AMER, then AMER → Credit Trading.
await page.evaluate(() => {
  const grid = [...window.__blotters.values()][0].grid;
  grid.setExpanded('region:AMER', true);
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const grid = [...window.__blotters.values()][0].grid;
  grid.setExpanded('region:AMER::desk:Credit Trading', true);
});
await page.waitForFunction(() => {
  const grid = [...window.__blotters.values()][0].grid;
  return grid.getDisplayedRowCount() > 20; // leaves streaming in
}, null, { timeout: 20_000 });
const expandedCount = await page.evaluate(() => [...window.__blotters.values()][0].grid.getDisplayedRowCount());
await page.waitForTimeout(1200); // leaf blocks hydrate + ticks
await page.screenshot({ path: `${outDir}/3-expanded.png` });

// Collapse the desk again — same-frame local reflow.
await page.evaluate(() => {
  [...window.__blotters.values()][0].grid.setExpanded('region:AMER::desk:Credit Trading', false);
});
await page.waitForTimeout(600);
const recollapsedCount = await page.evaluate(() => [...window.__blotters.values()][0].grid.getDisplayedRowCount());

console.log(JSON.stringify({
  flatCount,
  collapsedCount,
  expandedCount,
  recollapsedCount,
  consoleErrors: consoleErrors.slice(0, 10),
  errorCount: consoleErrors.length,
}, null, 2));

await browser.close();
