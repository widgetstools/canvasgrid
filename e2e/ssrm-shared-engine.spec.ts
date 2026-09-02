import { test, expect, type Page } from '@playwright/test';

/**
 * The shared Perspective engine must not accumulate sessions.
 *
 * The engine lives in a per-ORIGIN SharedWorker and outlives every page that
 * talks to it. A session it still believes is connected keeps everything that
 * session owns — views, their materialised state, their update
 * subscriptions — so a session that is never closed is a permanent leak in a
 * process shared by every blotter on the origin. That is what took the SSRM
 * demo to "Aw, Snap! Out of Memory" on reload.
 *
 * The bug hid behind a single tab: the last disconnect kills the SharedWorker
 * and takes the whole engine with it, so a lone tab reloading forever looks
 * clean. It only shows with TWO OR MORE blotters open, which keep the worker
 * alive across each other's reloads — hence the tab count below is the load
 * bearing part of this test, not incidental.
 *
 * Run against the demo: `npm run dev:stomp` + `npm run dev:ssrm-provider`.
 */

const DEMO = process.env.SSRM_DEMO_URL ?? 'http://localhost:5211/';
const TABS = 3;
const ROUNDS = 4;

interface EngineStats { heapBytes: number; sessions: number; engineUp: boolean }

async function waitLive(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__demo !== undefined, { timeout: 90_000 });
  await page.waitForFunction(
    () => /phase <b>live<\/b>/.test(document.body.innerHTML),
    undefined,
    { timeout: 180_000 },
  );
}

const readStats = (page: Page): Promise<EngineStats | null> =>
  page.evaluate(async () => {
    const d = (window as any).__demo;
    return d?.engineStats ? await d.engineStats() : null;
  });

test('sessions do not accumulate across reloads with several blotters open', async ({ context }) => {
  const errors: string[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < TABS; i++) {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`tab${i}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`tab${i}: ${m.text()}`); });
    await p.goto(DEMO);
    await waitLive(p);
    pages.push(p);
  }

  const baseline = await readStats(pages[0]!);
  test.skip(baseline === null, 'engine stats unavailable — dedicated-worker fallback');
  // One session per live blotter, and no more.
  expect(baseline!.sessions).toBe(TABS);

  const heaps: number[] = [baseline!.heapBytes];
  for (let r = 0; r < ROUNDS; r++) {
    for (const p of pages) {
      await p.reload();
      await waitLive(p);
    }
    const s = await readStats(pages[0]!);
    // THE assertion: reloading every tab must leave the session count where
    // it started. Before the fix this read 3, 6, 9, 12 — one stranded
    // session per page load, each holding its views forever.
    expect(s!.sessions, `sessions after reload round ${r + 1}`).toBe(TABS);
    heaps.push(s!.heapBytes);
  }

  // The heap is allowed to move — the engine grows and compacts around a
  // live feed — but it must not track the reload count. Anything past a
  // doubling over four full rounds is the old monotonic growth returning.
  const grown = Math.max(...heaps) / Math.max(1, heaps[0]!);
  expect(grown, `engine heap growth ratio (${heaps.map((h) => (h / 1e6).toFixed(0)).join(' -> ')} MB)`)
    .toBeLessThan(2);

  // Teardown used to log "table.update: Cannot read properties of null" on
  // every unload — a flush losing its race with `destroy()`.
  const teardownErrors = errors.filter((e) => /table\.update/.test(e));
  expect(teardownErrors, 'flush/teardown races').toEqual([]);
});
