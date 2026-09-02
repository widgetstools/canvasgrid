import { test, expect, type Page } from '@playwright/test';

/**
 * TWO DIFFERENT APPS on ONE origin, sharing one Perspective engine.
 *
 * The scenario this exists for: `http://host:4000/a1` and
 * `http://host:4000/a2` are separate builds that both need DataProvider
 * `p1`, and should end up on one SharedWorker hosting one table with one
 * feed — not two of everything.
 *
 * It cannot be staged against a dev server, because the whole question is
 * what the BUNDLER emits: each app's build produces its own content-hashed
 * copy of the worker script, and a SharedWorker's identity is
 * `(origin, script URL, name)`. So `scripts/verify-shared-engine.mjs` builds
 * both apps, deploys ONE worker artefact at the origin root, serves the lot,
 * and runs this file against it.
 *
 *   npm run verify:shared-engine     # needs `npm run dev:stomp` running
 *
 * Both regimes are asserted, because only the contrast is convincing: the
 * default really does split the engine, and pointing both apps at the
 * deployed script really does join them.
 */

const ORIGIN = process.env.TWO_APP_ORIGIN ?? 'http://localhost:4000';
const A1 = `${ORIGIN}/a1/`;
const A2 = `${ORIGIN}/a2/`;
/** One copy of the worker, deployed at the origin root. */
const DEPLOYED_WORKER = '/psp-shared-worker.js';

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
    mode: d.workerMode() as string,
    feedRole: t?.feedRole as string | undefined,
    bookSize: t?.bookSize as number | undefined,
  };
});

test('default: each app bundles its own worker, so each gets its own engine', async ({ context }) => {
  const a = await context.newPage(); await a.goto(A1); await waitLive(a);
  const b = await context.newPage();
  const startedB = Date.now();
  await b.goto(A2); await waitLive(b);
  const bTookMs = Date.now() - startedB;
  await b.waitForTimeout(3000);
  const [pa, pb] = await Promise.all([probe(a), probe(b)]);
  test.skip(pa.mode !== 'shared' || pb.mode !== 'shared', 'dedicated-worker fallback');

  expect(pa.target.bundled).toBe(true);
  expect(pb.target.bundled).toBe(true);
  // Two engines. Each sees only its own app.
  expect(pa.stats.sessions, 'a1 engine sees only a1').toBe(1);
  expect(pb.stats.sessions, 'a2 engine sees only a2').toBe(1);

  // And this is the part that makes the unshared setup a defect rather than
  // just waste. Feed leadership is a Web Lock, and Web Locks are scoped to
  // the ORIGIN — while the engine is scoped to (origin, worker URL, name).
  // Both apps derive the SAME lock name (it comes from schema + providerId,
  // which is exactly what they have in common), so they contend for one
  // lock while owning two separate, separately-empty tables. At most one can
  // be leading at any moment:
  const leaders = [pa, pb].filter((p) => p.feedRole === 'leader');
  expect(leaders.length, 'one origin-scoped feed lock, two engines').toBeLessThanOrEqual(1);

  // The loser then polls ITS OWN empty table for the leader's snapshot,
  // which can never arrive there, and only falls back to feeding itself
  // after `waitForSharedSnapshot`'s 30s timeout. Measured ~44s to live
  // versus ~10s once the apps share an engine.
  // eslint-disable-next-line no-console
  console.log(`  second app reached live in ${(bTookMs / 1000).toFixed(1)}s (shared: ~10s)`);
});

test('configured: one deployed worker joins both apps to one engine, table and feed', async ({ context }) => {
  // What a deployment hard-codes: one deployed script, one instance name,
  // and `strict` so a silent fall back to a per-app engine is an error
  // rather than a quiet degrade.
  const q = `?swurl=${encodeURIComponent(DEPLOYED_WORKER)}&swname=positions-engine&swstrict`;
  const a = await context.newPage(); await a.goto(A1 + q); await waitLive(a);
  const b = await context.newPage(); await b.goto(A2 + q); await waitLive(b);
  await b.waitForTimeout(4000);
  const [pa, pb] = await Promise.all([probe(a), probe(b)]);
  test.skip(pa.mode !== 'shared' || pb.mode !== 'shared', 'dedicated-worker fallback');

  // (origin, instance name) with bundled:false — the intended model. Both
  // apps resolved the root-relative path to the same absolute URL despite
  // being served from different paths, which is what makes the name the
  // only axis that still varies.
  expect(pa.target.bundled).toBe(false);
  expect(pb.target.bundled).toBe(false);
  expect(pb.target.url).toBe(pa.target.url);
  expect(pa.target.url).toBe(new URL(DEPLOYED_WORKER, ORIGIN).href);
  expect(pa.target.name).toBe('positions-engine');
  expect(pb.target.name).toBe(pa.target.name);
  // `strict` was on, so reaching this point at all proves no silent
  // fallback happened — the engine really is the shared one.
  expect(pa.mode).toBe('shared');
  expect(pb.mode).toBe('shared');

  // ONE engine, seeing both apps.
  expect(pa.stats.sessions, 'one engine hosting both apps').toBe(2);
  expect(pb.stats.sessions).toBe(2);

  // ONE table for the provider, with the same book behind both apps.
  expect(pa.tables).toHaveLength(1);
  expect(pb.tables).toEqual(pa.tables);
  expect(pa.bookSize).toBeGreaterThan(0);
  expect(pb.bookSize).toBe(pa.bookSize);

  // ONE feed: one app leads, the other reads the shared book.
  const leaders = [pa, pb].filter((p) => p.feedRole === 'leader');
  expect(leaders, 'exactly one app drives the feed').toHaveLength(1);
});
