/**
 * Cycle 7 / Task 4 — date-filter popup.
 *
 * Verifies that:
 * 1. Clicking the floating-filter expand button on `tradeDate` mounts
 *    the date popup.
 * 2. The operator <select> exposes the full 9-op surface.
 * 3. Selecting `inRange` reveals a second date input.
 * 4. Applying `notBlank` reduces the displayed row count (the demo's
 *    `tradeDate` is empty on every snapshot row — STOMP does not send
 *    it — so notBlank filters every row out, exactly the dramatic
 *    "filter actually applied" signal the number-filter spec gets from
 *    `>1000000` on `notionalAmount`).
 * 5. Re-opening the popup and clicking Reset restores the original
 *    row count.
 * 6. Clicking outside the popup closes it.
 * 7. The `CGridApi.showColumnFilter` / `hideColumnFilter` round-trip
 *    drives the date popup the same way it drives the number popup.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
  showColumnFilter: (colId: string) => void;
  hideColumnFilter: () => void;
  ensureColumnVisible: (colId: string, position?: 'auto' | 'start' | 'middle' | 'end') => void;
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
  // tradeDate is past the initial 1400px viewport — the floating-filter
  // overlay keeps its expand button in the DOM pool, but the column
  // header bounds resolve to null when scrolled off-screen, which
  // short-circuits showColumnFilter. Scroll it into view first.
  await page.evaluate(
    () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.ensureColumnVisible('tradeDate'),
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

test.describe('Cycle 7 / Task 4 — date-filter popup', () => {
  test('clicking the expand button opens the popup', async ({ page }) => {
    await gridReady(page);
    const expand = page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]');
    await expect(expand).toHaveCount(1);
    await expand.click();
    const popup = page.locator('.cg-filter-popup-date');
    await expect(popup).toHaveCount(1);
    const select = popup.locator('select');
    await expect(select).toHaveCount(1);
  });

  test('operator select carries the nine date-filter options', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]').click();
    const select = page.locator('.cg-filter-popup-date select');
    const values = await select.evaluate(
      (el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value),
    );
    expect(values).toEqual([
      'equals', 'notEqual',
      'lessThan', 'lessThanOrEqual',
      'greaterThan', 'greaterThanOrEqual',
      'inRange',
      'blank', 'notBlank',
    ]);
  });

  test('inRange reveals a second date input', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]').click();
    const popup = page.locator('.cg-filter-popup-date');
    await popup.locator('select').selectOption('inRange');
    await expect(popup.locator('input[data-cg-filter-input="primary"]')).toBeVisible();
    await expect(popup.locator('input[data-cg-filter-input="secondary"]')).toBeVisible();
  });

  test('notBlank + Apply reduces the displayed row count', async ({ page }) => {
    await gridReady(page);
    const before = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(before).toBeGreaterThan(10);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]').click();
    const popup = page.locator('.cg-filter-popup-date');
    await popup.locator('select').selectOption('notBlank');
    await popup.locator('button[data-cg-filter-action="apply"]').click();
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
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]').click();
    const popup = page.locator('.cg-filter-popup-date');
    await popup.locator('select').selectOption('notBlank');
    await popup.locator('button[data-cg-filter-action="apply"]').click();
    await waitForFrames(page);
    const reduced = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(reduced).toBeLessThan(original);
    // closeOnApply: true so re-open before clicking Reset.
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]').click();
    await page.locator('.cg-filter-popup-date button[data-cg-filter-action="reset"]').click();
    await waitForFrames(page);
    const restored = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(restored).toBe(original);
  });

  test('clicking outside the popup closes it', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="tradeDate"]').click();
    const popup = page.locator('.cg-filter-popup-date');
    await expect(popup).toHaveCount(1);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(popup).toHaveCount(0);
  });

  test('CGridApi.showColumnFilter / hideColumnFilter round-trip', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.showColumnFilter('tradeDate'),
    );
    await expect(page.locator('.cg-filter-popup-date')).toHaveCount(1);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.hideColumnFilter(),
    );
    await expect(page.locator('.cg-filter-popup-date')).toHaveCount(0);
  });
});
