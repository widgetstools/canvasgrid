/** Wide-viewport pass: pinned grand total + sticky band under scroll. */
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '.';
const errors = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 2900, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${String(e).slice(0, 200)}`));

await page.goto('http://localhost:5191/?feed=seed', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__book != null, null, { timeout: 15_000 });
await page.waitForTimeout(1000);
if (['idle', 'error'].includes(await page.evaluate(() => window.__book.getPhase()))) {
  await page.getByRole('button', { name: 'Connect' }).click();
}
await page.waitForFunction(
  () => [...window.__blotters.values()][0]?.grid.getDisplayedRowCount() > 9000,
  null, { timeout: 60_000 },
);

await page.evaluate(() => {
  const grid = [...window.__blotters.values()][0].grid;
  grid.setRowGroupColumns(['region', 'desk']);
});
await page.waitForFunction(
  () => [...window.__blotters.values()][0].grid.getDisplayedRowCount() === 3,
  null, { timeout: 20_000 },
);
await page.evaluate(() => {
  const grid = [...window.__blotters.values()][0].grid;
  grid.setExpanded('region:AMER', true);
  grid.setExpanded('region:AMER::desk:Credit Trading', true);
});
await page.waitForFunction(
  () => [...window.__blotters.values()][0].grid.getDisplayedRowCount() > 600,
  null, { timeout: 20_000 },
);
await page.waitForTimeout(1500);
// Grand total + group aggregates visible at this width.
await page.screenshot({ path: `${out}/4-wide-grouped.png`, clip: { x: 0, y: 350, width: 1450, height: 590 } });

// Scroll deep inside Credit Trading's leaves — sticky band + leaf fetch.
await page.mouse.move(500, 650);
await page.mouse.wheel(0, 4000);
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/5-scrolled-sticky.png`, clip: { x: 0, y: 350, width: 1450, height: 590 } });

console.log(JSON.stringify({
  rows: await page.evaluate(() => [...window.__blotters.values()][0].grid.getDisplayedRowCount()),
  errors, errorCount: errors.length,
}));
await browser.close();
