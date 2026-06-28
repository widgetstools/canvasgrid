import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('groupSelects feature', () => {
  test('loads with desk grouping', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('rowSelection is multiple', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const mode: string = await page.evaluate(() => {
      return (window.__cgrid as any)?.options?.rowSelection ?? '';
    });
    expect(mode).toBe('multiple');
  });

  test('groupSelectsChildren is enabled', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const enabled: boolean = await page.evaluate(() => {
      const g = window.__cgrid as any;
      return g?.options?.groupSelectsChildren === true || g?.options?.groupSelects === 'descendants';
    });
    expect(enabled).toBe(true);
  });

  test('description mentions cascade selection', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('cascade');
  });
});
