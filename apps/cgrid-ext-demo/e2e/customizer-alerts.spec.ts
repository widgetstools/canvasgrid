import { test, expect } from '@playwright/test';
import {
  bootCustomizer,
  openCustomizer,
  saveCard,
  cockpit,
  closeViaDone,
  typeInCm,
} from './helpers/customizer';

/**
 * Markets parity — Alerts Customize panel beyond smoke (kill-switch, mark-read).
 * Checklist: stern-bak/apps/e2e/v2-alerts.spec.ts
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

async function createPnlAlert(page: import('@playwright/test').Page, name: string): Promise<void> {
  await openCustomizer(page, 'alerts');
  await page.locator('.ckp-addbtn').click();
  await page.fill('.ckp .ckp-title', name);
  await typeInCm(page, '[pnl] != null');
  await saveCard(page);
  await closeViaDone(page);
}

async function firePnlEdit(page: import('@playwright/test').Page, value: number): Promise<void> {
  await page.evaluate(async (v) => {
    const w = window as unknown as {
      __edit: {
        smartEdit: {
          apply: (targets: unknown[], op: string, n: number) => Promise<{ applied: number }>;
        };
      };
      __paintHarness: { rows: Array<{ positionId: string; pnl: number }> };
    };
    const row = w.__paintHarness.rows[0]!;
    await w.__edit.smartEdit.apply([{
      rowId: row.positionId,
      colId: 'pnl',
      field: 'pnl',
      value: row.pnl,
      rowIndex: 0,
      rowData: row,
      cellDataType: 'number',
    }], 'set', v);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 80));
  }, value);
}

test.describe('Alerts (Markets parity)', () => {
  test('global settings band exposes frequency + channel toggles', async ({ page }) => {
    // Markets: v2-alerts — settings band exposes frequency + channels
    await openCustomizer(page, 'alerts');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Alerts');
    const globalHead = cockpit(page).locator('.ckp-global-head');
    await expect(globalHead).toBeVisible();
    // Expand if collapsed
    const body = cockpit(page).locator('.ckp-global-body');
    if (!(await body.isVisible().catch(() => false))) {
      await globalHead.click();
    }
    await expect(cockpit(page)).toContainText('Alerts enabled');
    await expect(cockpit(page)).toContainText(/Realtime|Throttled|Paused/i);
    await expect(cockpit(page)).toContainText(/toast|badge/i);
  });

  test('dataChange alert fires badge; mark read clears unread', async ({ page }) => {
    // Markets: v2-alerts — notification surfaces on badge + Mark read clears it
    await createPnlAlert(page, 'ParityAlert');
    await firePnlEdit(page, 88888);

    await expect(page.locator('[data-testid="vgext-alerts-badge"]')).toBeVisible();
    const unreadBefore = await page.evaluate(() =>
      (window as unknown as { __ext: { grid: { getAlertUnreadCount: () => number } } })
        .__ext.grid.getAlertUnreadCount());
    expect(unreadBefore).toBeGreaterThan(0);

    await page.evaluate(() => {
      (window as unknown as { __ext: { grid: { markAlertRead: () => void } } }).__ext.grid.markAlertRead();
    });
    await expect.poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __ext: { grid: { getAlertUnreadCount: () => number } } })
          .__ext.grid.getAlertUnreadCount()),
    ).toBe(0);
  });

  test('global kill-switch blocks new alert dispatches', async ({ page }) => {
    // Markets: v2-alerts — toggling settings.enabled off short-circuits dispatches
    await createPnlAlert(page, 'KillSwitchAlert');

    await openCustomizer(page, 'alerts');
    const globalHead = cockpit(page).locator('.ckp-global-head');
    if (!(await cockpit(page).locator('.ckp-global-body').isVisible().catch(() => false))) {
      await globalHead.click();
    }
    // First switch in global body = Alerts enabled (live apply)
    await cockpit(page).locator('.ckp-global-body .ckp-switch').first().click();
    await expect.poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __ext: { grid: { getAlertsSettings: () => { enabled: boolean } } } })
          .__ext.grid.getAlertsSettings().enabled),
    ).toBe(false);
    await closeViaDone(page);

    const historyBefore = await page.evaluate(() =>
      (window as unknown as { __ext: { grid: { getAlertHistory: () => unknown[] } } })
        .__ext.grid.getAlertHistory().length);

    await firePnlEdit(page, 77777);

    const after = await page.evaluate(() => {
      const g = (window as unknown as {
        __ext: {
          grid: {
            getAlertHistory: () => unknown[];
            getAlertUnreadCount: () => number;
          };
        };
      }).__ext.grid;
      return { history: g.getAlertHistory().length, unread: g.getAlertUnreadCount() };
    });
    expect(after.history).toBe(historyBefore);
    expect(after.unread).toBe(0);
  });
});
