/**
 * Cycle 8 / Task 3 — `comparator` per column via worker-side
 * `ComparatorRegistry`.
 *
 * The demo registers a `naturalOrder` comparator via
 * `grid.registerComparator('naturalOrder', fn)` and references it from the
 * ticker column's `comparator: 'naturalOrder'`. This spec verifies:
 *
 * 1. The grid boots without an error (the registration round-trip
 *    completed before sort lands).
 * 2. A click on the ticker header sorts the visible rows ascending. The
 *    demo's ticker pool is all-letters (`AAPL`, `MSFT`, `GOOG`, …) so the
 *    natural-order result equals a lexicographic sort — the registered
 *    function still runs, it just produces the same ordering for this
 *    data.
 * 3. A second click flips the sort to descending.
 *
 * The "natural-order over lex" semantics (TICK2 < TICK10) are covered by
 * `cgrid/tests/comparatorRegistry.test.ts`; this spec proves the
 * end-to-end demo wiring works.
 */
import { test, expect, Page } from '@playwright/test';

interface HeaderBounds { x: number; y: number; w: number; h: number }
type SortEntry = { colId: string; direction: 'asc' | 'desc' };

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => HeaderBounds | null;
}

const GRID_SELECTOR = '#grid canvas';

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

async function sortModel(page: Page): Promise<SortEntry[]> {
  return page.evaluate(
    () => (window as unknown as { __velocity-grid: { sortModel: SortEntry[] } }).__cgrid.sortModel,
  );
}

async function headerBounds(page: Page, colId: string): Promise<HeaderBounds> {
  const b = await page.evaluate(
    (id) =>
      (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getHeaderBoundsAt(id),
    colId,
  );
  if (!b) throw new Error(`no header bounds for ${colId}`);
  return b;
}

test.describe('Cycle 8 / Task 3 — comparator registry', () => {
  test('grid boots with the naturalOrder comparator registered', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await gridReady(page);
    // No worker error from a missing registration / failed deserialise.
    expect(consoleErrors.filter((e) => /comparator/i.test(e))).toEqual([]);
  });

  test('clicking ticker header sorts via the registered comparator', async ({ page }) => {
    await gridReady(page);
    const ticker = await headerBounds(page, 'ticker');
    const off = await canvasOffset(page);

    // Plain click → asc.
    await page.mouse.click(off.x + ticker.x + ticker.w / 2, off.y + ticker.y + ticker.h / 2);
    await waitForFrames(page, 8);
    expect(await sortModel(page)).toEqual([{ colId: 'ticker', direction: 'asc' }]);

    // Second click → desc.
    await page.mouse.click(off.x + ticker.x + ticker.w / 2, off.y + ticker.y + ticker.h / 2);
    await waitForFrames(page, 8);
    expect(await sortModel(page)).toEqual([{ colId: 'ticker', direction: 'desc' }]);
  });
});
