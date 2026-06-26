/**
 * Cycle 7 / Task 8 — external filter via `isExternalFilterPresent` /
 * `doesExternalFilterPass` + the candidate rowIds round-trip.
 *
 * Verifies that:
 * 1. Toggling the toolbar's "Positive P&L only" checkbox drops the
 *    visible row count (worker pushed candidates → main ran the
 *    predicate → worker resumed with the surviving subset).
 * 2. Unchecking restores the original row count.
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
  // External-filter toggle fires `change` → `setPositiveOnlyFilter` →
  // `grid.onFilterChanged('externalFilter')` → worker refilter →
  // candidates push → main predicate → externalFilterResult → worker
  // reply → main rowCount update + recomputeViewport. A handful of RAFs
  // covers the round-trip + paint settle.
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 12 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

test.describe('Cycle 7 / Task 8 — external filter', () => {
  test('toggling Positive P&L drops the visible row count; untoggling restores it', async ({ page }) => {
    await gridReady(page);
    const before = await rowCount(page);
    expect(before).toBeGreaterThan(10);

    // Check the box — worker pushes candidates, main filters by pnl > 0.
    await page.check('input#ext-positive-pnl');
    await settle(page);
    const filtered = await rowCount(page);
    // Some rows have non-positive P&L so the visible set must shrink.
    expect(filtered).toBeLessThan(before);
    expect(filtered).toBeGreaterThan(0);

    // Uncheck — predicate returns false → round-trip skipped → original set restored.
    await page.uncheck('input#ext-positive-pnl');
    await settle(page);
    const restored = await rowCount(page);
    expect(restored).toBe(before);
  });
});
