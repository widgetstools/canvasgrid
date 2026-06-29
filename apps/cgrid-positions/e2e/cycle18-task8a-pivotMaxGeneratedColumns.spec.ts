/**
 * Cycle 18 / Task 8a — pivotMaxGeneratedColumns cap + pivotMaxColumnsReached
 * event E2E.
 *
 * Drives the live positions grid with `?pivotDemo=on` + a forced low cap
 * (`?pivotMaxGeneratedColumns=N`) and asserts the AG-parity Prompt 8 cap
 * contract. Pivots by `region` (NOT `sector`) — the positions snapshot
 * stamps region/desk/currency/trader via `decorateWithCategoricals` but
 * leaves sector undefined for unseeded rows, so a sector-pivot collapses
 * to a single empty-string key and won't trip a small cap.
 *   - When `leafPaths × valueCols > cap`, the chunk arrives with no
 *     pivot result columns synthesized — primary columns render
 *     normally — and the public `pivotMaxColumnsReached` event fires.
 *   - When the app raises the cap at runtime via `setGridOption`, the
 *     next viewport request honors the new ceiling and pivot result
 *     columns appear.
 *
 * Why this matters: a high-cardinality pivot column would synthesize
 * millions of columns and DoS the renderer; the cap + event let the app
 * recover (raise the limit, narrow the filter, warn the user).
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

interface GridApiSurface {
  setPivotColumns: (cols: string[]) => void;
  addValueColumn: (colId: string, aggFunc: string) => void;
  setPivotMode: (mode: boolean) => void;
  isPivotMode: () => boolean;
  getColumnState: () => Array<{ colId: string }>;
  setGridOption: (key: string, value: unknown) => void;
  addEventListener: (type: string, handler: (e: unknown) => void) => void;
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

/** Install a listener for `pivotMaxColumnsReached` that records every
 *  fired event on `window.__pivotBreaches`. Set BEFORE any pivot mutation
 *  so the FIRST viewport with the breach is captured. */
async function installBreachListener(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __cgrid: GridApiSurface;
      __pivotBreaches: Array<{ generatedColumns: number; cap: number }>;
    };
    w.__pivotBreaches = [];
    w.__cgrid.addEventListener('pivotMaxColumnsReached', (e: unknown) => {
      const ev = e as { generatedColumns: number; cap: number };
      w.__pivotBreaches.push({ generatedColumns: ev.generatedColumns, cap: ev.cap });
    });
  });
}

async function readBreaches(page: Page): Promise<Array<{ generatedColumns: number; cap: number }>> {
  return page.evaluate(() =>
    (window as unknown as { __pivotBreaches: Array<{ generatedColumns: number; cap: number }> })
      .__pivotBreaches ?? []
  );
}

async function pivotResultColCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    // `getColumnState` reports PRIMARY cols under pivot mode (Cycle 18 /
    // Task 9 fix for AG-Grid parity). Read the actually-rendered list
    // from `columnOrder` instead so we count synthesized leaves.
    const grid = (window as unknown as {
      __cgrid: { columnOrder: Array<{ colId: string }> };
    }).__cgrid;
    return (grid.columnOrder ?? []).filter((c) => c.colId.startsWith('pivotcol')).length;
  });
}

test.describe('Cycle 18 / Task 8a — pivotMaxGeneratedColumns cap', () => {
  test('a forced low cap triggers pivotMaxColumnsReached AND no pivot result columns synthesize', async ({ page }) => {
    // Cap at 1. Sector has 2 distinct values × 1 value col = 2 generated → breach.
    await gridReady(page, '?pivotDemo=on&pivotMaxGeneratedColumns=1');
    await installBreachListener(page);

    // Trigger a pivot — pivot by `sector` with sum(notionalAmount). The
    // distinct-key set discovered from data will produce more than 1
    // synthesized column → breach.
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setPivotColumns(['region']);
      api.addValueColumn('notionalAmount', 'sum');
      api.setPivotMode(true);
    });
    await waitForFrames(page, 12);

    const breaches = await readBreaches(page);
    expect(breaches.length).toBeGreaterThanOrEqual(1);
    expect(breaches[0]!.cap).toBe(1);
    expect(breaches[0]!.generatedColumns).toBeGreaterThanOrEqual(2);

    // No pivot result columns made it into the column state — the
    // primary columns render normally even though pivotMode === true.
    expect(await pivotResultColCount(page)).toBe(0);
  });

  test('raising the cap at runtime via setGridOption clears the breach and synthesizes pivot result columns', async ({ page }) => {
    await gridReady(page, '?pivotDemo=on&pivotMaxGeneratedColumns=1');
    await installBreachListener(page);

    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setPivotColumns(['region']);
      api.addValueColumn('notionalAmount', 'sum');
      api.setPivotMode(true);
    });
    await waitForFrames(page, 12);
    expect(await pivotResultColCount(page)).toBe(0);

    // Raise the cap → next chunk has pivot output, no further breach.
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setGridOption('pivotMaxGeneratedColumns', 5000);
    });
    await waitForFrames(page, 12);

    expect(await pivotResultColCount(page)).toBeGreaterThan(0);
  });

  test('a generous default cap (5000) does not trip on the demo workload', async ({ page }) => {
    await gridReady(page, '?pivotDemo=on');
    await installBreachListener(page);

    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setPivotColumns(['region']);
      api.addValueColumn('notionalAmount', 'sum');
      api.setPivotMode(true);
    });
    await waitForFrames(page, 12);

    expect(await readBreaches(page)).toEqual([]);
    expect(await pivotResultColCount(page)).toBeGreaterThan(0);
  });
});
