/**
 * Cycle 15.5 / Task 7 — `suppressCount` + `suppressGroupChangesColumnVisibility` E2E.
 *
 * Two features are covered:
 *
 * A) `suppressCount`: when false (default), the GroupCellValue returned by
 *    `getCellValue` for a group row has `childCount > 0` and no `suppressCount`
 *    flag. When true, `suppressCount: true` appears in the payload.
 *
 * B) `suppressGroupChangesColumnVisibility`: when false (default), adding a
 *    column to rowGroupCols auto-hides that column in the leaf view. When true,
 *    the column stays visible (the grid does not flip its `hide` state).
 *
 * Regression guards:
 *   - If `suppressCount` stops being forwarded, the badge would always show.
 *   - If `suppressGroupChangesColumnVisibility` breaks, the ticker column
 *     would be hidden every time grouping activates.
 */
import { test, expect, Page } from '@playwright/test';

interface GroupCellValue {
  childCount?: number;
  suppressCount?: boolean;
}

interface CColumnState {
  colId: string;
  hide?: boolean;
}

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getCellValue: (rowIndex: number, colId: string) => unknown;
  getColumnState: () => CColumnState[];
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

test.describe('Cycle 15.5 / Task 7 — suppressCount', () => {
  test('default: group row getCellValue has childCount > 0 and no suppressCount flag', async ({ page }) => {
    await page.goto('/?grouping=ticker&totals=off');
    await page.waitForFunction(
      () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
      null,
      { timeout: 20_000 },
    );
    await waitForFrames(page, 6);
    await seedRows(page);

    const val = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return api.getCellValue(0, 'ag-Grid-AutoColumn') as GroupCellValue;
    });
    expect(val).not.toBeNull();
    expect((val as GroupCellValue).childCount).toBeGreaterThan(0);
    expect((val as GroupCellValue).suppressCount).toBeFalsy();
  });

  test('suppressCount=1: group row getCellValue carries suppressCount: true', async ({ page }) => {
    await page.goto('/?grouping=ticker&suppressCount=1&totals=off');
    await page.waitForFunction(
      () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
      null,
      { timeout: 20_000 },
    );
    await waitForFrames(page, 6);
    await seedRows(page);

    const val = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return api.getCellValue(0, 'ag-Grid-AutoColumn') as GroupCellValue;
    });
    expect(val).not.toBeNull();
    expect((val as GroupCellValue).suppressCount).toBe(true);
  });
});

test.describe('Cycle 15.5 / Task 7 — suppressGroupChangesColumnVisibility', () => {
  test('default: ticker column is auto-hidden when added to rowGroupCols', async ({ page }) => {
    await page.goto('/?grouping=ticker&totals=off');
    await page.waitForFunction(
      () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
      null,
      { timeout: 20_000 },
    );
    await waitForFrames(page, 6);
    await seedRows(page);

    const tickerState = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      const colStates = api.getColumnState();
      return colStates.find((c) => c.colId === 'ticker');
    });
    // Default behaviour: ticker is hidden when it becomes a group column.
    expect(tickerState?.hide).toBe(true);
  });

  test('suppressGroupChangesColVis=1: ticker column stays visible when grouped', async ({ page }) => {
    await page.goto('/?grouping=ticker&suppressGroupChangesColVis=1&totals=off');
    await page.waitForFunction(
      () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
      null,
      { timeout: 20_000 },
    );
    await waitForFrames(page, 6);
    await seedRows(page);

    const tickerState = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      const colStates = api.getColumnState();
      return colStates.find((c) => c.colId === 'ticker');
    });
    // With suppress flag: ticker stays visible (hide is false or absent).
    expect(tickerState?.hide).not.toBe(true);
  });
});
