import { test, expect } from '@playwright/test';

// Wave-0 completion gate: boots the demo (no STOMP feed — grid is empty,
// shell + canvas must still render), opens the settings sheet via the
// launcher, changes Row Height through the Grid Options module, and
// asserts the kernel reflects it end-to-end.
//
// The @cgrid/customizer chrome (cgc-field, cgc-number, cgc-switch) renders
// its label text into shadow DOM, so assertions target the light-DOM
// control (`[data-opt="rowHeight"]`) rather than text content, and apply
// the change by dispatching the `cgc-change` custom event the control
// would normally emit — see gridOptions.ts's delegated `cgc-change`
// listener on the module host.
test('spine: shell renders, settings sheet opens, row height applies', async ({ page }) => {
  await page.goto('/');

  // Shell chrome is present, with no STOMP feed running.
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  await expect(page.locator('.cgext-grid canvas')).toBeVisible();

  // Open settings via the launcher.
  await page.locator('[data-item-id="settings-launcher"] button').click();
  await expect(page.locator('.cgext-sheet')).toBeVisible();
  await expect(page.locator('.cgext-sheet [data-opt="rowHeight"]')).toBeVisible();

  // Change row height to 40 via the module's delegated cgc-change listener.
  await page.evaluate(() => {
    const el = document.querySelector('.cgext-sheet [data-opt="rowHeight"]')!;
    el.dispatchEvent(new CustomEvent('cgc-change', { detail: { value: 40 }, bubbles: true }));
  });

  // Read the applied value back through the kernel's public option getter.
  const applied = await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'));
  expect(applied).toBe(40);

  // The layout-save disk becomes enabled (rowHeight is a 'ui'-source state
  // change, so the active layout is now dirty).
  await expect(page.locator('[data-item-id="layout-save"] button')).toBeEnabled();
});

// Overflow-menu theme toggle: flips the `-dark` suffix of the active theme
// family on BOTH the kernel's themed element and the shell root (which
// mirrors the class so the chrome's `--cg-*` tokens track the grid). The
// menu stays open across the toggle and the checkmark repaints.
test('overflow menu: dark-theme toggle flips theme on shell and kernel', async ({ page }) => {
  await page.goto('/');

  const themes = () =>
    page.evaluate(() => ({
      root: Array.from(document.querySelector('.cgext-root')!.classList).filter((c) => c.startsWith('cg-theme-')),
      grid: Array.from(document.querySelector('.cgext-grid [class*="cg-theme-"]')!.classList).filter((c) => c.startsWith('cg-theme-')),
    }));

  expect(await themes()).toEqual({ root: ['cg-theme-cursor-dark'], grid: ['cg-theme-cursor-dark'] });

  await page.locator('[data-item-id="overflow"] button').click();
  const item = page.locator('.cgext-menu-item', { hasText: 'Dark theme' });
  await expect(item).toHaveClass(/is-active/);

  // Dark → light. Same theme family, `-dark` suffix dropped everywhere.
  await item.click();
  expect(await themes()).toEqual({ root: ['cg-theme-cursor'], grid: ['cg-theme-cursor'] });
  await expect(item).not.toHaveClass(/is-active/);
  await expect(page.locator('.cgext-menu')).toBeVisible();

  // Light → dark. Round-trips back to the original classes.
  await item.click();
  expect(await themes()).toEqual({ root: ['cg-theme-cursor-dark'], grid: ['cg-theme-cursor-dark'] });
  await expect(item).toHaveClass(/is-active/);
});
