import { test, expect, type Page } from '@playwright/test';

/**
 * Cycle 21i Phase 2 / T6+T7 — Smart Edit (#09) + Bulk Update (#10)
 * Lit settings panels, end-to-end:
 *
 *   side-bar tab → Lit panel (shadow DOM) → immediate-apply write into
 *   the @cgrid/edit engine → engine-owned `editSettings` state module →
 *   kernel autosave → reload → engine + panel restored.
 *
 * Playwright locators pierce shadow DOM, so panel assertions read the
 * same way as light-DOM ones.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

async function persistedEditSettings(page: Page): Promise<any> {
  return page.evaluate((key) => {
    const snap = JSON.parse(localStorage.getItem(key) ?? 'null');
    return snap?.modules?.editSettings?.data ?? null;
  }, STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('Smart Edit panel renders the doc bands and toggles an op through to the engine', async ({ page }) => {
  await page.getByRole('button', { name: 'Smart Edit' }).click();
  await expect(page.getByText('Global', { exact: true })).toBeVisible();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await expect(page.getByText('Safety', { exact: true })).toBeVisible();

  const divide = page.getByRole('button', { name: 'Divide' });
  await expect(divide).toHaveAttribute('aria-pressed', 'true');
  await divide.click();
  await expect(divide).toHaveAttribute('aria-pressed', 'false');

  // Engine-owned persistence: the slice lands in the kernel snapshot.
  await expect.poll(async () => {
    const data = await persistedEditSettings(page);
    return data?.smartEdit?.enabledOps ?? null;
  }, { timeout: 5_000 }).toEqual(['multiply', 'add', 'subtract', 'set']);
});

test('Smart Edit change survives a reload (engine + panel restored)', async ({ page }) => {
  await page.getByRole('button', { name: 'Smart Edit' }).click();
  await page.getByRole('button', { name: 'Divide' }).click();
  await expect.poll(async () => (await persistedEditSettings(page))?.smartEdit?.enabledOps?.length ?? 0, {
    timeout: 5_000,
  }).toBe(4);

  await page.reload();
  await waitForGridReady(page);
  // The persisted sideBar state may reopen the panel; only click the tab
  // if the panel body isn't already showing.
  if (!(await page.getByRole('button', { name: 'Divide' }).isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Smart Edit' }).click();
  }
  await expect(page.getByRole('button', { name: 'Divide' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Multiply' })).toHaveAttribute('aria-pressed', 'true');
});

test('Bulk Update panel writes and persists its dropdown settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Bulk Update' }).click();
  await expect(page.getByText('Dropdown', { exact: true })).toBeVisible();

  const max = page.getByRole('spinbutton', { name: 'Max dropdown' });
  await expect(max).toHaveValue('20');
  await max.fill('50');
  await max.blur();

  await expect.poll(async () => (await persistedEditSettings(page))?.bulkUpdate?.maxDropdownValues ?? null, {
    timeout: 5_000,
  }).toBe(50);

  await page.reload();
  await waitForGridReady(page);
  if (!(await page.getByRole('spinbutton', { name: 'Max dropdown' }).isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Bulk Update' }).click();
  }
  await expect(page.getByRole('spinbutton', { name: 'Max dropdown' })).toHaveValue('50');
});
