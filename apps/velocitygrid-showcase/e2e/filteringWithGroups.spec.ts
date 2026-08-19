import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('filteringWithGroups feature', () => {
  test('loads with desk grouping', async ({ page }) => {
    await gotoFeature(page, 'filteringWithGroups');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('quick filter input is visible', async ({ page }) => {
    await gotoFeature(page, 'filteringWithGroups');

    const input = page.locator('[data-testid="quick-filter-input"]');
    await expect(input).toBeVisible();
  });

  test('typing a filter term reduces visible row count', async ({ page }) => {
    await gotoFeature(page, 'filteringWithGroups');

    const initialCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);

    // Filter to just AAPL rows (only 1/5 of leaves)
    await page.locator('[data-testid="quick-filter-input"]').fill('AAPL');

    // Wait for filter to settle — rowCount updates asynchronously
    await page.waitForFunction(
      (initial) => ((window.__cgrid as any)?.rowCount ?? initial) < initial,
      initialCount,
      { timeout: 5_000 },
    );

    const filteredCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(filteredCount).toBeLessThan(initialCount);
  });

  test('clearing filter restores original row count', async ({ page }) => {
    await gotoFeature(page, 'filteringWithGroups');

    const initialCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);

    await page.locator('[data-testid="quick-filter-input"]').fill('AAPL');
    await page.waitForFunction(
      (initial) => ((window.__cgrid as any)?.rowCount ?? initial) < initial,
      initialCount,
      { timeout: 5_000 },
    );

    await page.locator('#controls button').click(); // Clear button
    await page.waitForFunction(
      (initial) => ((window.__cgrid as any)?.rowCount ?? 0) === initial,
      initialCount,
      { timeout: 5_000 },
    );

    const restoredCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(restoredCount).toBe(initialCount);
  });

  test('filter that matches nothing collapses all groups', async ({ page }) => {
    await gotoFeature(page, 'filteringWithGroups');

    await page.locator('[data-testid="quick-filter-input"]').fill('ZZZNOMATCH');

    await page.waitForFunction(
      () => ((window.__cgrid as any)?.rowCount ?? 1) === 0,
      { timeout: 5_000 },
    );

    const count: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? -1);
    expect(count).toBe(0);
  });
});
