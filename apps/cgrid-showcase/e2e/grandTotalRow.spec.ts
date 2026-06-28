import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('grandTotalRow feature', () => {
  test('loads with desk grouping', async ({ page }) => {
    await gotoFeature(page, 'grandTotalRow');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('grandTotalRow is active on the grid options', async ({ page }) => {
    await gotoFeature(page, 'grandTotalRow');

    const active: boolean = await page.evaluate(() => {
      const g = window.__cgrid as any;
      return g?.options?.grandTotalRow != null;
    });
    expect(active).toBe(true);
  });

  test('footer rows are present — grand total + per-group footers add rows beyond groups + leaves', async ({ page }) => {
    await gotoFeature(page, 'grandTotalRow');

    // 100 leaves + 4 desk group rows = 104 baseline. groupIncludeFooter adds
    // one footer per group and grandTotalRow adds one at the very bottom, so
    // the visible row count must exceed the no-footer baseline.
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBeGreaterThan(104);
  });

  test('toggle button is rendered in controls', async ({ page }) => {
    await gotoFeature(page, 'grandTotalRow');

    const btn = page.locator('#controls button').first();
    await expect(btn).toBeVisible();
  });

  test('description bar mentions grandTotalRow', async ({ page }) => {
    await gotoFeature(page, 'grandTotalRow');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('grandTotalRow');
  });
});
