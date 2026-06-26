/**
 * Cycle 11 / Task 4 — Filters tool panel E2E.
 *
 * Verifies the real (post-Task-1-stub) Filters panel mounts in the side
 * bar host shipped by Task 2 and exercises the user-visible behaviours
 * described in the worklog:
 *
 *   - Top search input filters the row list by colId / headerName
 *     substring.
 *   - Each FILTERABLE column renders as a `>` chevron + label row.
 *   - Clicking a row expands it inline and mounts the column's filter
 *     editor — the SAME editor `FilterPopupHost` mounts in popup mode.
 *   - The chevron flips `>` → `⌄` on expand and the row gains
 *     `data-expanded="true"`.
 *   - Filter mutations propagate through `setColumnFilterModel` so the
 *     grid filter model reflects the user's input.
 *   - Expand-all button expands every row in a single click; clicking
 *     again collapses every row.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const TAB_SELECTOR = '.cg-side-bar-tab';
const FILTERS_TAB = `${TAB_SELECTOR}[data-id="agFiltersToolPanel"]`;
const PANEL = '.cg-filters-panel';

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

async function openFiltersPanel(page: Page): Promise<void> {
  await page.locator(FILTERS_TAB).click();
  await page.waitForSelector(PANEL, { state: 'visible' });
  await waitForFrames(page, 3);
}

test.describe('Cycle 11 / Task 4 — Filters tool panel', () => {
  test('opens with the canonical layout — search input, expand-all button, collapsible column rows', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(`${PANEL} .cg-filters-panel-search input`)).toBeVisible();
    await expect(page.locator(`${PANEL} .cg-filters-panel-expand-all button`)).toBeVisible();

    // Demo grid carries 17 columns, most filterable. Sanity-check the
    // first few row labels are the column headerNames (via
    // getColumnHeaderName).
    const labels = page.locator(`${PANEL} .cg-filters-panel-row-label`);
    await expect(labels.nth(0)).toHaveText('Position ID');
    await expect(labels.nth(1)).toHaveText('CUSIP');
    await expect(labels.nth(2)).toHaveText('Ticker');

    // Every row starts collapsed.
    const expanded = page.locator(`${PANEL} .cg-filters-panel-row[data-expanded="true"]`);
    await expect(expanded).toHaveCount(0);
    // The chevron renders as the `›` glyph.
    const firstChevron = page.locator(`${PANEL} .cg-filters-panel-row .cg-filters-panel-row-chevron`).first();
    await expect(firstChevron).toHaveText('›'); // ›
  });

  test('clicking a row expands it and mounts the column filter editor inline', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    // Pick a numeric column — currentPrice — and expand it. The number
    // filter popup body has the operator <select> + numeric input
    // hallmark.
    const priceRow = page.locator(`${PANEL} .cg-filters-panel-row[data-col-id="currentPrice"]`);
    await priceRow.locator('.cg-filters-panel-row-header').click();
    await waitForFrames(page, 3);

    await expect(priceRow).toHaveAttribute('data-expanded', 'true');
    await expect(priceRow.locator('.cg-filters-panel-row-chevron')).toHaveText('⌄'); // ⌄
    // The reused filter-popup body shows up under the row's editor
    // host. Specifically the `cg-filter-popup-number` class signals
    // the number-filter editor mounted (not a stub).
    await expect(priceRow.locator('.cg-filter-popup-number')).toBeVisible();
    await expect(priceRow.locator('select.cg-filter-popup-operator')).toBeVisible();
  });

  test('committing a filter through the inline editor propagates to the grid filter model', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    const priceRow = page.locator(`${PANEL} .cg-filters-panel-row[data-col-id="currentPrice"]`);
    await priceRow.locator('.cg-filters-panel-row-header').click();
    await waitForFrames(page, 3);

    // Pick the `greaterThan` operator and type a value. Mirrors the
    // path the popup editor follows — same components, same callback
    // wiring.
    await priceRow.locator('select.cg-filter-popup-operator').selectOption('greaterThan');
    await priceRow.locator('input.cg-filter-popup-input[data-cg-filter-input="primary"]').fill('150');
    // Apply commits the model via setColumnFilterModel.
    await priceRow.locator('button.cg-filter-popup-button-apply').click();
    await waitForFrames(page, 6);

    // The grid filter model is the propagation target — assert it
    // carries our entry.
    const model = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { getColumnFilterModel: (c: string) => unknown } }).__cgrid;
      return api ? api.getColumnFilterModel('currentPrice') : null;
    });
    expect(model).toBeTruthy();
  });

  test('only one row stays expanded when the user clicks a second row (the first auto-collapses)', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    const priceRow = page.locator(`${PANEL} .cg-filters-panel-row[data-col-id="currentPrice"]`);
    const yieldRow = page.locator(`${PANEL} .cg-filters-panel-row[data-col-id="yield"]`);

    await priceRow.locator('.cg-filters-panel-row-header').click();
    await waitForFrames(page, 3);
    await expect(priceRow).toHaveAttribute('data-expanded', 'true');

    await yieldRow.locator('.cg-filters-panel-row-header').click();
    await waitForFrames(page, 3);
    await expect(yieldRow).toHaveAttribute('data-expanded', 'true');
    await expect(priceRow).toHaveAttribute('data-expanded', 'false');
  });

  test('clicking an expanded row collapses it back to the chevron-only state', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    const priceRow = page.locator(`${PANEL} .cg-filters-panel-row[data-col-id="currentPrice"]`);
    await priceRow.locator('.cg-filters-panel-row-header').click();
    await waitForFrames(page, 3);
    await expect(priceRow).toHaveAttribute('data-expanded', 'true');

    await priceRow.locator('.cg-filters-panel-row-header').click();
    await waitForFrames(page, 3);
    await expect(priceRow).toHaveAttribute('data-expanded', 'false');
    await expect(priceRow.locator('.cg-filter-popup-number')).toHaveCount(0);
  });

  test('search input filters the row list (case-insensitive substring on header + colId)', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    const search = page.locator(`${PANEL} .cg-filters-panel-search input`);
    await search.fill('pri');
    await waitForFrames(page, 3);
    const visibleRows = page.locator(`${PANEL} .cg-filters-panel-row:not([style*="display: none"])`);
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toHaveAttribute('data-col-id', 'currentPrice');

    // Clear search — every row returns.
    await search.fill('');
    await waitForFrames(page, 3);
    const allRows = await page.locator(`${PANEL} .cg-filters-panel-row`).count();
    const restored = await page.locator(`${PANEL} .cg-filters-panel-row:not([style*="display: none"])`).count();
    expect(restored).toBe(allRows);
  });

  test('expand-all button expands every row in a single click; clicking again collapses them', async ({ page }) => {
    await gridReady(page);
    await openFiltersPanel(page);

    const expandBtn = page.locator(`${PANEL} .cg-filters-panel-expand-all button`);
    const rows = page.locator(`${PANEL} .cg-filters-panel-row`);
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);

    await expandBtn.click();
    await waitForFrames(page, 6);
    const expanded = page.locator(`${PANEL} .cg-filters-panel-row[data-expanded="true"]`);
    await expect(expanded).toHaveCount(total);

    await expandBtn.click();
    await waitForFrames(page, 3);
    const stillExpanded = page.locator(`${PANEL} .cg-filters-panel-row[data-expanded="true"]`);
    await expect(stillExpanded).toHaveCount(0);
  });
});
