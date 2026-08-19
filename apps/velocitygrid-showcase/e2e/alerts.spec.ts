import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21e / Task 16 — Alerts feature. The alert log is real DOM
// (the host-side channel surface), so these specs assert DOM directly.

const logEntries = (ruleId?: string): string =>
  ruleId
    ? `[data-testid="alert-log"] .alert-entry[data-rule-id="${ruleId}"]`
    : '[data-testid="alert-log"] .alert-entry';

test.describe('alerts (rules)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'alerts');
  });

  test('a tick produces a warning log entry with severity chip + templated message', async ({ page }) => {
    await page.getByTestId('btn-al-tick-once').click();
    const entry = page.locator(logEntries('price-move')).first();
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('data-severity', 'warning');
    await expect(entry).toContainText('WARNING');
    await expect(entry).toContainText('Price move ≥ 1%: AAPL price');
  });

  test('a burst of rapid ticks is debounced to a single entry per (rule, row)', async ({ page }) => {
    await page.getByTestId('btn-al-burst').click();
    // First MSFT move alerts immediately; the other four fall inside
    // the 1.5s debounce window for (price-move, MSFT).
    await expect(page.locator(logEntries('price-move'))).toHaveCount(1);
    await page.waitForTimeout(500); // debounce window still open
    await expect(page.locator(logEntries('price-move'))).toHaveCount(1);
  });

  test('paused evaluation mode stops new entries', async ({ page }) => {
    await page.getByTestId('sel-alert-mode').selectOption('paused');
    await page.getByTestId('btn-al-tick-once').click();
    await page.waitForTimeout(500);
    await expect(page.locator(logEntries())).toHaveCount(0);
    // Back to realtime — alerts flow again.
    await page.getByTestId('sel-alert-mode').selectOption('realtime');
    await page.getByTestId('btn-al-tick-once').click();
    await expect(page.locator(logEntries('price-move'))).toHaveCount(1);
  });

  test('adding a row fires the rowChange info alert', async ({ page }) => {
    await page.getByTestId('btn-al-add').click();
    const entry = page.locator(logEntries('row-added')).first();
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('data-severity', 'info');
    await expect(entry).toContainText('POS1 joined the blotter');
  });

  test('unread badge counts alerts and clears on mark-all-read', async ({ page }) => {
    await expect(page.getByTestId('alert-unread')).toHaveText('Unread: 0');
    await page.getByTestId('btn-al-tick-once').click();
    await expect(page.getByTestId('alert-unread')).toHaveText('Unread: 1');
    await page.getByTestId('btn-alert-read').click();
    await expect(page.getByTestId('alert-unread')).toHaveText('Unread: 0');
  });
});
