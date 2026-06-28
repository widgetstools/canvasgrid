/**
 * Cycle 15.5 / Task 6 — keyboard group navigation E2E.
 *
 * AG Grid parity: when focus is on a group row in the auto-group column,
 *   ArrowRight → expand (no-op if already expanded)
 *   ArrowLeft  → collapse (no-op if already collapsed)
 *   Enter      → toggle
 *   Space      → toggle
 *
 * Implementation: `GroupExpandFeature.handleKeyDown` in
 * `cgrid/src/interaction/features/groupExpand.ts`.
 *
 * The test seeds rows, focuses a group row (clicking the cell body — not
 * the chevron, which would toggle instead of just focus), then fires
 * keyboard events via Playwright's `canvas.press()` and asserts the
 * `isGroupExpanded` state via the public API.
 */
import { test, expect, Page } from '@playwright/test';

interface CellBounds { x: number; y: number; w: number; h: number }

interface GridApiSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => CellBounds | null;
  isGroupRow: (rowIndex: number) => boolean;
  isGroupExpanded: (groupKey: string) => boolean;
  getGroupKeyAtRow: (rowIndex: number) => string;
  setRowData: (rows: unknown[]) => void;
}

const GRID_SELECTOR = '#grid canvas';

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

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?grouping=ticker&totals=off');
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function seedRows(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => {
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'BRK', 'JPM', 'XOM'];
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
      const ticker = TICKERS[i % TICKERS.length];
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      const b = (((i + 1) * 2246822519) >>> 0) / 0x1_0000_0000;
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        cusip: `CUSIP${i}`,
        ticker,
        sector: 'Tech',
        subSector: 'Software',
        notionalAmount: Math.round((1_000 + b * 99_000) / 100) * 100,
        marketValue: (50 + a * 450) * 1_000,
        currentPrice: Math.round((50 + a * 450) * 100) / 100,
        pnl: 0, dailyPnl: 0, unrealizedPnl: 0,
        yield: 1, spread: 5, dv01: 10, pv01: 10,
      });
    }
    g.setRowData(rows);
  }, count);
  await waitForFrames(page, 12);
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

