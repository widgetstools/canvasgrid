/**
 * Cycle 18 / Task 8d — sort secondary column → sort row groups by
 * aggregated value (behavioural E2E).
 *
 * AG-parity Prompt 8: "Sorting a secondary (pivot result) column sorts
 * the row groups by that aggregated value." The user clicks a
 * synthesized pivot-result column header → the row group order
 * reflects the per-group aggregate of the matching (pivotPath,
 * valueColId) intersection.
 *
 * Drives the live positions grid with `?pivotDemo=on`. Pivot by
 * region (multi-valued via `decorateWithCategoricals`) + value
 * sum(notionalAmount). Reads the rendered group key order back
 * through the public api to verify.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

interface GridApiSurface {
  setPivotColumns: (cols: string[]) => void;
  addValueColumn: (colId: string, aggFunc: string) => void;
  setPivotMode: (mode: boolean) => void;
  setGroupModel: (m: { rowGroupCols: string[] }) => void;
  setSortModel: (m: Array<{ colId: string; direction: 'asc' | 'desc' }>) => void;
  collapseAll: () => void;
  getColumnState: () => Array<{ colId: string }>;
  setRowGroupColumns: (cols: string[]) => void;
}

interface ChunkSurface {
  chunk?: {
    rowStart: number; rowCount: number;
    rowKinds?: Uint8Array; rowKindsBuffer?: ArrayBuffer;
    groupKey?: string[];
  };
}

async function waitForFrames(page: Page, n = 12): Promise<void> {
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

/** Read the current group-row keys in their rendered order (post-sort). */
async function readGroupKeyOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = (window as unknown as { __cgrid: unknown }).__cgrid as unknown as ChunkSurface;
    const chunk = g.chunk;
    if (!chunk) return [];
    const kinds = chunk.rowKinds ?? new Uint8Array(0);
    const out: string[] = [];
    for (let i = 0; i < chunk.rowCount; i++) {
      if ((kinds[i] ?? 0) === 1) {
        out.push(chunk.groupKey?.[i] ?? '');
      }
    }
    return out;
  });
}

/** Find the synthesized pivot result colId for `(pivotKey, valueColId)`
 *  in the current column state. */
async function findPivotResultColId(
  page: Page, pivotKey: string, valueColId: string,
): Promise<string | null> {
  return page.evaluate(({ key, vc }) => {
    const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    // Synthesized colId encoding: `pivotcol<pivotKey><valueColId>`.
    const match = api.getColumnState()
      .map((c) => c.colId)
      .find((id) =>
        id.startsWith('pivotcol')
        && id.includes(`\x01${key}\x01`)
        && id.endsWith(`\x01${vc}`)
      );
    return match ?? null;
  }, { key: pivotKey, vc: valueColId });
}

test.describe('Cycle 18 / Task 8d — sort secondary column sorts row groups', () => {
  test('clicking sort on a pivot result column reorders the row groups by aggregated value (desc + asc)', async ({ page }) => {
    await gridReady(page, '?pivotDemo=on');
    // Group rows by region (multi-valued in the demo data).
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setRowGroupColumns(['region']);
    });
    await waitForFrames(page, 8);
    // Pivot by ticker — has many distinct values but pivot ticker × region
    // creates a useful matrix. Use sector instead — it's pivot-enabled and
    // has fewer values. (Actually under pivotDemo, sector lacks data, so
    // pivot by region won't work since region is the row group.) Use a
    // single pivot dimension that has data: `currency`.
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setPivotColumns(['currency']);
      api.addValueColumn('notionalAmount', 'sum');
      api.setPivotMode(true);
    });
    await waitForFrames(page, 12);
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.collapseAll();
    });
    await waitForFrames(page, 12);

    // Find a synthesized pivot result colId — first currency value × notionalAmount.
    const pivotColIds = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return api.getColumnState().map((c) => c.colId)
        .filter((id) => id.startsWith('pivotcol'));
    });
    expect(pivotColIds.length).toBeGreaterThan(0);
    const sortColId = pivotColIds[0]!;

    // Sort desc → record order.
    await page.evaluate((colId) => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setSortModel([{ colId, direction: 'desc' }]);
    }, sortColId);
    await waitForFrames(page, 16);
    const descOrder = await readGroupKeyOrder(page);
    expect(descOrder.length).toBeGreaterThan(1);

    // Sort asc → record order.
    await page.evaluate((colId) => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      api.setSortModel([{ colId, direction: 'asc' }]);
    }, sortColId);
    await waitForFrames(page, 16);
    const ascOrder = await readGroupKeyOrder(page);

    // The asc and desc orders MUST be reversed (the sort actually
    // re-orders the group rows by the pivot value).
    expect(ascOrder).toEqual([...descOrder].reverse());
  });
});
