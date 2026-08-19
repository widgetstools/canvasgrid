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

  test('behaviour: per-group footer rows are present — footers add rows beyond groups + leaves', async ({ page }) => {
    await gotoFeature(page, 'groupTotalRow');

    // 100 leaves + 4 desk group rows = 104 baseline. groupIncludeFooter
    // inserts one footer row per group, so the visible row count must
    // exceed the no-footer baseline (observed: 108 = 104 + 4 footers).
    const rowCount = await page.evaluate(() => (window.__cgrid as unknown as { rowCount: number }).rowCount ?? 0);
    expect(rowCount).toBeGreaterThan(104);
  });

  test('description bar mentions groupTotalRow', async ({ page }) => {
    await gotoFeature(page, 'groupTotalRow');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('groupTotalRow');
  });
});
