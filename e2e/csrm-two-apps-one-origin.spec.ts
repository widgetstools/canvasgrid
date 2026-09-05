import { test, expect, type Page } from '@playwright/test';

/**
 * The CSRM data hub's THREE-LEVEL identity, asserted level by level.
 *
 * What a deployment wants:
 *
 *   1. ONE hub worker script deployed per origin — the precondition for any
 *      two apps to converge at all;
 *   2. the APP NAME partitions hubs on top of that — same name, same hub;
 *      different name, different hub, on purpose;
 *   3. TABS of one app are not an axis at all — they always land on the hub
 *      their app resolves to.
 *
 * None of it can be staged against a dev server, because the question is what
 * the BUNDLER emits. Each app's build produces its own content-hashed copy of
 * `packages/data/src/worker.ts`, and a SharedWorker is keyed on
 * `(origin, script URL, name)` — so an unconfigured app cannot share with
 * anyone whatever it calls itself. `scripts/verify-data-hub.mjs` builds the
 * CSRM demo twice under /a1/ and /a2/, deploys ONE hub artefact at the origin
 * root, serves the lot from one origin, and runs this file against it.
 *
 *   npm run verify:data-hub          # needs `npm run dev:stomp` running
 *
 * `subscriberCount` is the load-bearing number throughout: it is the hub's own
 * count of ports subscribed to a providerId, so two pages on ONE hub read 2
 * where two separate hubs each read 1. Reading it from both pages guards
 * against a page reporting a hub it is not actually on.
 */

const ORIGIN = process.env.TWO_APP_ORIGIN ?? 'http://localhost:4100';
const A1 = `${ORIGIN}/a1/`;
const A2 = `${ORIGIN}/a2/`;
/** One copy of the hub worker, deployed at the origin root. */
const DEPLOYED_WORKER = '/velocity-grid-data-hub.js';

interface Probe {
  target: { url: string | null; name: string; bundled: boolean };
  subscriberCount: number;
  rowCount: number;
  status: string;
}

/** Ready means the hub answered AND has a book. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__demo !== undefined, { timeout: 90_000 });

  // `hubStats` is a round trip to the hub, so the check has to be async — and
  // an async predicate is exactly what `waitForFunction` cannot take: its
  // poller tests the returned value for truthiness, and a pending Promise is
  // truthy, so the wait would succeed on the first tick and probe a page with
  // no provider bound yet. So poll inside the page and let the predicate read
  // a plain value.
  await page.evaluate(() => {
    const w = window as any;
    if (w.__hubPoll) return;
    w.__hubPoll = { stats: null };
    const tick = async (): Promise<void> => {
      try {
        w.__hubPoll.stats = await w.__demo.hubStats();
      } catch { /* hub not up yet, or its own timeout — just retry */ }
      setTimeout(() => { void tick(); }, 400);
    };
    void tick();
  });

  // A hub that never reached upstream would report `subscriberCount: 1` just
  // as happily, so waiting on rows is what makes the counts mean anything.
  await page.waitForFunction(
    () => {
      const s = (window as any).__hubPoll?.stats;
      return !!s && s.rowCount > 0;
    },
    undefined,
    { timeout: 180_000 },
  );
}

const probe = (page: Page): Promise<Probe> => page.evaluate(async () => {
  const d = (window as any).__demo;
  const s = await d.hubStats();
  return {
    target: d.hubTarget(),
    subscriberCount: s.subscriberCount as number,
    rowCount: s.rowCount as number,
    status: s.status as string,
  };
});

/** `?huburl=…&hubapp=…&hubstrict` is what a real deployment hard-codes. */
const configured = (app: string): string =>
  `?huburl=${encodeURIComponent(DEPLOYED_WORKER)}&hubapp=${app}&hubstrict`;

