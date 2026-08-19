import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('suppressCount feature', () => {
  test('loads with suppressCount: true initially', async ({ page }) => {
    await gotoFeature(page, 'suppressCount');

    const suppressed: boolean = await page.evaluate(() => {
      return (window.__cgrid as any)?.options?.suppressCount === true;
    });
    expect(suppressed).toBe(true);
  });

  test('toggle button appears in controls', async ({ page }) => {
    await gotoFeature(page, 'suppressCount');

    const btn = page.locator('#controls button').first();
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Show Count Badge');
  });

  test('toggle changes suppressCount at runtime', async ({ page }) => {
    await gotoFeature(page, 'suppressCount');

    const btn = page.locator('#controls button').first();
    await btn.click();

    const suppressed: boolean = await page.evaluate(() => {
      return (window.__cgrid as any)?.options?.suppressCount === true;
    });
    expect(suppressed).toBe(false);

    await expect(btn).toHaveText('Suppress Count Badge');
  });

  test('desk grouping is active', async ({ page }) => {
    await gotoFeature(page, 'suppressCount');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });
});
