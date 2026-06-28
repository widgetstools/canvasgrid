import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('stateRoundtrip feature', () => {
  test('loads with desk + ticker grouping', async ({ page }) => {
    await gotoFeature(page, 'stateRoundtrip');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk', 'ticker']);
  });

  test('Serialize button writes JSON to output', async ({ page }) => {
    await gotoFeature(page, 'stateRoundtrip');

    await page.locator('[data-testid="btn-serialize"]').click();

    const out = await page.locator('#json-out').textContent();
    expect(out).toContain('"rowGroupColumns"');
    expect(out).toContain('"desk"');
    expect(out).toContain('"ticker"');
  });

  test('Clear then Restore round-trips the grouping columns', async ({ page }) => {
    await gotoFeature(page, 'stateRoundtrip');

    // Serialize current state
    await page.locator('[data-testid="btn-serialize"]').click();

    // Clear groups
    await page.locator('[data-testid="btn-clear"]').click();

    const clearedCols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(clearedCols).toEqual([]);

    // Restore saved state
    await page.locator('[data-testid="btn-restore"]').click();

    const restoredCols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(restoredCols).toEqual(['desk', 'ticker']);
  });

  test('Restore is a no-op when nothing was serialized', async ({ page }) => {
    await gotoFeature(page, 'stateRoundtrip');

    await page.locator('[data-testid="btn-clear"]').click();
    // Restore without prior Serialize — savedCols is empty, nothing happens
    await page.locator('[data-testid="btn-restore"]').click();

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual([]);
  });
});