test('tabs of one app share its hub — tabs are not an axis', async ({ context }) => {
  // Deliberately UNCONFIGURED. Both tabs are the same build, so they resolve
  // the same content-hashed worker URL and land on the same hub even though
  // that hub is per-app. This is the level the deployment never has to think
  // about, and the one the question "does every tab get a copy?" is about.
  const a = await context.newPage(); await a.goto(A1); await waitReady(a);
  const b = await context.newPage(); await b.goto(A1); await waitReady(b);
  await b.waitForTimeout(1500);
  const [pa, pb] = await Promise.all([probe(a), probe(b)]);

  expect(pa.target.bundled, 'unconfigured ⇒ the app bundles its own hub').toBe(true);
  expect(pb.target.bundled).toBe(true);
  // One hub, two ports on it: one upstream connection and one cache serving
  // both tabs, not one of each per tab.
  expect(pa.subscriberCount, 'two tabs on one hub').toBe(2);
  expect(pb.subscriberCount).toBe(2);
  // Same cache behind both.
  expect(pb.rowCount).toBe(pa.rowCount);
});

test('default: each app bundles its own hub, so two apps do not converge', async ({ context }) => {
  const a = await context.newPage(); await a.goto(A1); await waitReady(a);
  const b = await context.newPage(); await b.goto(A2); await waitReady(b);
  await b.waitForTimeout(1500);
  const [pa, pb] = await Promise.all([probe(a), probe(b)]);

  expect(pa.target.bundled).toBe(true);
  expect(pb.target.bundled).toBe(true);
  // `bundled` reports a null URL rather than the app's own hashed path,
  // because there is nothing another app could match it against — the honest
  // answer to "will these two share?" is no, not a URL to compare.
  expect(pa.target.url).toBeNull();
  expect(pb.target.url).toBeNull();

  // Two hubs: two upstream connections, two copies of the same book. This is
  // the case `hubstrict` refuses, and it is reachable by simply not
  // configuring anything — which is why silence was the wrong default.
  expect(pa.subscriberCount, 'a1 hub sees only a1').toBe(1);
  expect(pb.subscriberCount, 'a2 hub sees only a2').toBe(1);
});

test('configured: one deployed script + one name joins two apps to one hub', async ({ context }) => {
  const q = configured('blotter-suite');
  const a = await context.newPage(); await a.goto(A1 + q); await waitReady(a);
  const b = await context.newPage(); await b.goto(A2 + q); await waitReady(b);
  await b.waitForTimeout(1500);
  const [pa, pb] = await Promise.all([probe(a), probe(b)]);

  // Both apps resolved the root-relative path to the same absolute URL
  // despite being served from different paths — that is what leaves the name
  // as the only axis that still varies.
  expect(pa.target.bundled).toBe(false);
  expect(pb.target.bundled).toBe(false);
  expect(pb.target.url).toBe(pa.target.url);
  expect(pa.target.name).toBe('blotter-suite');
  expect(pb.target.name).toBe('blotter-suite');
  // The name rides IN the URL as `?app=` — Vite `eval`s the worker options
  // object, so it cannot be a variable there. Identical partitioning either
  // way, since the URL is part of the key regardless.
  expect(pa.target.url).toContain('app=blotter-suite');

  // `hubstrict` was on, so getting this far at all proves no silent fallback
  // to a bundled or in-process hub happened.
  expect(pa.subscriberCount, 'one hub hosting both apps').toBe(2);
  expect(pb.subscriberCount).toBe(2);
  expect(pb.rowCount).toBe(pa.rowCount);
});

test('the app name partitions hubs once the URL is fixed', async ({ context }) => {
  // Same deployed script, different names — the intended way to keep two
  // suites apart on one origin. Worth being explicit that this also
  // separates the CACHE: two names on one providerId means two upstream
  // connections and two copies of the book. Partition on purpose.
  const a = await context.newPage(); await a.goto(A1 + configured('blotter-suite')); await waitReady(a);
  const b = await context.newPage(); await b.goto(A2 + configured('risk-suite')); await waitReady(b);
  await b.waitForTimeout(1500);
  const [pa, pb] = await Promise.all([probe(a), probe(b)]);

  expect(pa.target.bundled).toBe(false);
  expect(pb.target.bundled).toBe(false);
  expect(pa.target.url).not.toBe(pb.target.url);
  expect(pa.subscriberCount, 'blotter-suite hub sees only a1').toBe(1);
  expect(pb.subscriberCount, 'risk-suite hub sees only a2').toBe(1);
});
