import { test, expect } from '@playwright/test';
import { bootCustomizer, gridOption, openCustomizer } from './helpers/customizer';

// Wave-0 completion gate: boots the paint harness, opens the settings
// sheet via the overflow Settings control, changes Row Height through the
// Grid Options module, and asserts the kernel reflects it end-to-end.
test('spine: shell renders, settings sheet opens, row height applies', async ({ page }) => {
  await bootCustomizer(page);

  await page.locator('[data-item-id="overflow"] button').click();
  await expect(page.locator('.cgext-sheet')).toBeVisible();
  await expect(page.locator('.cgext-sheet [data-field-key="rowHeight"]')).toBeVisible();

  const input = page.locator('.cgext-sheet [data-field-key="rowHeight"] input.cg-settings-input-number');
  await input.fill('40');
  await input.blur();

  await expect.poll(() => gridOption<number>(page, 'rowHeight')).toBe(40);

  // Profile / layout dirty — save control becomes actionable when present.
  const layoutSave = page.locator('[data-item-id="layout-save"] button');
  if (await layoutSave.count()) {
    await expect(layoutSave).toBeEnabled();
  }
});

// Overflow-menu theme toggle: flips the `-dark` suffix of the active theme
// family on BOTH the kernel's themed element and the shell root (which
// mirrors the class so the chrome's `--cg-*` tokens track the grid). The
// menu stays open across the toggle and the checkmark repaints.
test('overflow menu: dark-theme toggle flips theme on shell and kernel', async ({ page }) => {
  // Theme toggle lives on the "More" (settings-launcher) menu, not overflow.
  await page.goto('/?paintHarness');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__ext?.grid, null, { timeout: 30_000 });

  const themes = () =>
    page.evaluate(() => ({
      root: Array.from(document.querySelector('.cgext-root')!.classList).filter((c) => c.startsWith('cg-theme-')),
      grid: Array.from(document.querySelector('.cgext-grid [class*="cg-theme-"]')!.classList).filter((c) => c.startsWith('cg-theme-')),
    }));

  expect(await themes()).toEqual({ root: ['cg-theme-quartz-dark'], grid: ['cg-theme-quartz-dark'] });

  await page.locator('[data-item-id="settings-launcher"] button').click();
  const item = page.locator('.cgext-menu-item', { hasText: 'Dark theme' });
  await expect(item).toHaveClass(/is-active/);

  await item.click();
  expect(await themes()).toEqual({ root: ['cg-theme-quartz'], grid: ['cg-theme-quartz'] });
  await expect(item).not.toHaveClass(/is-active/);
  await expect(page.locator('.cgext-menu')).toBeVisible();

  await item.click();
  expect(await themes()).toEqual({ root: ['cg-theme-quartz-dark'], grid: ['cg-theme-quartz-dark'] });
  await expect(item).toHaveClass(/is-active/);
});

// Keep helper import used (boot path shared with customizer suite).
void openCustomizer;
void bootCustomizer;
