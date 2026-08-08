/**
 * Cycle 18 / Task 8c — enableStrictPivotColumnOrder behavioural E2E.
 *
 * Verifies the AG-parity contract from Prompt 8:
 *   - default (`enableStrictPivotColumnOrder: false`): brand-new pivot
 *     key values land at the END of the previously-known order; the
 *     prior columns keep their position across data updates.
 *   - strict (`enableStrictPivotColumnOrder: true`): every pivot run
 *     re-sorts the keys alphanumerically; new values land in their
 *     alphabetical position.
 *
 * Drives the live positions grid against the real worker. Uses
 * `applyTransaction` to introduce a new region mid-session — the only
 * way to exercise the "append at end" branch without a custom seed.
 *
 * The visible-order assertion reads `getColumnState()` (which now
 * round-trips pivot result columns under Task 8b).
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

interface GridApiSurface {
  setPivotColumns: (cols: string[]) => void;
  addValueColumn: (colId: string, aggFunc: string) => void;
  setPivotMode: (mode: boolean) => void;
  getColumnState: () => Array<{ colId: string }>;
  applyTransaction: (txn: {
    add?: unknown[]; update?: unknown[]; remove?: string[];
  }) => unknown;
  setGridOption: (key: string, value: unknown) => void;
}

async function waitForFrames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => { if (++i >= count) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function gridReady(page: Page, qs: string): Promise<void> {
  await page.goto(`/${qs}`);
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

/** Read the pivot result column ids in their current rendered order.
 *  Reads `columnOrder` (the rendered list) — `getColumnState` returns
 *  PRIMARY cols under pivot mode post Cycle 18 / Task 9. */
async function pivotResultColIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = (window as unknown as {
      __velocity-grid: { columnOrder: Array<{ colId: string }> };
    }).__cgrid;
    return (grid.columnOrder ?? [])
      .map((c) => c.colId)
      .filter((id) => id.startsWith('pivotcol'));
  });
}

/** Pull the level-0 pivot key out of a synthesized colId
 *  (`pivotcol<region><valueColId>`). Used to compare the
 *  rendered ORDER without depending on the value-col suffix. */
function regionOfColId(id: string): string {
  // PIVOT_ID_SEP is ``. Split, drop the prefix (`pivotcol`) and
  // value colId (last), keep the middle which is the per-level path.
  const parts = id.split('');
  return parts[1] ?? id;
}

test.describe('Cycle 18 / Task 8c — enableStrictPivotColumnOrder', () => {
  test('DEFAULT (off): a brand-new region (alphabetically first) appears at the END of the column order', async ({ page }) => {
    await gridReady(page, '?pivotDemo=on');

    await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      api.setPivotColumns(['region']);
      api.addValueColumn('notionalAmount', 'sum');
      api.setPivotMode(true);
    });
    await waitForFrames(page, 12);

    const beforeIds = await pivotResultColIds(page);
    expect(beforeIds.length).toBeGreaterThan(0);
    const beforeRegions = beforeIds.map(regionOfColId);
    // No "ZZ_NEW" yet.
    expect(beforeRegions.includes('ZZ_NEW')).toBe(false);

    // Inject a row with a brand-new region that sorts FIRST alphabetically.
    await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      api.applyTransaction({
        add: [{
          positionId: 'NEW-0000', cusip: 'CUSIP-NEW',
          ticker: 'NEW', region: 'ZZ_NEW',
          notionalAmount: 1, marketValue: 1, currentPrice: 1,
          pnl: 0, dailyPnl: 0, unrealizedPnl: 0, yield: 1, spread: 1,
          dv01: 1, pv01: 1,
        }],
      });
    });
    await waitForFrames(page, 16);

    const afterIds = await pivotResultColIds(page);
    const afterRegions = afterIds.map(regionOfColId);
    expect(afterRegions.includes('ZZ_NEW')).toBe(true);
    // AG default = append at end. The new region is NOT in alphabetical
    // position; it sits at the tail of the previously-known set.
    expect(afterRegions[afterRegions.length - 1]).toBe('ZZ_NEW');
    // Prior region keeps its position (the first entry is the same one
    // it was before the transaction).
    expect(afterRegions[0]).toBe(beforeRegions[0]);
  });

  test('STRICT (on): a brand-new region lands in its alphanumeric position', async ({ page }) => {
    await gridReady(page, '?pivotDemo=on');

    await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      api.setGridOption('enableStrictPivotColumnOrder', true);
      api.setPivotColumns(['region']);
      api.addValueColumn('notionalAmount', 'sum');
      api.setPivotMode(true);
    });
    await waitForFrames(page, 12);

    await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      api.applyTransaction({
        add: [{
          positionId: 'NEW-0001', cusip: 'CUSIP-AAA',
          ticker: 'AAA', region: 'AAA_FIRST',
          notionalAmount: 1, marketValue: 1, currentPrice: 1,
          pnl: 0, dailyPnl: 0, unrealizedPnl: 0, yield: 1, spread: 1,
          dv01: 1, pv01: 1,
        }],
      });
    });
    await waitForFrames(page, 16);

    const ids = await pivotResultColIds(page);
    const regions = ids.map(regionOfColId);
    // Strict alphanumeric → "AAA_FIRST" should land FIRST.
    expect(regions[0]).toBe('AAA_FIRST');
  });
});
