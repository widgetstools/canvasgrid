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

    // row group panel renders as .vg-row-group-panel
    const panel = page.locator('.vg-row-group-panel');
    await expect(panel).toBeVisible();
  });

  test('behaviour: expanded parents are hidden — row 0 is a leaf and zero group rows are visible', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    // Groups expand by default; with groupHideOpenParents the expanded
    // parent group rows are dropped from the flat order and the leaves
    // surface inline. So the first visible row is a leaf (data) row and NO
    // group rows appear in the visible set. If the flag were broken, row 0
    // would be the 'desk' group row and groupRows would be > 0.
    const result = await page.evaluate(() => {
      const g = window.__cgrid as unknown as {
        rowCount: number;
        isGroupRow(i: number): boolean;
      };
      const n = g.rowCount ?? 0;
      let groupRows = 0;
      for (let i = 0; i < n; i++) if (g.isGroupRow(i)) groupRows++;
      return { n, firstIsGroup: g.isGroupRow(0), groupRows };
    });
    expect(result.n).toBeGreaterThan(0);
    expect(result.firstIsGroup).toBe(false);
    expect(result.groupRows).toBe(0);
  });

  test('canvas renders — grid-host has a canvas child', async ({ page }) => {
    await gotoFeature(page, 'hideOpenParents');

    const canvas = page.locator('#grid-host canvas').first();
    await expect(canvas).toBeVisible();
  });
});
