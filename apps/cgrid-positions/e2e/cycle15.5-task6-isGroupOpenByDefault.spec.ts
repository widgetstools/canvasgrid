/**
 * Cycle 15.5 / Task 6 — `isGroupOpenByDefault` callback + `resetRowGroupExpansion` E2E.
 *
 * When the `isGroupOpenByDefault` callback returns true for every node, all
 * groups start expanded even when `groupDefaultExpanded` would collapse them.
 * `resetRowGroupExpansion()` re-runs the callback (resetting expansion state
 * to what the callback dictates, discarding user-driven collapses). The test:
 *   1. Seeds rows with 2 distinct ticker groups (AAPL, MSFT).
 *   2. Verifies at least one group is expanded at mount (callback fired).
 *   3. Collapses all groups via `collapseAll()`.
 *   4. Verifies that 0 keys are in the expanded set.
 *   5. Calls `resetRowGroupExpansion()`.
 *   6. Verifies that groups are expanded again (callback re-fired).
 *
 * Regression guard: if `resetRowGroupExpansion()` stops re-applying the
 * callback, step 6 would still show 0 expanded keys.
 */
import { test, expect, Page } from '@playwright/test';

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getExpandedKeys: () => Set<string>;
  collapseAll: () => void;
  resetRowGroupExpansion: () => void;
}

async function waitForFrames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => {
        if (++i >= count) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?grouping=ticker&isGroupOpenByDefault=1&totals=off');
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function seedTwoGroupRows(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    const rows: Array<Record<string, unknown>> = [];
    const TICKERS = ['AAPL', 'MSFT'];
    for (let i = 0; i < 20; i++) {
      const ticker = TICKERS[Math.floor(i / 10)]!;
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        cusip: `CUSIP${i}`,
        ticker,
        sector: 'Tech',
        subSector: 'Software',
        notionalAmount: Math.round((1_000 + a * 99_000) / 100) * 100,
        marketValue: 50_000,
        currentPrice: 100,
        pnl: 0, dailyPnl: 0, unrealizedPnl: 0,
        yield: 1, spread: 5, dv01: 10, pv01: 10,
      });
    }
    g.setRowData(rows);
  });
  await waitForFrames(page, 12);
}

test.describe('Cycle 15.5 / Task 6 — isGroupOpenByDefault + resetRowGroupExpansion', () => {
  test('groups open by default; collapseAll closes them; resetRowGroupExpansion reopens them via callback', async ({ page }) => {
    await gridReady(page);
    await seedTwoGroupRows(page);

    // After seeding: callback fired → groups are expanded.
    const initialKeys = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return Array.from(api.getExpandedKeys());
    });
    expect(initialKeys.length).toBeGreaterThan(0);

    // collapseAll clears all expanded state.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.collapseAll();
    });
    await waitForFrames(page, 12);

    const collapsedKeys = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return Array.from(api.getExpandedKeys());
    });
    expect(collapsedKeys.length).toBe(0);

    // resetRowGroupExpansion re-runs the isGroupOpenByDefault callback.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.resetRowGroupExpansion();
    });
    await waitForFrames(page, 12);

    const resetKeys = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return Array.from(api.getExpandedKeys());
    });
    expect(resetKeys.length).toBeGreaterThan(0);
  });
});
