// StompPerspectiveProvider smoke — the minimal /simple.html page must
// boot, window sparsely, group via the panel path, and tick. Two tabs
// must share the engine (Phase 5 under the facade). Dev server on :5191.
import { chromium } from 'playwright';
import { launchChromium } from '../../../scripts/launch-chromium.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await launchChromium(chromium);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

const boot = async () => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5191/simple.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__simple?.grid?.getDisplayedRowCount() >= 10_000,
    null, { timeout: 60_000 },
  );
  return page;
};

// ── Boot: flat 10k book through the provider ───────────────────────────
const a = await boot();
const flatRows = await a.evaluate(() => window.__simple.grid.getDisplayedRowCount());
check('boots to flat book via provider', flatRows === 10_000, String(flatRows));
const tele = await a.evaluate(() => {
  const t = window.__simple.provider.book.getTelemetry();
  return { mode: t.workerMode, role: t.feedRole, served: t.rowsServedTotal, book: t.bookSize };
});
check('shared engine + leads feed', tele.mode === 'shared' && tele.role === 'leader', JSON.stringify(tele));
check('windows sparsely (served ≪ book)', tele.served > 0 && tele.served < tele.book, `served=${tele.served} book=${tele.book}`);

// ── Live ticks reach the grid ──────────────────────────────────────────
await a.evaluate(() => {
  const g = window.__simple.grid;
  let n = 0;
  const orig = g.applyServerSideTransaction.bind(g);
  g.applyServerSideTransaction = (tx) => { n++; return orig(tx); };
  window.__ticks = () => n;
});
await wait(2500);
const ticks = await a.evaluate(() => window.__ticks());
check('live ticks flow through attach()', ticks > 0, `${ticks} / 2.5s`);

// ── Grouping pushes down to Perspective ────────────────────────────────
await a.evaluate(() => window.__simple.grid.setRowGroupColumns(['desk']));
await a.waitForFunction(() => {
  const n = window.__simple.grid.getDisplayedRowCount();
  return n >= 2 && n <= 20;
}, null, { timeout: 20_000 });
await wait(400);
const grouped = await a.evaluate(() => window.__simple.grid.getDisplayedRowCount());
check('group-by desk via grid API', grouped >= 2 && grouped <= 20, `${grouped} desks`);

// ── Second tab: same engine, follower, same book ───────────────────────
const b = await boot();
const tb = await b.evaluate(() => {
  const t = window.__simple.provider.book.getTelemetry();
  return { mode: t.workerMode, role: t.feedRole, book: t.bookSize };
});
check('tab 2 shares engine as follower', tb.mode === 'shared' && tb.role === 'follower' && tb.book === 10_000, JSON.stringify(tb));

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S): ${failures.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log('\nPROVIDER SMOKE OK');
}
