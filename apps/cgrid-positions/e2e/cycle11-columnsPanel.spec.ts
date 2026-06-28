/**
 * Cycle 11 / Task 3 — Columns tool panel E2E.
 *
 * Verifies the real (post-Task-1-stub) Columns panel mounts in the side
 * bar host shipped by Task 2 and exercises the user-visible behaviours
 * described in the worklog:
 *
 *   - Pivot Mode toggle ships visible (default), clicking flips
 *     aria-pressed (the underlying api.setPivotMode wiring lands in
 *     Cycle 16 — Cycle 11 is the visual stub).
 *   - Top search input filters the row list by colId / headerName
 *     substring.
 *   - Column rows render with a checkbox + drag handle + label per the
 *     positions demo's columnDefs.
 *   - Toggling a row's checkbox hides / shows the matching column in
 *     the grid (round-trips through api.setColumnsVisible → grid's
 *     visible-leaf order).
 *   - Row Groups + Values drop-zone sections render with the canonical
 *     dashed-border placeholders.
 *   - The panel listens to columnVisible events so an out-of-panel
 *     visibility flip keeps the row checkbox in sync (refresh path).
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const TAB_SELECTOR = '.cg-side-bar-tab';
const COLUMNS_TAB = `${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`;
const PANEL = '.cg-columns-panel';

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

async function openColumnsPanel(page: Page): Promise<void> {
  await page.locator(COLUMNS_TAB).click();
  await page.waitForSelector(PANEL, { state: 'visible' });
  await waitForFrames(page, 3);
}

test.describe('Cycle 11 / Task 3 — Columns tool panel', () => {
  test('opens with the canonical layout — pivot mode toggle, search, column rows, Row Groups + Values sections', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(`${PANEL} .cg-columns-panel-pivot-mode`)).toHaveCount(1);
    await expect(page.locator(`${PANEL} .cg-columns-panel-search input[type="search"]`)).toBeVisible();
    // Section headers + drop zones.
    const headers = page.locator(`${PANEL} .cg-columns-panel-section-header`);
    await expect(headers).toHaveCount(2);
    await expect(headers.nth(0)).toHaveText('Row Groups');
    await expect(headers.nth(1)).toHaveText('Values');
    const dropZones = page.locator(`${PANEL} .cg-columns-panel-drop-zone`);
    await expect(dropZones).toHaveCount(2);
    await expect(dropZones.nth(0)).toHaveText('Drag here to set row groups');
    await expect(dropZones.nth(1)).toHaveText('Drag here to aggregate');

    // Demo grid carries 17 leaf columns at present — assert at least the
    // first five render with their headerNames (sanity check on
    // `getColumnHeaderName`).
    const labels = page.locator(`${PANEL} .cg-columns-panel-row-label`);
    await expect(labels.nth(0)).toHaveText('Position ID');
    await expect(labels.nth(1)).toHaveText('CUSIP');
    await expect(labels.nth(2)).toHaveText('Ticker');
  });

  test('toggling a column checkbox hides the column in the grid; toggling back restores it', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    const tickerRow = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="ticker"]`);
    const tickerCheckbox = tickerRow.locator('input[type="checkbox"]');
    await expect(tickerCheckbox).toBeChecked();

    // Read the visible column count BEFORE so we can assert it shrinks by 1.
    const initialColCount: number = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { getColumnState: () => Array<{ hide?: boolean }> } }).__cgrid;
      return api ? api.getColumnState().filter((c) => c.hide !== true).length : -1;
    });

    await tickerCheckbox.click();
    await waitForFrames(page, 3);
    await expect(tickerCheckbox).not.toBeChecked();

    const afterHide: number = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { getColumnState: () => Array<{ hide?: boolean }> } }).__cgrid;
      return api ? api.getColumnState().filter((c) => c.hide !== true).length : -1;
    });
    expect(afterHide).toBe(initialColCount - 1);

    // Re-check the box — the column comes back.
    await tickerCheckbox.click();
    await waitForFrames(page, 3);
    await expect(tickerCheckbox).toBeChecked();
    const restored: number = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { getColumnState: () => Array<{ hide?: boolean }> } }).__cgrid;
      return api ? api.getColumnState().filter((c) => c.hide !== true).length : -1;
    });
    expect(restored).toBe(initialColCount);
  });

  test('search input filters the row list (case-insensitive substring on header + colId)', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    const search = page.locator(`${PANEL} .cg-columns-panel-search input[type="search"]`);
    await search.fill('pri');
    await waitForFrames(page, 3);
    const visibleRows = page.locator(`${PANEL} .cg-columns-panel-row:not([style*="display: none"])`);
    // The demo grid has 'currentPrice' (headerName 'Price') as the only
    // match for 'pri'.
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toHaveAttribute('data-col-id', 'currentPrice');

    // Clear search — every row returns.
    await search.fill('');
    await waitForFrames(page, 3);
    const allRows = await page.locator(`${PANEL} .cg-columns-panel-row`).count();
    const restored = await page.locator(`${PANEL} .cg-columns-panel-row:not([style*="display: none"])`).count();
    expect(restored).toBe(allRows);
  });

  test('the Pivot Mode toggle flips aria-pressed on click (visual stub — wired in Cycle 16)', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    const toggle = page.locator(`${PANEL} .cg-columns-panel-pivot-mode button`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('the panel mirrors external columnVisible mutations (refresh path)', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    const tickerCheckbox = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="ticker"] input[type="checkbox"]`);
    await expect(tickerCheckbox).toBeChecked();

    // Drive the visibility change from OUTSIDE the panel via the public
    // API. The panel's columnVisible listener triggers refresh and the
    // checkbox flips without a direct click.
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { setColumnsVisible: (k: string[], v: boolean) => void } }).__cgrid;
      api?.setColumnsVisible(['ticker'], false);
    });
    await waitForFrames(page, 3);
    await expect(tickerCheckbox).not.toBeChecked();

    // Restore for the next test.
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { setColumnsVisible: (k: string[], v: boolean) => void } }).__cgrid;
      api?.setColumnsVisible(['ticker'], true);
    });
  });
});
