import { test, expect, type Page } from '@playwright/test';

/**
 * The SSRM feed running INSIDE the SharedWorker, rather than on an elected
 * tab's main thread.
 *
 * What the change is for (`docs/ssrm-shared-engine-architecture.md` §4): with
 * the transport on a tab, the feed is hostage to that tab's main thread —
 * throttled when it is backgrounded, competing with paint when it is busy,
 * and down entirely for the moment between it closing and a follower winning
 * the Web Lock. None of that is fixed here so much as removed: there is one
 * worker, so there is one feed, so there is nothing to elect.
 *
 * All three regimes are asserted, because the ones that DON'T delegate are
 * what make the option safe to ship. A page that cannot hand its feed over
 * must still have one, and must not sit waiting for a snapshot that is never
 * going to arrive.
 *
 *   npm run dev:stomp                                # the fixture feed
 *   npm run dev:ssrm-provider                        # :5211
 *   npx playwright test e2e/ssrm-worker-feed.spec.ts
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
  const stats = await d.engineStats();
  return {
    workerFeed: d.workerFeed() as { requested: boolean; available: boolean },
    mode: d.workerMode() as string,
    tables: (await d.hostedTables()) as string[],
    sessions: stats?.sessions as number | undefined,
    hostSessions: stats?.hostSessions as number | undefined,
    clientProtocols: stats?.clientProtocols as number[] | undefined,
    feeds: (stats?.feeds ?? []) as Array<{
      tableName: string; phase: string; subscribers: number; bookSize: number;
    }>,
    feedRole: t?.feedRole as string | undefined,
    bookSize: t?.bookSize as number | undefined,
    rowsPerSec: t?.liveUpdatesPerSec as number | undefined,
  };
});

async function openTabs(context: import('@playwright/test').BrowserContext, n: number, query: string) {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) {
    const page = await context.newPage();
    await page.goto(DEMO + query);
    await waitLive(page);
    pages.push(page);
  }
  // Let the last tab's join settle before counting subscribers.
  await pages[pages.length - 1]!.waitForTimeout(2500);
  return pages;
}

test('?feed=worker: one feed in the worker serves every tab', async ({ context }) => {
  const pages = await openTabs(context, 3, '?feed=worker');
  const probes = await Promise.all(pages.map(probe));
  test.skip(probes.some((p) => p.mode !== 'shared'), 'dedicated-worker fallback');
  test.skip(probes.some((p) => !p.workerFeed.available), 'deployed worker predates feed:*');

  for (const p of probes) {
    // Nothing on a tab is feeding. This is the assertion the whole change is
    // about: no leader, no follower, no takeover queue.
    expect(p.feedRole, 'the worker owns the feed').toBe('worker');
    expect(p.tables).toHaveLength(1);
    expect(p.bookSize).toBeGreaterThan(0);
  }
  expect(probes.filter((p) => p.feedRole === 'leader'), 'no tab leads anything').toHaveLength(0);

  // ONE feed, seen identically from every tab, with all three holding it
  // open. `subscribers` is the count that would read 1,1,1 if each tab had
  // opened its own broker connection.
  for (const p of probes) {
    expect(p.feeds, 'one feed for one table').toHaveLength(1);
    expect(p.feeds[0]!.subscribers, 'every tab on the one feed').toBe(3);
    expect(p.feeds[0]!.phase).toBe('live');
    expect(p.feeds[0]!.tableName).toBe(probes[0]!.tables[0]);
  }
  // Same book behind all of them, and it is actually ticking.
  expect(new Set(probes.map((p) => p.bookSize)).size, 'one book').toBe(1);
  expect(probes.some((p) => (p.rowsPerSec ?? 0) > 0), 'feed is live, not merely connected').toBe(true);

  // The worker's own client is a real engine session, and must not be
  // counted as a page: `sessions` is read as "open blotters" (a count that
  // climbs across reloads is the leak this worker exists to prevent), and a
  // `0` in `clientProtocols` reads as a page too old to say hello.
  expect(probes[0]!.sessions, 'three tabs, three page sessions').toBe(3);
  expect(probes[0]!.hostSessions, "the worker's own feed client, counted apart").toBe(1);
  expect(probes[0]!.clientProtocols, 'no phantom pre-hello client').not.toContain(0);
});

test('default: the main-thread feed is untouched', async ({ context }) => {
  const pages = await openTabs(context, 2, '');
  const probes = await Promise.all(pages.map(probe));
  test.skip(probes.some((p) => p.mode !== 'shared'), 'dedicated-worker fallback');

  expect(probes.every((p) => p.workerFeed.requested === false)).toBe(true);
  // Exactly one tab feeds and the other reads the shared book — the Web-Lock
  // election, still doing its job for anyone who has not opted in.
  expect(probes.filter((p) => p.feedRole === 'leader'), 'one leader').toHaveLength(1);
  expect(probes.filter((p) => p.feedRole === 'follower'), 'the rest follow').toHaveLength(1);
  // And the worker is running no feed at all, which is what "untouched"
  // means here: opting out costs nothing, not even a lazily-built client.
  expect(probes[0]!.feeds, 'no feed inside the worker').toHaveLength(0);
  expect(probes[0]!.hostSessions, 'no host client was ever built').toBe(0);
});

test('asking for a worker feed without a shared worker falls back rather than hanging', async ({ context }) => {
  // `?worker=dedicated` is the same path taken when SharedWorker is missing
  // or fails to start. The page asks for a worker feed and cannot have one;
  // the point is that it feeds itself instead of waiting.
  const page = await context.newPage();
  await page.goto(`${DEMO}?feed=worker&worker=dedicated`);
  await waitLive(page);
  const p = await probe(page);

  expect(p.mode).toBe('dedicated');
  expect(p.workerFeed.requested, 'the page did ask').toBe(true);
  expect(p.workerFeed.available, 'and could not have it').toBe(false);
  expect(p.feedRole, 'so it fed itself').toBe('leader');
  expect(p.bookSize, 'and reached a real book').toBeGreaterThan(0);
});
