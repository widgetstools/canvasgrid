/**
 * Cycle 15.5 / Task 10 — grouping state round-trip E2E.
 *
 * `getRowGroupColumns()` returns the current row-group column list.
 * `setRowGroupColumns()` replaces it. Together they form a save/restore
 * contract for external state persistence. The test:
 *   1. Seeds rows and verifies `getRowGroupColumns()` returns `['ticker']`
 *      (set via `?grouping=ticker` at mount).
 *   2. Snapshots the current list to a local variable.
 *   3. Calls `setRowGroupColumns([])` to remove all grouping.
 *   4. Verifies `getRowGroupColumns()` returns `[]`.
 *   5. Calls `setRowGroupColumns(snapshot)` to restore.
 *   6. Verifies `getRowGroupColumns()` returns `['ticker']` again.
 *   7. Verifies the grid is actually grouped (row 0 is a group row).
 *
 * Regression guard: if the round-trip breaks, step 6 would return `[]`
 * or the wrong column list, meaning apps couldn't serialize + restore
 * grouping state across sessions.
 */
import { test, expect, Page } from '@playwright/test';

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getRowGroupColumns: () => string[];
  setRowGroupColumns: (cols: string[]) => void;
  isGroupRow: (rowIndex: number) => boolean;
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
  await page.goto('/?grouping=ticker&totals=off');
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function seedRows(page: Page, count = 20): Promise<void> {
  await page.evaluate((n) => {
    const g = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
    const TICKERS = ['AAPL', 'MSFT'];
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
      const ticker = TICKERS[i % 2]!;
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
  }, count);
  await waitForFrames(page, 12);
}

test.describe('Cycle 15.5 / Task 10 — grouping state round-trip', () => {
  test('getRowGroupColumns/setRowGroupColumns save and restore grouping state', async ({ page }) => {
    await gridReady(page);
    await seedRows(page);

    // Initial state: grouped by ticker.
    const initial = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return api.getRowGroupColumns();
    });
    expect(initial).toEqual(['ticker']);

    // Row 0 is a group row in the initial state.
    const row0IsGroupBefore = await page.evaluate(() => {
      return (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.isGroupRow(0);
    });
    expect(row0IsGroupBefore).toBe(true);

    // Remove all grouping.
    await page.evaluate(() => {
      (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.setRowGroupColumns([]);
    });
    await waitForFrames(page, 12);

    const cleared = await page.evaluate(() => {
      return (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getRowGroupColumns();
    });
    expect(cleared).toEqual([]);

    // Row 0 is no longer a group row after clearing.
    const row0IsGroupCleared = await page.evaluate(() => {
      return (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.isGroupRow(0);
    });
    expect(row0IsGroupCleared).toBe(false);

    // Restore grouping from the saved snapshot.
    await page.evaluate((saved) => {
      (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.setRowGroupColumns(saved);
    }, initial);
    await waitForFrames(page, 12);

    const restored = await page.evaluate(() => {
      return (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getRowGroupColumns();
    });
    expect(restored).toEqual(['ticker']);

    // Row 0 is a group row again after restore.
    const row0IsGroupRestored = await page.evaluate(() => {
      return (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.isGroupRow(0);
    });
    expect(row0IsGroupRestored).toBe(true);
  });
});
