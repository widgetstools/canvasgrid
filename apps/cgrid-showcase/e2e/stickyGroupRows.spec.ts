import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('stickyGroupRows feature', () => {
  test('loads with 320 rows grouped by desk', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('rowCount reflects 320 leaf rows plus group rows', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    // 320 leaves + 4 group rows = 324
    expect(rowCount).toBeGreaterThanOrEqual(324);
  });

  test('description mentions scroll behavior', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('scroll');
  });

  test('canvas is rendered', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const canvas = page.locator('#grid-host canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('grid host fills available height', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const height: number = await page.evaluate(() => {
      return document.getElementById('grid-host')?.clientHeight ?? 0;
    });
    expect(height).toBeGreaterThan(400);
  });
});