test.describe('Cycle 15.5 / Task 6 — keyboard group navigation', () => {
  test('ArrowLeft collapses an expanded group row; ArrowRight re-expands it', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    // Row 0 must be a group row.
    const isGroup = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupRow(0)
    );
    expect(isGroup).toBe(true);

    // Get the group key so we can check expanded state.
    const groupKey = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getGroupKeyAtRow(0)
    );
    expect(groupKey.length).toBeGreaterThan(0);

    // All groups expand by default → row 0 should be expanded.
    const expandedBefore = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(expandedBefore).toBe(true);

    // Click the center of the auto-group cell (well past the chevron at ≈x+18)
    // to set keyboard focus without triggering a chevron toggle.
    const bounds = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getCellBoundsAt(0, 'ag-Grid-AutoColumn')
    );
    expect(bounds).not.toBeNull();

    const off = await canvasOffset(page);
    // Click at x = bounds.x + 80 (far past the 18 px chevron zone), y = cell middle.
    const clickX = off.x + bounds!.x + Math.min(80, Math.round(bounds!.w * 0.6));
    const clickY = off.y + bounds!.y + Math.round(bounds!.h / 2);
    await page.mouse.click(clickX, clickY);
    await waitForFrames(page, 4);

    // ArrowLeft → collapse the expanded group row.
    const canvas = page.locator(GRID_SELECTOR);
    await canvas.press('ArrowLeft');
    await waitForFrames(page, 8);

    const collapsedAfterLeft = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(collapsedAfterLeft).toBe(false);

    // ArrowLeft again on an already-collapsed group → no-op.
    await canvas.press('ArrowLeft');
    await waitForFrames(page, 4);
    const stillCollapsed = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(stillCollapsed).toBe(false);

    // ArrowRight → re-expand.
    await canvas.press('ArrowRight');
    await waitForFrames(page, 8);
    const expandedAfterRight = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(expandedAfterRight).toBe(true);

    // ArrowRight again on an already-expanded group → no-op.
    await canvas.press('ArrowRight');
    await waitForFrames(page, 4);
    const stillExpanded = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(stillExpanded).toBe(true);
  });

  test('aria-expanded on the focused group row flips with keyboard toggle; absent on leaf rows', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    // Focus the group row at index 0.
    const bounds = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getCellBoundsAt(0, 'ag-Grid-AutoColumn')
    );
    const off = await canvasOffset(page);
    await page.mouse.click(
      off.x + bounds!.x + Math.min(80, Math.round(bounds!.w * 0.6)),
      off.y + bounds!.y + Math.round(bounds!.h / 2),
    );
    await waitForFrames(page, 6);

    const ariaExpanded = (): Promise<string | null> => page.evaluate(() => {
      const row = document.querySelector('.cg-a11y-root [role="row"]');
      return row ? row.getAttribute('aria-expanded') : 'NO_ROW';
    });

    // Focused expanded group row → aria-expanded="true".
    expect(await ariaExpanded()).toBe('true');

    const canvas = page.locator(GRID_SELECTOR);
    // ArrowLeft collapses → aria-expanded="false".
    await canvas.press('ArrowLeft');
    await waitForFrames(page, 8);
    expect(await ariaExpanded()).toBe('false');

    // ArrowRight re-expands → aria-expanded="true".
    await canvas.press('ArrowRight');
    await waitForFrames(page, 8);
    expect(await ariaExpanded()).toBe('true');

    // Move focus to a leaf (data) row → attribute removed entirely.
    const leafBounds = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getCellBoundsAt(1, 'ag-Grid-AutoColumn')
    );
    await page.mouse.click(
      off.x + leafBounds!.x + Math.min(80, Math.round(leafBounds!.w * 0.6)),
      off.y + leafBounds!.y + Math.round(leafBounds!.h / 2),
    );
    await waitForFrames(page, 6);
    expect(await ariaExpanded()).toBeNull();
  });

  test('Enter toggles a group row (expand → collapse → expand)', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    const groupKey = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getGroupKeyAtRow(0)
    );

    // Start: expanded (default). Focus the group row.
    const bounds = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getCellBoundsAt(0, 'ag-Grid-AutoColumn')
    );
    const off = await canvasOffset(page);
    const clickX = off.x + bounds!.x + Math.min(80, Math.round(bounds!.w * 0.6));
    const clickY = off.y + bounds!.y + Math.round(bounds!.h / 2);
    await page.mouse.click(clickX, clickY);
    await waitForFrames(page, 4);

    const canvas = page.locator(GRID_SELECTOR);

    // Enter → collapse.
    await canvas.press('Enter');
    await waitForFrames(page, 8);
    const afterFirstEnter = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(afterFirstEnter).toBe(false);

    // Enter again → re-expand.
    await canvas.press('Enter');
    await waitForFrames(page, 8);
    const afterSecondEnter = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(afterSecondEnter).toBe(true);
  });

  test('Space toggles a group row (expand → collapse → expand)', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    const groupKey = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getGroupKeyAtRow(0)
    );

    // Focus the group row.
    const bounds = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getCellBoundsAt(0, 'ag-Grid-AutoColumn')
    );
    const off = await canvasOffset(page);
    await page.mouse.click(
      off.x + bounds!.x + Math.min(80, Math.round(bounds!.w * 0.6)),
      off.y + bounds!.y + Math.round(bounds!.h / 2),
    );
    await waitForFrames(page, 4);

    const canvas = page.locator(GRID_SELECTOR);

    // Space → collapse.
    await canvas.press('Space');
    await waitForFrames(page, 8);
    const afterSpace1 = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(afterSpace1).toBe(false);

    // Space again → expand.
    await canvas.press('Space');
    await waitForFrames(page, 8);
    const afterSpace2 = await page.evaluate((key) =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isGroupExpanded(key),
      groupKey,
    );
    expect(afterSpace2).toBe(true);
  });

  test('keyboard nav does not fire on a leaf (data) row', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    // Row 1 should be a leaf row (row 0 = group, row 1 = first leaf under it).
    const isLeaf = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return !g.isGroupRow(1);
    });
    expect(isLeaf).toBe(true);

    // Snapshot the full expanded set before pressing keys on a leaf.
    const keysBefore = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const arr: string[] = [];
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(i => {
        const k = g.getGroupKeyAtRow(i);
        if (k) arr.push(k);
      });
      return arr;
    });

    // Focus leaf row 1.
    const bounds = await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getCellBoundsAt(1, 'ag-Grid-AutoColumn')
    );
    const off = await canvasOffset(page);
    await page.mouse.click(
      off.x + bounds!.x + Math.min(80, Math.round(bounds!.w * 0.6)),
      off.y + bounds!.y + Math.round(bounds!.h / 2),
    );
    await waitForFrames(page, 4);

    const canvas = page.locator(GRID_SELECTOR);

    // ArrowLeft on a leaf — should NOT collapse any group.
    await canvas.press('ArrowLeft');
    await waitForFrames(page, 4);

    // Re-check expansion state for all rows sampled before.
    const keysAfter = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const arr: string[] = [];
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(i => {
        const k = g.getGroupKeyAtRow(i);
        if (k) arr.push(k);
      });
      return arr;
    });

    // Row visibility (groupKeys at each row index) must be unchanged.
    expect(keysAfter).toEqual(keysBefore);
  });
});
