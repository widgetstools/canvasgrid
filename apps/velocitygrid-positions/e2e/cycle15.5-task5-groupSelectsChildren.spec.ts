/**
 * Cycle 15.5 / Task 5 — `groupSelectsChildren` functional E2E.
 *
 * When `groupSelectsChildren: true`, the group row's tri-state checkbox
 * reflects the selection state of all descendant leaf rows:
 *   'none'    → no children selected
 *   'partial' → some children selected
 *   'all'     → all children selected
 *
 * The SelectionModel's `setGroupSelected` cascades selection to all
 * descendant leaf rows. This test drives that via `setSelectedRowIds`
 * (public API) and verifies that `getCellValue` reflects the resulting
 * aggregate state — i.e. that the membership resolver and selection state
 * computation are wired correctly.
 *
 * Test plan:
 *   1. Seed 10 rows in 2 groups (5 AAPL + 5 MSFT). No rows selected.
 *   2. `getCellValue(0, 'ag-Grid-AutoColumn').selectionState` = 'none'.
 *   3. `setSelectedRowIds([all 5 AAPL rowIds])`.
 *   4. `getCellValue(0, 'ag-Grid-AutoColumn').selectionState` = 'all'.
 *   5. `setSelectedRowIds([2 of 5 AAPL rowIds])`.
 *   6. `getCellValue(0, 'ag-Grid-AutoColumn').selectionState` = 'partial'.
 *   7. `setSelectedRowIds([])` — deselect.
 *   8. `getCellValue(0, 'ag-Grid-AutoColumn').selectionState` = 'none'.
 *
 * Regression guard: if the cascade/membership machinery breaks, the group
 * selectionState would always return 'none' regardless of leaf selection.
 */
import { test, expect, Page } from '@playwright/test';

interface GroupCellValue {
  selectionState?: 'none' | 'partial' | 'all';
  childCount?: number;
}

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getCellValue: (rowIndex: number, colId: string) => unknown;
  setSelectedRowIds: (ids: string[]) => void;
  getSelectedRowIds: () => string[];
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
  await page.goto('/?grouping=ticker&groupSelectsChildren=1&totals=off');
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function seedTwoGroups(page: Page): Promise<string[]> {
  // Seed rows and return AAPL row IDs.
  const aaplIds = await page.evaluate(() => {
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    const rows: Array<Record<string, unknown>> = [];
    const TICKERS = ['AAPL', 'MSFT'];
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const ticker = TICKERS[Math.floor(i / 5)]!;
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      const positionId = `POS-${String(i).padStart(6, '0')}`;
      if (ticker === 'AAPL') ids.push(positionId);
      rows.push({
        positionId,
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
    return ids;
  });

  // Wait for firstDataRendered, then re-apply the group model so the
  // setGroupModel response carries groupDescendants (refreshing the
  // membership cache). setRowData alone does not trigger the descendants
  // round-trip; setGroupModel after data is seeded is the reliable path.
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 10_000 },
  );
  // `resetRowGroupExpansion()` calls `setGroupModel(currentModel)` directly,
  // bypassing the same-order no-op guard. The setGroupModel response carries
  // `groupDescendants` (because emitGroupDescendants is true after
  // applyGroupSelectsChildren), which populates the membership cache.
  // setRowData alone doesn't trigger a descendants round-trip, so this is the
  // reliable way to seed the cache after seeding rows.
  await page.evaluate(() => {
    (window as unknown as { __cgrid: GridApiSurface }).__cgrid.resetRowGroupExpansion();
  });
  await waitForFrames(page, 16);
  return aaplIds;
}

test.describe('Cycle 15.5 / Task 5 — groupSelectsChildren cascade selection state', () => {
  test('selectionState reflects descendant selection: none → all → partial → none', async ({ page }) => {
    await gridReady(page);
    const aaplIds = await seedTwoGroups(page);

    // Row 0 = AAPL group row. Initially no selection.
    const stateBefore = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const v = api.getCellValue(0, 'ag-Grid-AutoColumn') as GroupCellValue;
      return v?.selectionState;
    });
    expect(stateBefore).toBe('none');

    // Select ALL 5 AAPL leaf rows → group state becomes 'all'.
    await page.evaluate((ids) => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setSelectedRowIds(ids);
    }, aaplIds);
    await waitForFrames(page, 12);

    const stateAll = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const v = api.getCellValue(0, 'ag-Grid-AutoColumn') as GroupCellValue;
      return v?.selectionState;
    });
    expect(stateAll).toBe('all');

    // Select only 2 of 5 AAPL rows → group state becomes 'partial'.
    await page.evaluate((ids) => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setSelectedRowIds(ids.slice(0, 2));
    }, aaplIds);
    await waitForFrames(page, 12);

    const statePartial = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const v = api.getCellValue(0, 'ag-Grid-AutoColumn') as GroupCellValue;
      return v?.selectionState;
    });
    expect(statePartial).toBe('partial');

    // Deselect all → group state returns to 'none'.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setSelectedRowIds([]);
    });
    await waitForFrames(page, 12);

    const stateAfterDeselect = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const v = api.getCellValue(0, 'ag-Grid-AutoColumn') as GroupCellValue;
      return v?.selectionState;
    });
    expect(stateAfterDeselect).toBe('none');
  });
});
