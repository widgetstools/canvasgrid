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
 * deployment makes them agree; the second test here is what keeps that
 * mechanism honest by proving a differing URL really does split the engine.
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

test('the shared-worker URL is what decides sharing', async ({ context }) => {
  const a = await context.newPage();
  await a.goto(DEMO);
  await waitLive(a);
  const { target } = await probe(a);

  // Same script, spelled differently. Per the HTML spec a SharedWorker is
  // matched on its constructor URL, so this is a DIFFERENT worker even
  // though the bytes behind it are identical — which is exactly what
  // happens to two apps whose bundlers hashed the file differently.
  const b = await context.newPage();
  await b.goto(`${DEMO}?swurl=${encodeURIComponent(`${target.url}?dup=1`)}`);
  await waitLive(b);
  await b.waitForTimeout(3000);

  const [pa, pb] = await Promise.all([probe(a), probe(b)]);
  test.skip(pa.mode !== 'shared' || pb.mode !== 'shared', 'dedicated-worker fallback');

  expect(pb.target.url).not.toBe(pa.target.url);
  // Two engines, each seeing only its own tab — the failure mode the
  // `url` option exists to prevent.
  expect(pa.stats.sessions, 'tab A engine sees only tab A').toBe(1);
  expect(pb.stats.sessions, 'tab B engine sees only tab B').toBe(1);

  // A third tab pointed at the SAME url as B joins B's engine, not A's —
  // proving the option is what makes separate apps converge.
  const c = await context.newPage();
  await c.goto(`${DEMO}?swurl=${encodeURIComponent(`${target.url}?dup=1`)}`);
  await waitLive(c);
  await c.waitForTimeout(3000);

  const [pa2, pb2] = await Promise.all([probe(a), probe(b)]);
  expect(pa2.stats.sessions, 'tab A still alone').toBe(1);
  expect(pb2.stats.sessions, 'tabs B and C share an engine').toBe(2);
});
