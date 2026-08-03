// Phase 5 smoke — SharedWorker multi-tab: one Perspective engine per
// origin, one feed leader (Web Locks), followers attach live and take
// over when the leader closes. Dev server on :5191 required.
//
//   node apps/cgrid-ssrm-demo/scripts/phase5-smoke.mjs
import { chromium } from 'playwright';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
// ONE context — SharedWorkers are shared per origin within a context.
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });

const bootPage = async () => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5191/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__ssrmDemo?.latest()?.phase === 'live',
    null, { timeout: 60_000 },
  );
  return page;
};
const tele = (page) => page.evaluate(() => {
  const t = window.__ssrmDemo.latest();
  return { phase: t.phase, mode: t.workerMode, role: t.feedRole, book: t.bookSize, snap: t.snapshotRowsLoaded };
});
const armTickCounter = (page) => page.evaluate(() => {
  const grid = [...window.__blotters.values()][0].grid;
  let n = 0;
  const orig = grid.applyServerSideTransaction.bind(grid);
  grid.applyServerSideTransaction = (tx) => { n++; return orig(tx); };
  const origRefresh = grid.refreshServerSide.bind(grid);
  grid.refreshServerSide = (p) => { n++; return origRefresh(p); };
  window.__ticks = () => n;
});

// ── Tab A: creates the shared table, seeds, leads the feed ─────────────
const a = await bootPage();
const ta = await tele(a);
console.log('tab A:', JSON.stringify(ta));
check('A: shared worker mode', ta.mode === 'shared', ta.mode);
check('A: feed leader', ta.role === 'leader', ta.role);
check('A: book seeded', ta.book >= 10_000, String(ta.book));

// ── Tab B: same origin/context → attaches to the SAME table, no reseed ─
const bootStart = Date.now();
const b = await bootPage();
const bootMs = Date.now() - bootStart;
const tb = await tele(b);
console.log('tab B:', JSON.stringify(tb), `boot ${bootMs}ms`);
check('B: shared worker mode', tb.mode === 'shared', tb.mode);
check('B: follower (A leads)', tb.role === 'follower', tb.role);
check('B: same book, adopted (no reseed)', tb.book === ta.book && tb.snap === tb.book, `book=${tb.book} snap=${tb.snap}`);

// ── Live fan-out: A feeds; B's grids must receive ticks ────────────────
await armTickCounter(b);
await wait(3000);
const bTicks1 = await b.evaluate(() => window.__ticks());
check('B: receives live ticks from A\'s feed', bTicks1 > 0, `${bTicks1} tick dispatches / 3s`);

// ── Leader handoff: close A → B must take the lock and keep feeding ────
await a.close();
await b.waitForFunction(
  () => window.__ssrmDemo.latest().feedRole === 'leader',
  null, { timeout: 20_000 },
);
const bTicks2 = await b.evaluate(() => window.__ticks());
await wait(3000);
const bTicks3 = await b.evaluate(() => window.__ticks());
const tb2 = await tele(b);
console.log('tab B after takeover:', JSON.stringify(tb2));
check('B: takes over as leader after A closes', tb2.role === 'leader', tb2.role);
check('B: book intact across handoff', tb2.book === ta.book, String(tb2.book));
check('B: still ticking after takeover', bTicks3 > bTicks2, `${bTicks2} -> ${bTicks3}`);

// ── Dedicated fallback: ?worker=dedicated opts out ─────────────────────
const c = await ctx.newPage();
await c.goto('http://localhost:5191/?worker=dedicated', { waitUntil: 'domcontentloaded' });
await c.waitForFunction(() => window.__ssrmDemo?.latest()?.phase === 'live', null, { timeout: 60_000 });
const tc = await tele(c);
console.log('tab C (?worker=dedicated):', JSON.stringify(tc));
check('C: dedicated fallback works', tc.mode === 'dedicated' && tc.book >= 10_000, `${tc.mode} book=${tc.book}`);

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S): ${failures.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log('\nPHASE 5 SMOKE OK');
}
