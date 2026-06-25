/**
 * Cycle 7 / Task 6 — multi-condition filter popup.
 *
 * Exercises the `pnl` column (filter: 'number', filterParams:
 * { maxNumConditions: 2, defaultJoinOperator: 'AND' }) — pinned right
 * so it's always visible without scroll.
 *
 * Scenarios:
 * 1. Opening the popup mounts ONE condition row + the buttons row (the
 *    second row reveals once row 1 is filled).
 * 2. Filling condition 1 reveals condition 2 plus the AND/OR join radio.
 * 3. Switching the join radio to OR + filling condition 2 with a
 *    contradictory range (positive AND large-negative) and Apply
 *    yields a row count that is greater than what each single
 *    condition alone would return (verifies the OR semantics).
 * 4. Reset clears the model — visible row count returns to the
 *    original.
 * 5. Clicking outside the popup closes it.
 * 6. Programmatic setColumnFilterModel({ filterType: 'multi', ... })
 *    round-trips back through the popup (re-open shows two rows
 *    pre-filled).
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
  showColumnFilter: (colId: string) => void;
  hideColumnFilter: () => void;
  setColumnFilterModel: (colId: string, model: unknown) => Promise<void> | void;
  getColumnFilterModel: (colId: string) => unknown;
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

test.describe('Cycle 7 / Task 6 — multi-condition filter popup', () => {
  test('opening the pnl popup mounts one condition row + buttons (numAlwaysVisible=1)', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="pnl"]').click();
    const popup = page.locator('.cg-filter-popup-number');
    await expect(popup).toHaveCount(1);
    const conditionRows = popup.locator('.cg-filter-popup-condition');
    await expect(conditionRows).toHaveCount(1);
    // Join radio should NOT exist yet.
    await expect(popup.locator('input[data-cg-filter-join]')).toHaveCount(0);
  });

  test('filling condition 1 reveals condition 2 + AND/OR join radio', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="pnl"]').click();
    const popup = page.locator('.cg-filter-popup-number');
    // Pick greaterThan on slot 0; type a value to trigger reveal.
    const slot0 = popup.locator('[data-cg-multi-slot="0"]');
    await slot0.locator('select').selectOption('greaterThan');
    await slot0.locator('input[data-cg-filter-input="primary"]').fill('0');
    // The second condition row + join radio now mount.
    await expect(popup.locator('[data-cg-multi-slot="1"]')).toHaveCount(1);
    await expect(popup.locator('input[data-cg-filter-join]')).toHaveCount(2);
    const andRadio = popup.locator('input[data-cg-filter-join="AND"]');
    await expect(andRadio).toBeChecked();
  });

  test('OR + greaterThan 0 + lessThan -1000 yields more rows than either condition alone', async ({ page }) => {
    await gridReady(page);
    const original = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(original).toBeGreaterThan(10);

    // First, count rows for greaterThan 0 alone via setColumnFilterModel.
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setColumnFilterModel(
        'pnl',
        { filterType: 'number', type: 'greaterThan', filter: 0 },
      ),
    );
    await waitForFrames(page);
    const positiveOnly = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    // And count for lessThan -1000 alone.
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setColumnFilterModel(
        'pnl',
        { filterType: 'number', type: 'lessThan', filter: -1000 },
      ),
    );
    await waitForFrames(page);
    const negativeOnly = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    // Reset.
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setColumnFilterModel('pnl', null),
    );
    await waitForFrames(page);

    // Now drive the popup: OR + greaterThan 0 + lessThan -1000.
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="pnl"]').click();
    const popup = page.locator('.cg-filter-popup-number');
    const slot0 = popup.locator('[data-cg-multi-slot="0"]');
    await slot0.locator('select').selectOption('greaterThan');
    await slot0.locator('input[data-cg-filter-input="primary"]').fill('0');
    // Flip the join radio to OR.
    await popup.locator('input[data-cg-filter-join="OR"]').check();
    const slot1 = popup.locator('[data-cg-multi-slot="1"]');
    await slot1.locator('select').selectOption('lessThan');
    await slot1.locator('input[data-cg-filter-input="primary"]').fill('-1000');
    await popup.locator('button[data-cg-filter-action="apply"]').click();
    await waitForFrames(page);
    const orCount = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    // OR widens the result — must be ≥ either condition alone.
    expect(orCount).toBeGreaterThanOrEqual(positiveOnly);
    expect(orCount).toBeGreaterThanOrEqual(negativeOnly);
    expect(orCount).toBeLessThanOrEqual(original);
  });

  test('Reset clears the multi-condition model and restores the row count', async ({ page }) => {
    await gridReady(page);
    const original = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    // Apply via the popup.
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="pnl"]').click();
    const popup = page.locator('.cg-filter-popup-number');
    const slot0 = popup.locator('[data-cg-multi-slot="0"]');
    await slot0.locator('select').selectOption('greaterThan');
    await slot0.locator('input[data-cg-filter-input="primary"]').fill('1000');
    await popup.locator('button[data-cg-filter-action="apply"]').click();
    await waitForFrames(page);
    const filtered = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(filtered).toBeLessThan(original);
    // Re-open + Reset.
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="pnl"]').click();
    await page.locator('.cg-filter-popup-number button[data-cg-filter-action="reset"]').click();
    await waitForFrames(page);
    const restored = await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(restored).toBe(original);
  });

  test('clicking outside the popup closes it', async ({ page }) => {
    await gridReady(page);
    await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="pnl"]').click();
    const popup = page.locator('.cg-filter-popup-number');
    await expect(popup).toHaveCount(1);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(popup).toHaveCount(0);
  });

  test('CGridApi round-trip: setColumnFilterModel with multi shape re-opens with two filled rows', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setColumnFilterModel(
        'pnl',
        {
          filterType: 'multi',
          operator: 'OR',
          conditions: [
            { filterType: 'number', type: 'greaterThan', filter: 0 },
            { filterType: 'number', type: 'lessThan', filter: -1000 },
          ],
        },
      ),
    );
    await waitForFrames(page);
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.showColumnFilter('pnl'),
    );
    const popup = page.locator('.cg-filter-popup-number');
    await expect(popup).toHaveCount(1);
    // Both condition rows should be hydrated.
    const slot0Select = popup.locator('[data-cg-multi-slot="0"] select');
    const slot1Select = popup.locator('[data-cg-multi-slot="1"] select');
    await expect(slot0Select).toHaveValue('greaterThan');
    await expect(slot1Select).toHaveValue('lessThan');
    await expect(popup.locator('[data-cg-multi-slot="0"] input[data-cg-filter-input="primary"]'))
      .toHaveValue('0');
    await expect(popup.locator('[data-cg-multi-slot="1"] input[data-cg-filter-input="primary"]'))
      .toHaveValue('-1000');
    // Join radio reflects the saved OR.
    await expect(popup.locator('input[data-cg-filter-join="OR"]')).toBeChecked();
  });
});
