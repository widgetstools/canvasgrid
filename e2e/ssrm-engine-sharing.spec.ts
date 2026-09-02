import { test, expect, type Page } from '@playwright/test';

/**
 * Several blotters on one origin must share ONE Perspective engine.
 *
 * The design intent: same origin + same `providerId` ⇒ one SharedWorker, one
 * WASM engine, one physical table, one feed. Each blotter still gets its own
 * View (its own group / sort / filter), and exactly one tab leads the feed
 * while the rest read the shared book.
 *
 * The subtlety this pins is that a SharedWorker's identity is
 * `(origin, script URL, name)` — ALL THREE. Tabs of one app agree on the URL
 * for free, because they load the same bundle. Two apps built separately do
 * not: each bundler emits its own content-hashed copy of the worker script,
 * so they would silently get two engines, two copies of the table and two
 * feeds on one origin. `configurePerspectiveSharedWorker({ url })` is how a
 * deployment makes them agree.
 *
 * The two-app case itself needs two real builds served from one origin,
 * which a dev-server e2e cannot stage — `npm run verify:shared-engine`
 * builds and runs exactly that. What is checked here is the part reachable
 * from the running demo: that tabs of one app genuinely share, and that a
 * page reports honestly which of the two regimes it is in.
 *
 * Run against the demo: `npm run dev:stomp` + `npm run dev:ssrm-provider`.
 */

const DEMO = process.env.SSRM_DEMO_URL ?? 'http://localhost:5211/';

async function waitLive(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__demo !== undefined, { timeout: 90_000 });
  await page.waitForFunction(
    () => /phase <b>live<\/b>/.test(document.body.innerHTML),
    undefined,
    { timeout: 180_000 },
  );
}

const probe = (page: Page) => page.evaluate(async () => {
  const d = (window as any).__demo;
  const t = d?.dataController?.getTelemetry?.();
  return {
    tables: (await d.hostedTables()) as string[],
    stats: await d.engineStats(),
    target: d.workerTarget(),
    mode: d.workerMode(),
    feedRole: t?.feedRole as string | undefined,
    bookSize: t?.bookSize as number | undefined,
    views: t?.viewCount as number | undefined,
  };
});

test('tabs of one app share a single engine, table and feed', async ({ context }) => {
  const pages: Page[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage();
    await p.goto(DEMO);
    await waitLive(p);
    pages.push(p);
  }
  await pages[0]!.waitForTimeout(3000);

  const probes = await Promise.all(pages.map(probe));
  test.skip(probes[0]!.mode !== 'shared', 'dedicated-worker fallback — nothing shared to assert');

  // ONE engine: every tab's stats port lands on the same worker, which sees
  // one session per tab and no more.
  for (const p of probes) expect(p.stats.sessions).toBe(3);

  // ONE physical table, the same one, hosting the whole book for everybody.
  const tables = probes[0]!.tables;
  expect(tables).toHaveLength(1);
  for (const p of probes) {
    expect(p.tables).toEqual(tables);
    expect(p.bookSize).toBe(probes[0]!.bookSize);
    // ...and each blotter still has its own View on it.
    expect(p.views).toBe(1);
  }

  // ONE feed: exactly one leader, everyone else reading the shared book.
  const leaders = probes.filter((p) => p.feedRole === 'leader');
  expect(leaders, 'exactly one tab drives the feed').toHaveLength(1);
});

test('a bundled worker reports itself as per-app; a configured one does not', async ({ context }) => {
  // The honest answer to "will these two apps share an engine?". A bundled
  // script is shared only with tabs of the SAME build, so `bundled: true` is
  // the signal that two DIFFERENT apps will not share however matched their
  // origin and providerId are.
  const a = await context.newPage();
  await a.goto(DEMO);
  await waitLive(a);
  const pa = await probe(a);
  test.skip(pa.mode !== 'shared', 'dedicated-worker fallback');
  expect(pa.target.bundled, 'default build uses its own bundled worker').toBe(true);
  expect(pa.target.url).toBeNull();

  const b = await context.newPage();
  await b.goto(`${DEMO}?swurl=${encodeURIComponent('/psp-shared-worker.js')}`);
  await waitLive(b);
  const pb = await probe(b);
  expect(pb.target.bundled).toBe(false);
  expect(pb.target.url).toBe(new URL('/psp-shared-worker.js', DEMO).href);
  // Both tabs must agree on the NAME too — it is half of the worker's
  // identity, and a mismatch splits the engine just as a URL mismatch does.
  expect(pb.target.name).toBe(pa.target.name);
});
