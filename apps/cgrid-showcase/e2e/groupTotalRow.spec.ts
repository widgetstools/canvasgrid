import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('groupTotalRow feature', () => {
  test('loads with desk grouping', async ({ page }) => {
    await gotoFeature(page, 'groupTotalRow');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('groupIncludeFooter is active on the grid options', async ({ page }) => {
    await gotoFeature(page, 'groupTotalRow');

    const hasFooter: boolean = await page.evaluate(() => {
      const g = window.__cgrid as any;
      return g?.options?.groupIncludeFooter === true || g?.options?.groupTotalRow != null;
    });
    expect(hasFooter).toBe(true);
  });

  test('toggle button is rendered in controls', async ({ page }) => {
    await gotoFeature(page, 'groupTotalRow');

    const btn = page.locator('#controls button').first();
    await expect(btn).toBeVisible();
  });

  test('description bar mentions groupTotalRow', async ({ page }) => {
    await gotoFeature(page, 'groupTotalRow');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('groupTotalRow');
  });
});
