/**
 * Group column smoke — verify Perspective book serves grouped rows with __ssrm metadata.
 */
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
  const mount = window.__ssrmDemo.blotters.get('all');
  if (!mount) return { ok: false, detail: 'no blotter' };

  mount.grid.setRowGroupColumns(['desk', 'region']);
  mount.grid.refreshServerSide({ purge: true });
  await new Promise((r) => setTimeout(r, 2000));

  const rows = await book.getSsrmRows('all', {
    startRow: 0,
    endRow: 20,
    sortModel: [],
    filterModel: {},
    rowGroupCols: ['desk', 'region'],
    expandedGroupKeys: [],
  });

  const sample = rows.rows.slice(0, 8).map((r) => ({
    positionId: r.positionId,
    ssrm: r.__ssrm,
    desk: r.desk,
  }));

  const hasGroups = rows.rows.some((r) => r.__ssrm?.kind === 'group' && r.__ssrm?.label);
  const flatLeaves = rows.rows.filter((r) => String(r.positionId ?? '').startsWith('P'));

  return {
    ok: hasGroups && rows.rowCount < 100 && flatLeaves.length === 0,
    rowCount: rows.rowCount,
    served: rows.rows.length,
    groupKeys: rows.groupKeys.length,
    sample,
    hasGroups,
    flatLeaves: flatLeaves.length,
  };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
console.log('Group smoke: PASS');
