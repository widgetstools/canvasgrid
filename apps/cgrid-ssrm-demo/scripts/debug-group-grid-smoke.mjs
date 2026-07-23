/**
 * End-to-end group column smoke — grid row count after grouped refresh.
 */
import { chromium } from 'playwright';

const BASE = process.env.SSRM_DEMO_URL ?? 'http://127.0.0.1:5192/?quality=performance&feed=seed';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(120_000);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const t = window.__ssrmDemo?.latest?.();
  return t && t.phase === 'live' && t.bookSize >= 10_000;
}, null, { timeout: 90_000 });

const result = await page.evaluate(async () => {
  const mount = window.__ssrmDemo.blotters.get('all');
  if (!mount) return { ok: false, detail: 'no blotter' };
  const grid = mount.grid;
  const book = window.__ssrmDemo.book;

  grid.setRowGroupColumns(['desk', 'region']);
  grid.refreshServerSide({ purge: true });

  let debug = book.lastGetRowsDebug.get('all');
  let rowCount = grid.getDisplayedRowCount?.() ?? -1;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 250));
    debug = book.lastGetRowsDebug.get('all');
    rowCount = grid.getDisplayedRowCount?.() ?? -1;
    if (debug?.branch === 'grouped' && rowCount < 50) break;
  }

  return {
    ok: rowCount > 0 && rowCount < 50 && debug?.branch === 'grouped',
    rowCount,
    debug,
  };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
console.log('Grid group smoke: PASS');
