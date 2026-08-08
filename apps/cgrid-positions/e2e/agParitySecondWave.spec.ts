/**
 * AG-parity second wave (2026-07-21) — real-browser E2E.
 *
 * 1. `groupAggFiltering` — filters evaluate group aggregates; a passing
 *    group includes its whole subtree (leaf filtering would return far
 *    fewer rows for the same model).
 * 2. `filter: 'agGroupColumnFilter'` — a filter set on the auto-group
 *    column's colId filters by the underlying grouped field.
 * 3. `keyCreator` — grouping by a numeric column with a keyCreator
 *    produces derived buckets.
 *
 * Seeds 10 rows / 2 tickers with notionalAmount = 1000 × (i+1):
 *   AAPL (i 0-4) → sum 15,000; MSFT (i 5-9) → sum 40,000.
 */
import { test, expect, Page } from '@playwright/test';

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getDisplayedRowCount: () => number;
  setFilterModel: (model: unknown) => void;
  setRowGroupColumns: (cols: string[]) => void;
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

async function mountAndSeed(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
  await page.evaluate(() => {
    const g = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
    const rows: Array<Record<string, unknown>> = [];
    const TICKERS = ['AAPL', 'MSFT'];
    for (let i = 0; i < 10; i++) {
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        ticker: TICKERS[Math.floor(i / 5)]!,
        cusip: `CUSIP${i}`,
        side: 'BUY',
        quantity: 100 + i,
        price: 10 + i,
        notionalAmount: 1000 * (i + 1),
        sector: 'Tech',
        region: 'AMER',
        currency: 'USD',
        trader: 'T1',
        desk: 'Delta One',
      });
    }
    g.setRowData(rows);
  });
  await waitForFrames(page, 8);
}

async function displayedCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getDisplayedRowCount());
}

test('groupAggFiltering: a passing group keeps its whole subtree', async ({ page }) => {
  await mountAndSeed(page, '/?grouping=ticker&groupAggFiltering=1&groupDefaultExpanded=-1');
  await expect.poll(() => displayedCount(page)).toBe(12); // 2 groups + 10 leaves

  // sum(notional) > 20,000 → only MSFT (40,000) passes → its group row +
  // ALL 5 leaves. Leaf filtering would find ZERO rows (max leaf = 10,000).
  await page.evaluate(() => {
    (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid
      .setFilterModel({ notionalAmount: { type: 'number', op: 'gt', value: 20000 } });
  });
  await expect.poll(() => displayedCount(page)).toBe(6);
});

test('agGroupColumnFilter: filtering the auto column filters by the grouped field', async ({ page }) => {
  await mountAndSeed(page, '/?grouping=ticker&groupColumnFilter=1&groupDefaultExpanded=-1');
  await expect.poll(() => displayedCount(page)).toBe(12);

  await page.evaluate(() => {
    (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid
      .setFilterModel({ 'ag-Grid-AutoColumn': { type: 'text', op: 'contains', value: 'AAPL' } });
  });
  // AAPL group + its 5 leaves.
  await expect.poll(() => displayedCount(page)).toBe(6);
});

test('keyCreator: grouping by notional produces derived BIG/SMALL buckets', async ({ page }) => {
  await mountAndSeed(page, '/?keyCreatorDemo=1&groupDefaultExpanded=-1');
  await page.evaluate(() => {
    (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid
      .setRowGroupColumns(['notionalAmount']);
  });
  // 2 derived buckets (SMALL: 1000-5000, BIG: 6000-10000) + 10 leaves.
  await expect.poll(() => displayedCount(page)).toBe(12);

  // Collapse-all sanity: exactly the 2 derived buckets remain.
  await page.evaluate(() => {
    (window as unknown as { __velocity-grid: { collapseAll: () => void } }).__cgrid.collapseAll();
  });
  await expect.poll(() => displayedCount(page)).toBe(2);
});
