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
 * Markets parity — Shortcuts Customize panel + letter-key execute path.
 * Checklist: stern-bak/apps/e2e/v2-shortcuts.spec.ts
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

test.describe('Shortcuts (Markets parity)', () => {
  test('Add + Save registers a letter binding', async ({ page }) => {
    // Markets: v2-shortcuts — settings sheet opens Shortcuts panel
    await openCustomizer(page, 'shortcuts');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Shortcuts');
    await page.locator('.ckp-addbtn').click();
    await saveCard(page);
    await expect.poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __edit: { getShortcuts: () => unknown[] } }).__edit.getShortcuts().length),
    ).toBeGreaterThan(0);
  });

  test('H key multiplies pnl by 100; undo restores', async ({ page }) => {
    // Markets: v2-shortcuts — letter key applies op and undo restores
    await page.evaluate(() => {
      const edit = (window as unknown as {
        __edit: {
          updateSettings: (p: unknown) => void;
          setShortcuts: (s: unknown[]) => void;
        };
      }).__edit;
      edit.updateSettings({ shortcuts: { enabled: true, recordHistory: true } });
      edit.setShortcuts([{
        id: 'e2e-h',
        name: 'H ×100',
        enabled: true,
        shortcutKey: 'h',
        operation: 'multiply',
        shortcutValue: 100,
        scope: { columnIds: ['pnl'] },
      }]);
    });

    const row = await harnessRow(page, 0);
    const before = Number(await readField(page, row.positionId, 'pnl'));
    await focusCell(page, row.positionId, 'pnl', 0);
    await pressGridKey(page, 'h');

    await expect.poll(async () => Number(await readField(page, row.positionId, 'pnl'))).toBe(before * 100);
    await undoOnce(page);
    await expect.poll(async () => Number(await readField(page, row.positionId, 'pnl'))).toBe(before);

    await openCustomizer(page, 'shortcuts');
    await expect(cockpit(page)).toContainText(/H|×100|100/i);
    await closeViaDone(page);
  });

  test('disabled module ignores letter keys', async ({ page }) => {
    // Markets: v2-shortcuts — disabled module ignores letter keys
    await page.evaluate(() => {
      const edit = (window as unknown as {
        __edit: {
          updateSettings: (p: unknown) => void;
          setShortcuts: (s: unknown[]) => void;
        };
      }).__edit;
      edit.setShortcuts([{
        id: 'e2e-h',
        name: 'H ×100',
        enabled: true,
        shortcutKey: 'h',
        operation: 'multiply',
        shortcutValue: 100,
        scope: { columnIds: ['pnl'] },
      }]);
      edit.updateSettings({ shortcuts: { enabled: false, recordHistory: true } });
    });
    await expect.poll(() => editSettings<boolean>(page, 'shortcuts.enabled')).toBe(false);

    const row = await harnessRow(page, 0);
    const before = Number(await readField(page, row.positionId, 'pnl'));
    await focusCell(page, row.positionId, 'pnl', 0);
    await pressGridKey(page, 'h');
    await page.waitForTimeout(100);
    expect(Number(await readField(page, row.positionId, 'pnl'))).toBe(before);
  });
});
