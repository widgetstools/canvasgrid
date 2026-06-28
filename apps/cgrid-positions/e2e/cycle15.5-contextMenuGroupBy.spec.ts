/**
 * Cycle 15.5 / Task 2 — header context menu "Group by" / "Un-Group by" E2E.
 *
 * The default main (header) menu — `buildDefaultMainMenuItems` — appends
 * grouping items gated on column state:
 *   - "Group by <header>"    when the column is groupable AND not grouped
 *   - "Un-Group by <header>" when the column IS a group level
 *   - "Expand All Groups" / "Collapse All Groups" when grouping is active
 *
 * Unit tests (`cgrid/tests/contextMenuGroupBy.test.ts`) cover the registry's
 * predicate + action wiring. This E2E proves the real gesture pipeline:
 * right-click a groupable header → the DOM menu mounts → clicking the item
 * mutates `rowGroupColumns` (the same primitive the panel + tool-panel use)
 * and the menu closes.
 *
 * Config: `?rowGroupPanel=empty` makes `ticker` groupable with nothing
 * grouped initially; `suppressGroupChangesColVis=1` keeps the ticker leaf
 * header visible after grouping so the "Un-Group" path is reachable through
 * the same header.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const MENU_SELECTOR = '.cg-context-menu';

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => { x: number; y: number; w: number; h: number } | null;
  getRowGroupColumns: () => string[];
  setRowData: (rows: unknown[]) => void;
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

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?rowGroupPanel=empty&suppressGroupChangesColVis=1');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
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
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        cusip: `CUSIP${i}`,
        ticker: TICKERS[i % TICKERS.length],
        notionalAmount: 1_000 + i,
        marketValue: (50 + a * 450) * 1_000,
        currentPrice: Math.round((50 + a * 450) * 100) / 100,
        pnl: 0, dailyPnl: 0, unrealizedPnl: 0, yield: 1, spread: 5, dv01: 10, pv01: 10,
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

async function rightClickHeader(page: Page, colId: string): Promise<void> {
  const bounds = await page.evaluate((id) =>
    (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getHeaderBoundsAt(id),
    colId,
  );
  if (!bounds) throw new Error(`no header bounds for ${colId}`);
  const off = await canvasOffset(page);
  await page.mouse.click(
    off.x + bounds.x + bounds.w / 2,
    off.y + bounds.y + bounds.h / 2,
    { button: 'right' },
  );
  await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });
}

async function groupCols(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getRowGroupColumns()
  );
}

test.describe('Cycle 15.5 / Task 2 — header context menu Group / Un-Group', () => {
  test('right-click groupable header → "Group by Ticker" groups; re-open → "Un-Group by Ticker" ungroups', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    // Nothing grouped initially.
    expect(await groupCols(page)).toEqual([]);

    // Target `.cg-menu-item-label` (exact label text, no icon/shortcut) with
    // anchored regexes so "Group by Ticker" can't substring-match
    // "Un-Group by Ticker".
    const labelSel = `${MENU_SELECTOR} .cg-menu-item-label`;

    // Right-click the Ticker header → the menu shows "Group by Ticker"
    // and NOT "Un-Group by Ticker".
    await rightClickHeader(page, 'ticker');
    const groupItem = page.locator(labelSel).filter({ hasText: /^Group by Ticker$/ });
    await expect(groupItem).toHaveCount(1);
    await expect(page.locator(labelSel).filter({ hasText: /^Un-Group by Ticker$/ })).toHaveCount(0);

    // Click "Group by Ticker" → grouping mutates + the menu closes.
    await groupItem.click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 10);
    expect(await groupCols(page)).toEqual(['ticker']);

    // Re-open the menu on the (still-visible) Ticker header → now it shows
    // "Un-Group by Ticker" + the Expand/Collapse-All items (grouping active).
    await rightClickHeader(page, 'ticker');
    await expect(page.locator(labelSel).filter({ hasText: /^Un-Group by Ticker$/ })).toHaveCount(1);
    await expect(page.locator(labelSel).filter({ hasText: /^Group by Ticker$/ })).toHaveCount(0);
    await expect(page.locator(labelSel).filter({ hasText: /^Expand All Groups$/ })).toHaveCount(1);
    await expect(page.locator(labelSel).filter({ hasText: /^Collapse All Groups$/ })).toHaveCount(1);

    // Click "Un-Group by Ticker" → grouping clears + the menu closes.
    await page.locator(labelSel).filter({ hasText: /^Un-Group by Ticker$/ }).click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 10);
    expect(await groupCols(page)).toEqual([]);
  });

  test('Expand/Collapse All Groups items are absent when no grouping is active', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    await rightClickHeader(page, 'ticker');
    // Ungrouped state — no expand/collapse-all items.
    const labelSel = `${MENU_SELECTOR} .cg-menu-item-label`;
    await expect(page.locator(labelSel).filter({ hasText: /^Expand All Groups$/ })).toHaveCount(0);
    await expect(page.locator(labelSel).filter({ hasText: /^Collapse All Groups$/ })).toHaveCount(0);
  });
});
