import { chromium } from 'playwright';

const BASE = process.env.SSRM_DEMO_URL ?? 'http://127.0.0.1:5191/?quality=performance&feed=seed';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(120_000);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const t = window.__ssrmDemo?.latest?.();
  return t && t.phase === 'live' && t.bookSize >= 10_000;
}, null, { timeout: 90_000 });

const result = await page.evaluate(async () => {
  const book = window.__ssrmDemo.book;
  const grid = window.__ssrmDemo.blotters.get('all').grid;
  grid.setRowGroupColumns(['desk', 'region']);
  grid.refreshServerSide({ purge: true });
  await new Promise((r) => setTimeout(r, 6000));
  const views = book.getTelemetry().views;
  const debug = Object.fromEntries(book.lastGetRowsDebug.entries());
  return {
    rowCount: grid.getDisplayedRowCount(),
    groupCols: grid.getRowGroupColumns(),
    debug,
    views,
  };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));
