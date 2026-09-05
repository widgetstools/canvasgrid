import { test, expect, type Page } from '@playwright/test';

/**
 * What happens to a worker-side feed when the broker goes away.
 *
 * The single most likely real-world event, and the one the move made hardest
 * to reason about: the socket is no longer on any tab, so nothing a tab does
 * can observe or repair it directly. Every tab is downstream of a connection
 * it cannot see.
 *
 * That is exactly where the stale-rate bug lived. State is pushed when rows
 * arrive, so the last push before a broker drop reported whatever rate was in
 * the window at that instant — and every tab would have gone on displaying
 * "40 rows/s" over a dead connection indefinitely. The worker now sends one
 * trailing state after its rate window empties; this asserts it.
 *
 * Needs a broker that can be taken away, so it runs against
 * `scripts/ws-relay.mjs` rather than the shared STOMP fixture:
 *
 *   npm run verify:worker-feed-reconnect     # needs `npm run dev:stomp`
 */

const DEMO = process.env.RECONNECT_DEMO_URL ?? 'http://localhost:5219/';
const RELAY = process.env.RECONNECT_RELAY_URL ?? 'http://localhost:8099';

async function waitLive(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__demo !== undefined, { timeout: 90_000 });
  await page.waitForFunction(
    () => /phase <b>live<\/b>/.test(document.body.innerHTML),
    undefined,
    { timeout: 180_000 },
  );
}

const feed = (page: Page) => page.evaluate(async () => {
  const d = (window as any).__demo;
  const t = d?.dataController?.getTelemetry?.();
  const f = (await d.engineFeeds())?.[0] ?? null;
  return {
    available: (d.workerFeed() as { available: boolean }).available,
    mode: d.workerMode() as string,
    phase: f?.phase as string | undefined,
    bookSize: f?.bookSize as number | undefined,
    subscribers: f?.subscribers as number | undefined,
    startedAt: f?.startedAt as number | null | undefined,
    pagePhase: t?.phase as string | undefined,
    pageRowsPerSec: t?.liveUpdatesPerSec as number | undefined,
    feedRole: t?.feedRole as string | undefined,
  };
});

const relay = (path: string) => fetch(`${RELAY}${path}`).then((r) => r.json() as Promise<unknown>);

test('a broker drop is visible to every tab, and the feed comes back', async ({ context }) => {
  const a = await context.newPage(); await a.goto(DEMO); await waitLive(a);
  const b = await context.newPage(); await b.goto(DEMO); await waitLive(b);
  await b.waitForTimeout(2500);

  const before = await feed(a);
  test.skip(before.mode !== 'shared' || !before.available, 'no shared worker feed');
  expect(before.feedRole).toBe('worker');
  expect(before.subscribers, 'both tabs on the one feed').toBe(2);
  expect(before.pageRowsPerSec ?? 0, 'not actually live before the cut').toBeGreaterThan(0);

  // ── the broker goes away ────────────────────────────────────────────────
  await relay('/cut');

  // Both tabs must SEE it. This is the assertion that was failing before the
  // trailing push existed: the page reported the last rate it had been told
  // about, forever, over a connection that no longer existed.
  for (const page of [a, b]) {
    await expect.poll(
      async () => (await feed(page)).pageRowsPerSec ?? -1,
      { timeout: 30_000, message: 'a tab still reports rows arriving over a dead broker' },
    ).toBe(0);
  }
  const cut = await feed(a);
  expect(cut.phase, 'the worker knows the socket died').not.toBe('live');
  // The book is not thrown away — a disconnect is not a reason to blank
  // every grid on the origin.
  expect(cut.bookSize, 'book was discarded on a disconnect').toBeGreaterThan(0);

  // ── and comes back ──────────────────────────────────────────────────────
  await relay('/heal');

  // stompjs reconnects on its own timer (2s), inside the worker now rather
  // than on a tab, so nothing needs to be told to retry.
  for (const page of [a, b]) {
    await expect.poll(
      async () => (await feed(page)).phase,
      { timeout: 120_000, message: 'feed never came back after the broker returned' },
    ).toBe('live');
  }
  await a.waitForTimeout(2500);
  const after = await feed(a);
  expect(after.subscribers, 'both tabs still on it').toBe(2);
  expect(after.startedAt, 'a reconnect is not a new feed').toBe(before.startedAt);
  expect(after.pageRowsPerSec ?? 0, 'reconnected but no rows').toBeGreaterThan(0);
  expect((await feed(b)).pageRowsPerSec ?? 0, 'the other tab did not recover').toBeGreaterThan(0);
});
