import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('hideOpenParents feature', () => {
  test('loads with 2-level grouping active', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk', 'ticker']);
  });

  test('sidebar nav shows hideOpenParents as active', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    const active = await page.locator('.feature-item.active').textContent();
    expect(active).toBe('Hide Open Parents');
  });

  test('description bar mentions groupHideOpenParents', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('groupHideOpenParents');
  });

  test('row group panel is visible', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    // row group panel renders as .cg-row-group-panel
    const panel = page.locator('.cg-row-group-panel');
    await expect(panel).toBeVisible();
  });

  test('canvas renders — grid-host has a canvas child', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    const canvas = page.locator('#grid-host canvas').first();
    await expect(canvas).toBeVisible();
  });
});
