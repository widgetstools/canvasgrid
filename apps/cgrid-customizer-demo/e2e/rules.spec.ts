import { test, expect, type Page } from '@playwright/test';

/**
 * Grid Layouts — Phase C / Unit C4 E2E (conditional styling rules).
 *
 * Drives the demo's Rules control (real DOM chrome — Flag losses / Big rows /
 * Clear) and asserts through the live `window.__cgapi` (public rules API) +
 * `window.__cgrules` (the RuleEngine's read accessors — evaluateCell truthiness
 * + watchedColIds, which the canvas can't reveal). Each test starts from a
 * clean `persistState` slate so a prior test's rules can't leak.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

const ruleIds = (page: Page) =>
  page.evaluate(() => (window as any).__cgapi.getRules().map((r: any) => r.id));

/** evaluateCell truthiness through the live engine (rowId/colId/theme ctx). */
const matches = (page: Page, row: Record<string, unknown>, colId: string | null) =>
  page.evaluate(
    ([r, c]) => (window as any).__cgrules.evaluateCell({ row: r, rowId: 'e2e', colId: c, theme: 'dark' }).matched,
    [row, colId] as const,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('Flag losses adds a cell-target rule that matches negative P&L', async ({ page }) => {
  expect(await ruleIds(page)).toEqual([]);
  await expect(page.getByTestId('rule-count')).toHaveText('0 rules');

  await page.getByTestId('rule-loss').click();

  expect(await ruleIds(page)).toEqual(['loss']);
  await expect(page.getByTestId('rule-count')).toHaveText('1 rule');
  // Cell-target: matches a negative pnl cell, not a positive one, not a sibling column.
  expect(await matches(page, { pnl: -5 }, 'pnl')).toEqual(['loss']);
  expect(await matches(page, { pnl: 5 }, 'pnl')).toEqual([]);
  expect(await matches(page, { pnl: -5 }, 'notionalAmount')).toEqual([]);

  // Clicking again is idempotent (guarded on id) — still one rule.
  await page.getByTestId('rule-loss').click();
  expect(await ruleIds(page)).toEqual(['loss']);
});

test('Big rows adds a row-target rule that matches any column of a large position', async ({ page }) => {
  await page.getByTestId('rule-row').click();

  expect(await ruleIds(page)).toEqual(['big-row']);
  await expect(page.getByTestId('rule-count')).toHaveText('1 rule');
  // Row-target: a large notional matches on ANY column (row scope)…
  expect(await matches(page, { notionalAmount: 9_000_000 }, 'ticker')).toEqual(['big-row']);
  expect(await matches(page, { notionalAmount: 9_000_000 }, 'pnl')).toEqual(['big-row']);
  // …a small one matches nowhere.
  expect(await matches(page, { notionalAmount: 100 }, 'ticker')).toEqual([]);
});

test('Clear removes every conditional rule', async ({ page }) => {
  await page.getByTestId('rule-loss').click();
  await page.getByTestId('rule-row').click();
  await expect(page.getByTestId('rule-count')).toHaveText('2 rules');

  await page.getByTestId('rule-clear').click();
  expect(await ruleIds(page)).toEqual([]);
  await expect(page.getByTestId('rule-count')).toHaveText('0 rules');
});

test('rules ride in a saved layout and survive a switch away and back (per-layout rule sets)', async ({ page }) => {
  await page.getByTestId('rule-loss').click();
  expect(await ruleIds(page)).toEqual(['loss']);

  // Save the ruled view as a layout, then switch to Default (no rules) — the
  // layout-tier `rules` module must clear on switch…
  page.once('dialog', (d) => d.accept('Ruled'));
  await page.getByTestId('layout-save').click();
  await expect(page.getByTestId('layout-select')).toContainText('Ruled');

  await page.getByTestId('layout-select').selectOption({ label: 'Default' });
  expect(await ruleIds(page)).toEqual([]); // cleared on switch
  await expect(page.getByTestId('rule-count')).toHaveText('0 rules');

  // …and restore when switching back.
  await page.getByTestId('layout-select').selectOption({ label: 'Ruled' });
  expect(await ruleIds(page)).toEqual(['loss']);
  await expect(page.getByTestId('rule-count')).toHaveText('1 rule');
});

test('rules persist across a reload (autosave via rulesChanged)', async ({ page }) => {
  await page.getByTestId('rule-loss').click();
  expect(await ruleIds(page)).toEqual(['loss']);

  // rulesChanged dirties the persist bus → debounced autosave. Give it a beat,
  // then reload the SAME gridId; the rule must restore.
  await page.waitForTimeout(600);
  await page.reload();
  await waitForGridReady(page);

  expect(await ruleIds(page)).toEqual(['loss']);
  await expect(page.getByTestId('rule-count')).toHaveText('1 rule');
});
