/**
 * Cycle 7 / Task 3 — number-filter popup.
 *
 * Verifies that:
 * 1. Clicking the floating-filter expand button on `notionalAmount`
 *    mounts the popup.
 * 2. Selecting `greaterThan` + typing a large number + Apply reduces the
 *    displayed row count.
 * 3. Reset returns the row count to the original.
 * 4. Clicking outside the popup closes it.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
  showColumnFilter: (colId: string) => void;
  hideColumnFilter: () => void;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

async function waitForFrames(page: import('@playwright/test').Page, count = 6): Promise<void> {
  await page.evaluate(
    (n) => new Promise<void>((res) => {
      let i = 0;
      const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    count,
  );
}

test.describe('Cycle 7 / Task 3 — number-filter popup', () => {
  test('clicking the expand button opens the popup', async ({ page }) => {
    await gridReady(page);
    const expand = page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="notionalAmount"]');
    await expect(expand).toHaveCount(1);
    await expand.click();
    const popup = page.locator('.vg-filter-popup-number');
    await expect(popup).toHaveCount(1);
    const select = popup.locator('select');
    await expect(select).toHaveCount(1);
  });

  test('greaterThan + value + Apply reduces the displayed row count', async ({ page }) => {
    await gridReady(page);
    const before = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(before).toBeGreaterThan(10);
    await page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="notionalAmount"]').click();
    const popup = page.locator('.vg-filter-popup-number');
    await popup.locator('select').selectOption('greaterThan');
    await popup.locator('input[data-vg-filter-input="primary"]').fill('1000000');
    await popup.locator('button[data-vg-filter-action="apply"]').click();
    await waitForFrames(page);
    const after = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(after).toBeLessThan(before);
  });

  test('Reset returns the row count to the original', async ({ page }) => {
    await gridReady(page);
    const original = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(original).toBeGreaterThan(10);
    await page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="notionalAmount"]').click();
    const popup = page.locator('.vg-filter-popup-number');
    await popup.locator('select').selectOption('greaterThan');
    await popup.locator('input[data-vg-filter-input="primary"]').fill('1000000');
    await popup.locator('button[data-vg-filter-action="apply"]').click();
    await waitForFrames(page);
    const reduced = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(reduced).toBeLessThan(original);
    // Reset closes-on-apply is true so we need to re-open before Reset.
    await page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="notionalAmount"]').click();
    await page.locator('.vg-filter-popup-number button[data-vg-filter-action="reset"]').click();
    await waitForFrames(page);
    const restored = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(restored).toBe(original);
  });

  test('clicking outside the popup closes it', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="notionalAmount"]').click();
    const popup = page.locator('.vg-filter-popup-number');
    await expect(popup).toHaveCount(1);
    // mousedown on the document body (anywhere outside the popup) closes it.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(popup).toHaveCount(0);
  });

  test('inRange shows two inputs and applies a range filter', async ({ page }) => {
    await gridReady(page);
    const before = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    await page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="notionalAmount"]').click();
    const popup = page.locator('.vg-filter-popup-number');
    await popup.locator('select').selectOption('inRange');
    // Both inputs should now be visible.
    const visiblePrimary = popup.locator('input[data-vg-filter-input="primary"]');
    const visibleSecondary = popup.locator('input[data-vg-filter-input="secondary"]');
    await expect(visiblePrimary).toBeVisible();
    await expect(visibleSecondary).toBeVisible();
    await visiblePrimary.fill('500000');
    await visibleSecondary.fill('2000000');
    await popup.locator('button[data-vg-filter-action="apply"]').click();
    await waitForFrames(page);
    const after = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(after).toBeLessThanOrEqual(before);
  });

  test('VelocityGridApi.showColumnFilter / hideColumnFilter round-trip', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.showColumnFilter('notionalAmount'),
    );
    await expect(page.locator('.vg-filter-popup-number')).toHaveCount(1);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.hideColumnFilter(),
    );
    await expect(page.locator('.vg-filter-popup-number')).toHaveCount(0);
  });
});
