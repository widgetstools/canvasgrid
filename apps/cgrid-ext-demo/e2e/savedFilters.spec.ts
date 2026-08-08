import { test, expect, type Page } from '@playwright/test';
import { bootCustomizer } from './helpers/customizer';

/**
 * Markets parity — saved filter pills (title-bar).
 * Checklist: stern-bak/apps/e2e/v2-filters-toolbar.spec.ts
 * Contract: docs/superpowers/specs/2026-08-07-saved-filter-pills-design.md
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
  await expect(page.locator('[data-testid="cgext-saved-filters"]')).toBeVisible();
});

function toolbar(page: Page) {
  return page.locator('[data-testid="cgext-saved-filters"]');
}

function pills(page: Page) {
  return toolbar(page).locator('.cgext-sf-pill');
}

function addBtn(page: Page) {
  return toolbar(page).locator('.cgext-sf-add');
}

function clearBtn(page: Page) {
  return toolbar(page).locator('.cgext-sf-clear');
}

async function setCurrencyFilter(page: Page, value: string): Promise<void> {
  await page.evaluate((v) => {
    (window as unknown as {
      __ext: { grid: { setFilterModel: (m: unknown) => void } };
    }).__ext.grid.setFilterModel({
      currency: { filterType: 'text', type: 'equals', filter: v },
    });
  }, value);
  await page.waitForTimeout(50);
}

async function getFilterModel(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    (window as unknown as { __ext: { grid: { getFilterModel: () => Record<string, unknown> } } })
      .__ext.grid.getFilterModel() ?? {});
}

test.describe('Saved filters (Markets parity)', () => {
  test('shows empty toolbar with + disabled until a live filter exists', async ({ page }) => {
    // Markets: v2-filters-toolbar — shows empty toolbar with only + button
    await expect(pills(page)).toHaveCount(0);
    await expect(addBtn(page)).toBeDisabled();
  });

  test('capture, toggle off/on, and clear all', async ({ page }) => {
    // Markets: v2-filters-toolbar — toggle off/on + clear all
    await setCurrencyFilter(page, 'USD');
    await expect(addBtn(page)).toBeEnabled({ timeout: 5_000 });
    await addBtn(page).click();
    await expect(pills(page)).toHaveCount(1);
    await expect(pills(page).first()).toHaveClass(/is-active/);

    const modelAfterCapture = await getFilterModel(page);
    expect(modelAfterCapture.currency).toBeTruthy();

    await pills(page).first().click();
    await expect(pills(page).first()).not.toHaveClass(/is-active/);
    await expect.poll(async () => Object.keys(await getFilterModel(page)).length).toBe(0);

    await pills(page).first().click();
    await expect(pills(page).first()).toHaveClass(/is-active/);
    await expect.poll(async () => Object.keys(await getFilterModel(page)).length).toBeGreaterThan(0);

    await clearBtn(page).click();
    await expect(pills(page).first()).not.toHaveClass(/is-active/);
    await expect.poll(async () => Object.keys(await getFilterModel(page)).length).toBe(0);
  });

  test('rename updates label; delete removes pill', async ({ page }) => {
    // Markets: v2-filters-toolbar — rename + remove
    await setCurrencyFilter(page, 'EUR');
    await expect(addBtn(page)).toBeEnabled({ timeout: 5_000 });
    await addBtn(page).click();
    await expect(pills(page)).toHaveCount(1);

    const pill = pills(page).first();
    await pill.hover();
    await pill.locator('.cgext-sf-act[title="Rename"]').click();
    const input = page.locator('.cgext-sf-rename-input');
    await expect(input).toBeVisible();
    await input.fill('USD only');
    await page.locator('.cgext-sf-pop-save').click();
    await expect(pill.locator('.cgext-sf-label')).toHaveText('USD only');

    await pill.hover();
    await pill.locator('.cgext-sf-act[title="Delete"]').click();
    await expect(pills(page)).toHaveCount(0);
  });

  test('+ stays disabled when live filter matches an inactive pill', async ({ page }) => {
    // Markets: v2-filters-toolbar — no duplicates when inactive pill matches
    await setCurrencyFilter(page, 'GBP');
    await addBtn(page).click();
    await expect(pills(page)).toHaveCount(1);

    await pills(page).first().click(); // deactivate (clears grid filter)
    await expect(addBtn(page)).toBeDisabled();

    await setCurrencyFilter(page, 'GBP'); // same shape as inactive pill
    await expect(addBtn(page)).toBeDisabled();
  });

  test('two active pills compose with AND across columns', async ({ page }) => {
    // Markets: v2-filters-toolbar — multiple filters compose with AND
    await setCurrencyFilter(page, 'EUR');
    await addBtn(page).click();
    await expect(pills(page)).toHaveCount(1);

    // Deactivate first so live model is empty, then capture desk-only pill.
    await pills(page).first().click();
    await page.evaluate(() => {
      (window as unknown as { __ext: { grid: { setFilterModel: (m: unknown) => void } } })
        .__ext.grid.setFilterModel({
          desk: { filterType: 'text', type: 'equals', filter: 'CREDIT' },
        });
    });
    await page.waitForTimeout(50);
    await expect(addBtn(page)).toBeEnabled({ timeout: 5_000 });
    await addBtn(page).click();
    await expect(pills(page)).toHaveCount(2);

    // Activate currency pill too (desk pill is already active from capture).
    const currencyPill = pills(page).filter({ hasText: /currency/i }).first();
    await currencyPill.click();
    await expect(currencyPill).toHaveClass(/is-active/);
    await expect(pills(page).nth(1)).toHaveClass(/is-active/);

    await expect.poll(async () => {
      const m = await getFilterModel(page);
      return Boolean(m.currency && m.desk);
    }).toBe(true);
  });

  test('pills persist across reload after layout update', async ({ page }) => {
    // Markets: v2-filters-toolbar — persistence (canvasgrid: layout-tier + disk)
    await setCurrencyFilter(page, 'JPY');
    await addBtn(page).click();
    await expect(pills(page)).toHaveCount(1);
    const label = await pills(page).first().locator('.cgext-sf-label').innerText();

    // Layout-tier modules land in the active layout via updateLayout (disk),
    // then ride persistState's debounced autosave into localStorage.
    await page.evaluate(() => {
      (window as unknown as { __ext: { grid: { updateLayout: () => void } } }).__ext.grid.updateLayout();
    });
    await page.waitForFunction(() => {
      const v = localStorage.getItem('cgrid:state:ext-demo') ?? '';
      return v.includes('saved-filters') && v.includes('JPY');
    }, null, { timeout: 10_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __ext?: { grid?: unknown } }).__ext?.grid, null, {
      timeout: 30_000,
    });
    await expect(toolbar(page)).toBeVisible();
    await expect.poll(async () => pills(page).count(), { timeout: 15_000 }).toBe(1);
    await expect(pills(page).first().locator('.cgext-sf-label')).toHaveText(label);
  });
});
