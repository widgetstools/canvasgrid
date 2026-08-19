/**
 * Cycle 7 / Task 7 — `quickFilterText` cross-column search box.
 *
 * Verifies that:
 * 1. Typing in the toolbar's `#quick-filter` input drops the visible row
 *    count (worker `QuickFilterPass` ran).
 * 2. Multi-term search (whitespace-split) applies AND semantics.
 * 3. Clearing the input restores the original row count.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

async function rowCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
  );
}

async function settle(page: import('@playwright/test').Page): Promise<void> {
  // The demo's #quick-filter input applies a 200ms trailing debounce
  // before calling setGridOption('quickFilterText', ...) — wait it out
  // so the worker round-trip + recomputeViewport land before we read
  // `rowCount`. A handful of RAFs after the debounce flushes the paint.
  await page.waitForTimeout(280);
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 8 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

test.describe('Cycle 7 / Task 7 — quickFilterText', () => {
  test('typing into the search box reduces the displayed row count', async ({ page }) => {
    await gridReady(page);
    const before = await rowCount(page);
    expect(before).toBeGreaterThan(10);

    await page.fill('input#quick-filter', 'POS-1');
    await settle(page);

    const after = await rowCount(page);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  test('multi-term search applies AND across terms (whitespace-split)', async ({ page }) => {
    await gridReady(page);

    // Cast a wide net first so we know how many rows match `POS`.
    await page.fill('input#quick-filter', 'POS');
    await settle(page);
    const wide = await rowCount(page);
    expect(wide).toBeGreaterThan(0);

    // Add a second term that further narrows. Two whitespace-split terms
    // must BOTH match the row's aggregate text — so the narrower result
    // is strictly ≤ the wider one.
    await page.fill('input#quick-filter', 'POS USD');
    await settle(page);
    const narrow = await rowCount(page);
    expect(narrow).toBeLessThanOrEqual(wide);
  });

  test('clearing the search box restores the row count', async ({ page }) => {
    await gridReady(page);
    const before = await rowCount(page);

    await page.fill('input#quick-filter', 'POS-1');
    await settle(page);
    const narrowed = await rowCount(page);
    expect(narrowed).toBeLessThan(before);

    await page.fill('input#quick-filter', '');
    await settle(page);
    const restored = await rowCount(page);
    expect(restored).toBe(before);
  });
});
