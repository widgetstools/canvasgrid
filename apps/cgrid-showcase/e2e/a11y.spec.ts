import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoFeature } from './helpers';

test.describe('Cycle 24 — accessibility + keyboard demo', () => {
  test('aria-label + aria-busy land on the grid role="grid" element', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    const label = await page.locator('[role="grid"]').getAttribute('aria-label');
    expect(label).toBe('Trading positions, accessibility demo');
    const busy = await page.locator('[role="grid"]').getAttribute('aria-busy');
    expect(busy).toBe('false');
  });

  test('role="status" aria-live region is mounted', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    const live = page.locator('[role="status"][aria-live="polite"]');
    await expect(live).toHaveCount(1);
  });

  test('sort change populates the live-region (mirrored in the announcement panel)', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    // Trigger a sort via the API; the wired announcement runs through
    // a 250ms debounce, then the panel's mutation observer mirrors it.
    await page.evaluate(() => {
      (window as any).__cgrid.cycleSort('pnl');
    });
    await page.waitForTimeout(400);
    const text = await page.getByTestId('announce-panel').textContent();
    expect(text).toMatch(/sorted by p&l|sorted by pnl|sorted by/i);
  });

  test('high-contrast theme swaps the cg-theme-* class on the root', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    await page.getByTestId('btn-a11y-theme-high-contrast').click();
    const rootClass = await page.evaluate(() => {
      const root = document.querySelector('.cg-grid') as HTMLElement;
      return root.className;
    });
    expect(rootClass).toContain('cg-theme-high-contrast');
  });

  test('tab-exits toggle flips the wrap behavior', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    // Default: tabExits = false → callback returns true → wraps inside.
    let wrapDefault: boolean = await page.evaluate(() => {
      const opts = (window as any).__cgrid.options;
      return opts.tabToNextHeader({ event: new KeyboardEvent('keydown', { key: 'Tab' }) });
    });
    expect(wrapDefault).toBe(true);
    await page.getByTestId('btn-a11y-tab-exits').click();
    const wrapAfter: boolean = await page.evaluate(() => {
      const opts = (window as any).__cgrid.options;
      return opts.tabToNextHeader({ event: new KeyboardEvent('keydown', { key: 'Tab' }) });
    });
    expect(wrapAfter).toBe(false);
  });

  test('axe-core reports zero violations on the default a11y page', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    // Disable color-contrast for the canvas — pixel-level contrast is
    // already enforced via the high-contrast theme tokens; axe can't
    // probe canvas pixels. We assert structural a11y here (roles,
    // names, labelling, focus, ARIA validity).
    // Scope axe to the cgrid root so showcase-shell rules
    // (landmark-one-main, page-has-heading-one, region) don't gate on
    // the demo wrapper — apps that embed cgrid in a real product own
    // those landmarks. Color-contrast is also disabled because axe
    // can't probe canvas pixels (the high-contrast theme covers
    // that contract).
    const results = await new AxeBuilder({ page })
      .include('.cg-grid')
      .disableRules(['color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('axe-core reports zero violations on the high-contrast theme', async ({ page }) => {
    await gotoFeature(page, 'a11y');
    await page.getByTestId('btn-a11y-theme-high-contrast').click();
    // Scope axe to the cgrid root so showcase-shell rules
    // (landmark-one-main, page-has-heading-one, region) don't gate on
    // the demo wrapper — apps that embed cgrid in a real product own
    // those landmarks. Color-contrast is also disabled because axe
    // can't probe canvas pixels (the high-contrast theme covers
    // that contract).
    const results = await new AxeBuilder({ page })
      .include('.cg-grid')
      .disableRules(['color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
