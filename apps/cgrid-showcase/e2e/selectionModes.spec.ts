import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('Selection Modes feature', () => {
  test('mounts with multi-row mode active by default', async ({ page }) => {
    await gotoFeature(page, 'selectionModes');
    await expect(page.getByTestId('btn-selection-multiRow')).toHaveClass(/primary/);
    const mode: string = await page.evaluate(() => (window as any).__cgrid.selection.getMode());
    expect(mode).toBe('multiple');
  });

  test('single-row pill switches the selection mode to "single"', async ({ page }) => {
    await gotoFeature(page, 'selectionModes');
    await page.getByTestId('btn-selection-singleRow').click();
    await page.waitForTimeout(200);
    const mode: string = await page.evaluate(() => (window as any).__cgrid.selection.getMode());
    expect(mode).toBe('single');
  });

  test('checkbox-only pill auto-injects the pinned checkbox column AND sets suppressRowClickSelection', async ({ page }) => {
    await gotoFeature(page, 'selectionModes');
    await page.getByTestId('btn-selection-checkboxOnly').click();
    await page.waitForTimeout(200);
    const state: any = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return {
        hasCheckboxCol: g.columnDefsMap.has('__cg_select__'),
        suppressed: g.options.suppressRowClickSelection,
        mode: g.selection.getMode(),
      };
    });
    expect(state.hasCheckboxCol).toBe(true);
    expect(state.suppressed).toBe(true);
    expect(state.mode).toBe('multiple');
  });

  test('cell-range pill sets selection mode to "none"', async ({ page }) => {
    await gotoFeature(page, 'selectionModes');
    await page.getByTestId('btn-selection-cell').click();
    await page.waitForTimeout(200);
    const mode: string = await page.evaluate(() => (window as any).__cgrid.selection.getMode());
    expect(mode).toBe('none');
  });
});
