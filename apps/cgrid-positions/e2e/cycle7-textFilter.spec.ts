/**
 * Cycle 7 / Task 5 — text-filter popup.
 *
 * Verifies that:
 * 1. Clicking the floating-filter expand button on `cusip` mounts the
 *    text popup.
 * 2. The operator <select> exposes the full 8-op text-filter surface.
 * 3. The caseSensitive checkbox renders by default.
 * 4. Applying `startsWith` + a literal that no CUSIP matches reduces
 *    the displayed row count.
 * 5. Re-opening the popup and clicking Reset restores the original
 *    row count.
 * 6. Clicking outside the popup closes it.
 * 7. The `CGridApi.showColumnFilter` / `hideColumnFilter` round-trip
 *    drives the text popup the same way it drives the number / date
 *    popups.
 *
 * `cusip` is pinned-left in the demo so it's always visible regardless
 * of horizontal scroll — no `ensureColumnVisible` dance needed before
 * the expand button is clickable.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
  showColumnFilter: (colId: string) => void;
  hideColumnFilter: () => void;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 45_000 },
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

test.describe('Cycle 7 / Task 5 — text-filter popup', () => {
  test('clicking the expand button opens the popup', async ({ page }) => {
    await gridReady(page);
    const expand = page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]');
    await expect(expand).toHaveCount(1);
    await expand.click();
    const popup = page.locator('.cg-filter-popup-text');
    await expect(popup).toHaveCount(1);
    const select = popup.locator('select');
    await expect(select).toHaveCount(1);
  });

  test('operator select carries the eight text-filter options', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]').click();
    const select = page.locator('.cg-filter-popup-text select');
    const values = await select.evaluate(
      (el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value),
    );
    expect(values).toEqual([
      'contains', 'notContains',
      'equals', 'notEqual',
      'startsWith', 'endsWith',
      'blank', 'notBlank',
    ]);
  });

  test('caseSensitive checkbox renders by default', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]').click();
    const cb = page.locator('.cg-filter-popup-text input[data-cg-filter-case-sensitive]');
    await expect(cb).toHaveCount(1);
  });

  test('startsWith + literal-no-match + Apply reduces the displayed row count', async ({ page }) => {
    await gridReady(page);
    const before = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(before).toBeGreaterThan(10);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]').click();
    const popup = page.locator('.cg-filter-popup-text');
    await popup.locator('select').selectOption('startsWith');
    // 'ZZZZZZ' is a six-letter prefix that no CUSIP issuer code starts
    // with — the filter reduces the visible set to 0 rows deterministically
    // regardless of which subset of issuers the STOMP snapshot included.
    await popup.locator('input[data-cg-filter-input="primary"]').fill('ZZZZZZ');
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
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]').click();
    const popup = page.locator('.cg-filter-popup-text');
    await popup.locator('select').selectOption('startsWith');
    await popup.locator('input[data-cg-filter-input="primary"]').fill('ZZZZZZ');
    await popup.locator('button[data-cg-filter-action="apply"]').click();
    await waitForFrames(page);
    const reduced = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(reduced).toBeLessThan(original);
    // closeOnApply: true so re-open before clicking Reset.
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]').click();
    await page.locator('.cg-filter-popup-text button[data-cg-filter-action="reset"]').click();
    await waitForFrames(page);
    const restored = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(restored).toBe(original);
  });

  test('clicking outside the popup closes it', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="cusip"]').click();
    const popup = page.locator('.cg-filter-popup-text');
    await expect(popup).toHaveCount(1);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(popup).toHaveCount(0);
  });

  test('CGridApi.showColumnFilter / hideColumnFilter round-trip', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.showColumnFilter('cusip'),
    );
    await expect(page.locator('.cg-filter-popup-text')).toHaveCount(1);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.hideColumnFilter(),
    );
    await expect(page.locator('.cg-filter-popup-text')).toHaveCount(0);
  });
});
