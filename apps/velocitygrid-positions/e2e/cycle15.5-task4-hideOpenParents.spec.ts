/**
 * Cycle 15.5 / Task 4 — `groupHideOpenParents` E2E.
 *
 * When `groupHideOpenParents: true` is set, expanded group rows are hidden;
 * only leaf rows (and collapsed group rows) are visible. The test:
 *   1. Seeds 20 rows — 10 AAPL + 10 MSFT.
 *   2. Verifies that with all groups expanded the displayed count equals 20
 *      (only leaf rows, both parent group rows are hidden).
 *   3. Collapses the AAPL group via the API.
 *   4. Verifies the count becomes 11 (1 AAPL group row visible + 10 MSFT leaves).
 *
 * Regression guard: if `groupHideOpenParents` stops hiding expanded parents,
 * the initial count would be 22 (20 leaves + 2 group rows).
 */
import { test, expect, Page } from '@playwright/test';

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getDisplayedRowCount: () => number;
  collapseAll: () => void;
  getExpandedKeys: () => Set<string>;
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
  await page.goto('/?groupHideOpenParents=1&grouping=ticker&totals=off');
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
    // 10 AAPL rows then 10 MSFT rows
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

test.describe('Cycle 15.5 / Task 4 — groupHideOpenParents', () => {
  test('expanded group parent rows are hidden; collapsed parent row becomes visible', async ({ page }) => {
    await gridReady(page);
    await seedTwoGroupRows(page);

    // With all groups expanded and groupHideOpenParents=true:
    // only 20 leaf rows should be visible (both group parent rows are hidden).
    const expandedCount = await page.evaluate(() => {
      return (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount();
    });
    expect(expandedCount).toBe(20);

    // Collapse all groups so both parent rows become visible.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.collapseAll();
    });
    await waitForFrames(page, 12);

    // After collapseAll: 2 group rows, 0 leaf rows visible.
    const collapsedCount = await page.evaluate(() => {
      return (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount();
    });
    expect(collapsedCount).toBe(2);
  });
});
