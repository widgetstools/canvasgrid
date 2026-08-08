import { test, expect } from '@playwright/test';
import {
  bootCustomizer,
  openCustomizer,
  saveCard,
  cockpit,
  closeViaDone,
} from './helpers/customizer';
import {
  harnessRow,
  readField,
  focusCell,
  pressGridKey,
  undoOnce,
  editSettings,
} from './helpers/editOps';

/**
 * Markets parity — Plus / Minus Customize panel + nudge execute path.
 * Checklist: stern-bak/apps/e2e/v2-plus-minus.spec.ts
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

test.describe('Plus / Minus (Markets parity)', () => {
  test('settings sheet opens; Save enables plusMinus', async ({ page }) => {
    // Markets: v2-plus-minus — settings sheet opens Plus / Minus panel
    await openCustomizer(page, 'plus-minus');
    await expect(page.locator('.cgext-sheet-title')).toHaveText('Plus / Minus');
    await expect(cockpit(page)).toContainText(/Enabled|Nudges/i);

    // Ensure Enabled is on via the first global switch, then Save.
    const enabledSwitch = cockpit(page).locator('.ckp-switch').first();
    await enabledSwitch.click();
    await saveCard(page);
    // Toggle back on if we flipped it off (defaults may already be true).
    const enabled = await editSettings<boolean>(page, 'plusMinus.enabled');
    if (!enabled) {
      await enabledSwitch.click();
      await saveCard(page);
    }
    await expect.poll(() => editSettings<boolean>(page, 'plusMinus.enabled')).toBe(true);
  });

  test('plus key nudges pnl by configured step; undo restores', async ({ page }) => {
    // Markets: v2-plus-minus — plus key nudges and undo restores
    await page.evaluate(() => {
      const edit = (window as unknown as {
        __edit: {
          updateSettings: (p: unknown) => void;
          setNudges: (n: unknown[]) => void;
        };
      }).__edit;
      edit.updateSettings({ plusMinus: { enabled: true, recordHistory: true } });
      edit.setNudges([{
        id: 'e2e-pnl',
        name: 'PnL ±1000',
        enabled: true,
        scope: { columnIds: ['pnl'] },
        incrementStep: 1000,
      }]);
    });

    const row = await harnessRow(page, 0);
    const before = Number(await readField(page, row.positionId, 'pnl'));
    await focusCell(page, row.positionId, 'pnl', 0);
    await pressGridKey(page, '+');

    await expect.poll(async () => Number(await readField(page, row.positionId, 'pnl'))).toBe(before + 1000);

    await undoOnce(page);
    await expect.poll(async () => Number(await readField(page, row.positionId, 'pnl'))).toBe(before);

    // Customize UI reflects the seeded nudge.
    await openCustomizer(page, 'plus-minus');
    await expect(cockpit(page)).toContainText('PnL ±1000');
    await closeViaDone(page);
  });

  test('minus key nudges pnl down by configured step', async ({ page }) => {
    // Markets: v2-plus-minus — minus key nudges down
    await page.evaluate(() => {
      const edit = (window as unknown as {
        __edit: {
          updateSettings: (p: unknown) => void;
          setNudges: (n: unknown[]) => void;
        };
      }).__edit;
      edit.updateSettings({ plusMinus: { enabled: true, recordHistory: true } });
      edit.setNudges([{
        id: 'e2e-pnl-minus',
        name: 'PnL ±500',
        enabled: true,
        scope: { columnIds: ['pnl'] },
        incrementStep: 500,
      }]);
    });

    const row = await harnessRow(page, 0);
    const before = Number(await readField(page, row.positionId, 'pnl'));
    await focusCell(page, row.positionId, 'pnl', 0);
    await pressGridKey(page, '-');
    await expect.poll(async () => Number(await readField(page, row.positionId, 'pnl'))).toBe(before - 500);
    await undoOnce(page);
    await expect.poll(async () => Number(await readField(page, row.positionId, 'pnl'))).toBe(before);
  });

  test('expression-gated nudge applies only when gate matches', async ({ page }) => {
    // Markets: v2-plus-minus — expression-gated nudge
    await page.evaluate(() => {
      const edit = (window as unknown as {
        __edit: {
          updateSettings: (p: unknown) => void;
          setNudges: (n: unknown[]) => void;
        };
      }).__edit;
      edit.updateSettings({ plusMinus: { enabled: true, recordHistory: true } });
      edit.setNudges([{
        id: 'e2e-credit-only',
        name: 'CREDIT desk ±100',
        enabled: true,
        scope: { columnIds: ['pnl'] },
        expression: '[desk] == "CREDIT"',
        incrementStep: 100,
      }]);
    });

    // HARNESS-0000 is CREDIT — should nudge.
    const credit = await harnessRow(page, 0);
    expect(await readField(page, credit.positionId, 'desk')).toBe('CREDIT');
    const creditBefore = Number(await readField(page, credit.positionId, 'pnl'));
    await focusCell(page, credit.positionId, 'pnl', 0);
    await pressGridKey(page, '+');
    await expect.poll(async () => Number(await readField(page, credit.positionId, 'pnl'))).toBe(creditBefore + 100);

    // HARNESS-0003 is RATES — gate false, value unchanged.
    const rates = await harnessRow(page, 3);
    expect(await readField(page, rates.positionId, 'desk')).toBe('RATES');
    const ratesBefore = Number(await readField(page, rates.positionId, 'pnl'));
    await focusCell(page, rates.positionId, 'pnl', 3);
    await pressGridKey(page, '+');
    await page.waitForTimeout(100);
    expect(Number(await readField(page, rates.positionId, 'pnl'))).toBe(ratesBefore);
  });
});
