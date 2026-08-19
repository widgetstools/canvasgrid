import { test, expect } from '@playwright/test';
import {
  bootCustomizer,
  openCustomizer,
  saveCard,
  cockpit,
} from './helpers/customizer';
import {
  makeTarget,
  readField,
  selectCells,
  undoOnce,
  editSettings,
  toggleSettingsRow,
} from './helpers/editOps';

/**
 * Markets parity — Smart Edit Customize panel + ops execute path.
 * Checklist: stern-bak/apps/e2e/v2-smart-edit.spec.ts
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

test.describe('Smart Edit (Markets parity)', () => {
  test('settings Save toggles recordHistory', async ({ page }) => {
    // Markets: v2-smart-edit — settings sheet opens Smart Edit panel
    await openCustomizer(page, 'smart-edit');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Smart Edit');

    const before = await editSettings<boolean>(page, 'smartEdit.recordHistory');
    await cockpit(page).locator('.ckp-switch').last().click();
    await saveCard(page);
    await expect.poll(() => editSettings<boolean>(page, 'smartEdit.recordHistory')).toBe(!before);
  });

  test('multiply op doubles pnl; undo restores', async ({ page }) => {
    // Markets: v2-smart-edit — multiply op updates a cell after range selection
    const target = await makeTarget(page, 0, 'pnl');
    const before = Number(target.value);
    const result = await page.evaluate(async (t) => {
      const edit = (window as unknown as {
        __edit: {
          smartEdit: {
            apply: (targets: unknown[], op: string, n: number) => Promise<{ applied: number }>;
          };
        };
      }).__edit;
      return edit.smartEdit.apply([t], 'multiply', 2);
    }, target);
    expect(result.applied).toBeGreaterThan(0);
    await expect.poll(async () => Number(await readField(page, String(target.rowId), 'pnl'))).toBe(before * 2);

    await undoOnce(page);
    await expect.poll(async () => Number(await readField(page, String(target.rowId), 'pnl'))).toBe(before);
  });

  test('add op increases pnl; undo restores', async ({ page }) => {
    // Markets: v2-smart-edit — add op increases selected cell value
    const target = await makeTarget(page, 1, 'pnl');
    const before = Number(target.value);
    await page.evaluate(async (t) => {
      const edit = (window as unknown as {
        __edit: { smartEdit: { apply: (targets: unknown[], op: string, n: number) => Promise<unknown> } };
      }).__edit;
      await edit.smartEdit.apply([t], 'add', 100);
    }, target);
    await expect.poll(async () => Number(await readField(page, String(target.rowId), 'pnl'))).toBe(before + 100);
    await undoOnce(page);
    await expect.poll(async () => Number(await readField(page, String(target.rowId), 'pnl'))).toBe(before);
  });

  test('settings Save toggles previewBeforeApply; preview does not mutate', async ({ page }) => {
    // Markets: v2-smart-edit — preview before apply (settings + preview API)
    await openCustomizer(page, 'smart-edit');
    const before = await editSettings<boolean>(page, 'smartEdit.previewBeforeApply');
    await toggleSettingsRow(page, /Preview before/i);
    await saveCard(page);
    await expect.poll(() => editSettings<boolean>(page, 'smartEdit.previewBeforeApply')).toBe(!before);

    const target = await makeTarget(page, 0, 'pnl');
    const liveBefore = Number(await readField(page, String(target.rowId), 'pnl'));
    const preview = await page.evaluate(async (t) => {
      const edit = (window as unknown as {
        __edit: {
          smartEdit: {
            preview: (targets: unknown[], op: string, n: number) => { rows: unknown[] };
          };
        };
      }).__edit;
      return edit.smartEdit.preview([t], 'multiply', 2);
    }, target);
    expect(Array.isArray(preview.rows) ? preview.rows.length : (preview as unknown as unknown[]).length).toBeGreaterThan(0);
    // preview must not write through to the grid
    expect(Number(await readField(page, String(target.rowId), 'pnl'))).toBe(liveBefore);
  });

  test('multi-column selection blocks smart-edit apply when enforceSingleColumn', async ({ page }) => {
    // Markets: v2-smart-edit — multi-column selection disables smart edit
    await expect.poll(() => editSettings<boolean>(page, 'smartEdit.enforceSingleColumn')).toBe(true);
    await selectCells(page, { rowStart: 0, rowEnd: 0, colIds: ['pnl', 'dv01'] });
    const result = await page.evaluate(async () => {
      const edit = (window as unknown as {
        __edit: {
          smartEdit: {
            collectTargets: () => Promise<unknown[]>;
            apply: (t: unknown[], op: string, n: number) => Promise<{ applied: number }>;
          };
        };
      }).__edit;
      const targets = await edit.smartEdit.collectTargets();
      const applied = await edit.smartEdit.apply(targets, 'add', 1);
      return { targetCount: targets.length, applied: applied.applied };
    });
    expect(result.targetCount).toBeGreaterThan(1);
    expect(result.applied).toBe(0);
  });
});
