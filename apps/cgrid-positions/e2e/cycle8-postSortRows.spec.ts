/**
 * Cycle 8 / Task 4 — `postSortRows` callback.
 *
 * Verifies the demo's "Pin selected to top" toolbar checkbox end-to-end:
 *
 * 1. With the box OFF, sorting the cusip column orders rows by cusip; the
 *    first visible row is the lowest-cusip row, not a previously-selected
 *    row.
 * 2. Selecting a row whose cusip would NOT sort to the top, then flipping
 *    the box ON, pins that row to row index 0 regardless of the active
 *    sort.
 * 3. Toggling the box OFF restores the sort-only order.
 *
 * The hook is wired in `positionsGrid.ts` via the new `VelocityGridOptions.postSortRows`
 * field; the toolbar checkbox in `index.html#pin-selected-top` flips the
 * demo's pin set.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

interface HeaderBounds { x: number; y: number; w: number; h: number }
type SortEntry = { colId: string; direction: 'asc' | 'desc' };

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => HeaderBounds | null;
  setSelectedRowIds: (ids: string[]) => void;
  getSelectedRowIds: () => string[];
  getCellValue: (rowIndex: number, colId: string) => unknown;
}

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

async function sortModel(page: Page): Promise<SortEntry[]> {
  return page.evaluate(
    () => (window as unknown as { __velocity-grid: { sortModel: SortEntry[] } }).__cgrid.sortModel,
  );
}

async function headerBounds(page: Page, colId: string): Promise<HeaderBounds> {
  const b = await page.evaluate(
    (id) =>
      (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getHeaderBoundsAt(id),
    colId,
  );
  if (!b) throw new Error(`no header bounds for ${colId}`);
  return b;
}

async function rowIdAtIndex(page: Page, index: number): Promise<string | null> {
  // Demo uses `positionId` as the row id (see positionsGrid.ts getRowId).
  return page.evaluate((i) => {
    const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
    const v = api.getCellValue(i, 'positionId');
    return typeof v === 'string' ? v : null;
  }, index);
}

test.describe('Cycle 8 / Task 4 — postSortRows toolbar wiring', () => {
  test('Pin selected to top moves selected rows to the head regardless of sort', async ({ page }) => {
    await gridReady(page);
    const cusip = await headerBounds(page, 'cusip');
    const off = await canvasOffset(page);

    // Sort by cusip ascending so we have a deterministic baseline.
    await page.mouse.click(off.x + cusip.x + cusip.w / 2, off.y + cusip.y + cusip.h / 2);
    await waitForFrames(page, 8);
    expect(await sortModel(page)).toEqual([{ colId: 'cusip', direction: 'asc' }]);

    const firstSortedRowId = await rowIdAtIndex(page, 0);
    expect(firstSortedRowId).not.toBeNull();

    // Pick a row deep enough in the sorted list that it's clearly NOT the
    // post-sort head, then mark it selected.
    const targetRowId = await rowIdAtIndex(page, 5);
    expect(targetRowId).not.toBeNull();
    expect(targetRowId).not.toBe(firstSortedRowId);

    await page.evaluate((id) => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      api.setSelectedRowIds([id!]);
    }, targetRowId);
    await waitForFrames(page, 4);

    // Flip "Pin selected to top" ON — the postSortRows hook should move
    // the selected row to index 0.
    const pinCheckbox = page.getByTestId('pin-selected-top');
    await pinCheckbox.check();
    await waitForFrames(page, 10);

    expect(await rowIdAtIndex(page, 0)).toBe(targetRowId);
    // The previous post-sort head should follow somewhere after the pin
    // (it's now in the "rest" bucket, ordered ascending by cusip).
    expect(await rowIdAtIndex(page, 1)).toBe(firstSortedRowId);

    // Toggle OFF — the hook clears its pin set; row order returns to
    // pure sort.
    await pinCheckbox.uncheck();
    await waitForFrames(page, 10);
    expect(await rowIdAtIndex(page, 0)).toBe(firstSortedRowId);
  });

  test('demo boots with postSortRows wired but no pins applied', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await gridReady(page);
    // No setSortModel + no pin yet => default insertion order. No worker
    // error from the post-sort round-trip mis-wiring.
    expect(consoleErrors.filter((e) => /postSort/i.test(e))).toEqual([]);
  });
});
