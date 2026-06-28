/**
 * Cycle 15.5 / Task 8 — `groupTotalRow` + `grandTotalRow` E2E.
 *
 * `groupTotalRow` is the AG Grid 35 alias for `groupIncludeFooter`: it appends
 * a per-group total row at the bottom of each expanded group's children.
 * `grandTotalRow` is the alias for `groupIncludeTotalFooter`: it appends a
 * single grand-total row at the end of the body, BUT only when `groupTotalRow`
 * is also enabled (the grand-total footer is guarded by `includeFooter`).
 *
 * The test seeds 10 rows into 2 groups (5 AAPL + 5 MSFT) and verifies:
 *
 * Test A — `?groupTotalRow=bottom`:
 *   displayed count = 2 groups + 10 leaves + 2 group footers = 14
 *
 * Test B — `?groupTotalRow=bottom&grandTotalRow=bottom`:
 *   displayed count = 2 groups + 10 leaves + 2 group footers + 1 grand total = 15
 *
 * Regression guard: if footer row emission breaks, counts would remain at 12
 * (just groups + leaves).
 */
import { test, expect, Page } from '@playwright/test';

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getDisplayedRowCount: () => number;
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

async function mountAndSeed(page: Page, urlSuffix: string): Promise<void> {
  await page.goto(`/?grouping=ticker${urlSuffix}`);
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);

  // 5 AAPL + 5 MSFT rows
  await page.evaluate(() => {
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    const rows: Array<Record<string, unknown>> = [];
    const TICKERS = ['AAPL', 'MSFT'];
    for (let i = 0; i < 10; i++) {
      const ticker = TICKERS[Math.floor(i / 5)]!;
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

test.describe('Cycle 15.5 / Task 8 — groupTotalRow + grandTotalRow', () => {
  test('groupTotalRow=bottom: 2 groups + 10 leaves + 2 group footers = 14', async ({ page }) => {
    await mountAndSeed(page, '&groupTotalRow=bottom&totals=off');
    const count = await page.evaluate(() => {
      return (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount();
    });
    // 2 group rows + 10 leaf rows + 2 per-group footer rows
    expect(count).toBe(14);
  });

  test('groupTotalRow=bottom + grandTotalRow=bottom: 2 + 10 + 2 + 1 = 15', async ({ page }) => {
    await mountAndSeed(page, '&groupTotalRow=bottom&grandTotalRow=bottom&totals=off');
    const count = await page.evaluate(() => {
      return (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount();
    });
    // 2 group rows + 10 leaf rows + 2 per-group footers + 1 grand-total footer
    expect(count).toBe(15);
  });
});
