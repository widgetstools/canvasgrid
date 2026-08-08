import { test, expect } from '@playwright/test';
import {
  bootCustomizer,
  openCustomizer,
  saveCard,
  cockpit,
} from './helpers/customizer';
import {
  harnessRow,
  readField,
  selectCells,
  undoOnce,
  editSettings,
  toggleSettingsRow,
} from './helpers/editOps';

/**
 * Markets parity — Bulk Update Customize panel + execute path.
 * Checklist: stern-bak/apps/e2e/v2-bulk-update.spec.ts
 */

test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

test.describe('Bulk Update (Markets parity)', () => {
  test('settings sheet opens; Save toggles recordHistory', async ({ page }) => {
    // Markets: v2-bulk-update — settings sheet opens Bulk Update panel
    await openCustomizer(page, 'bulk-update');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Bulk Update');
    await expect(cockpit(page)).toContainText(/Record history/i);

    const before = await editSettings<boolean>(page, 'bulkUpdate.recordHistory');
    await toggleSettingsRow(page, /Record history/i);
    await saveCard(page);
    await expect.poll(() => editSettings<boolean>(page, 'bulkUpdate.recordHistory')).toBe(!before);
  });

  test('apply sets currency on selection; undo restores', async ({ page }) => {
    // Markets: v2-bulk-update — bulk set after selection + undo
    const r0 = await harnessRow(page, 0);
    const r1 = await harnessRow(page, 1);
    const before0 = await readField(page, r0.positionId, 'currency');
    const before1 = await readField(page, r1.positionId, 'currency');
    const next = before0 === 'GBP' ? 'JPY' : 'GBP';

    await selectCells(page, { rowStart: 0, rowEnd: 1, colIds: ['currency'] });
    const applied = await page.evaluate(async (value) => {
      const edit = (window as unknown as {
        __edit: {
          bulkUpdate: {
            collectTargets: () => Promise<unknown[]>;
            apply: (t: unknown[], v: unknown) => Promise<{ applied: number }>;
          };
        };
      }).__edit;
      const targets = await edit.bulkUpdate.collectTargets();
      const result = await edit.bulkUpdate.apply(targets, value);
      return { count: targets.length, applied: result.applied };
    }, next);
    expect(applied.count).toBeGreaterThanOrEqual(2);
    expect(applied.applied).toBeGreaterThanOrEqual(2);

    await expect.poll(() => readField(page, r0.positionId, 'currency')).toBe(next);
    await expect.poll(() => readField(page, r1.positionId, 'currency')).toBe(next);

    await undoOnce(page);
    await expect.poll(() => readField(page, r0.positionId, 'currency')).toBe(before0);
    await expect.poll(() => readField(page, r1.positionId, 'currency')).toBe(before1);
  });

  test('multi-column selection blocks bulk apply when enforceSingleColumn', async ({ page }) => {
    // Markets: v2-bulk-update — multi-column selection disables bulk apply
    await expect.poll(() => editSettings<boolean>(page, 'bulkUpdate.enforceSingleColumn')).toBe(true);
    await selectCells(page, { rowStart: 0, rowEnd: 0, colIds: ['currency', 'desk'] });
    const result = await page.evaluate(async () => {
      const edit = (window as unknown as {
        __edit: {
          bulkUpdate: {
            collectTargets: () => Promise<unknown[]>;
            apply: (t: unknown[], v: unknown) => Promise<{ applied: number }>;
          };
        };
      }).__edit;
      const targets = await edit.bulkUpdate.collectTargets();
      const applied = await edit.bulkUpdate.apply(targets, 'XXX');
      return { targetCount: targets.length, applied: applied.applied };
    });
    expect(result.targetCount).toBeGreaterThan(1);
    expect(result.applied).toBe(0);
  });

  test('ribbon Bulk Apply sets selected currency cells', async ({ page }) => {
    // Markets: v2-bulk-update — toolbar value control and apply button
    const r0 = await harnessRow(page, 0);
    const before = await readField(page, r0.positionId, 'currency');
    const next = before === 'USD' ? 'CAD' : 'USD';

    await selectCells(page, { rowStart: 0, rowEnd: 0, colIds: ['currency'] });
    const bulkInput = page.locator('.vgext-edit-strip input.vgext-rb-input[placeholder="New value"], .vgext-ribbon input.vgext-rb-input[placeholder="New value"]').first();
    await expect(bulkInput).toBeVisible();
    await bulkInput.fill(String(next));
    const apply = page.locator('.vgext-edit-strip button[title="Apply"], .vgext-ribbon button[title="Apply"]').first();
    await expect(apply).toBeEnabled({ timeout: 5_000 });
    await apply.click();
    await expect.poll(() => readField(page, r0.positionId, 'currency')).toBe(next);
    await undoOnce(page);
    await expect.poll(() => readField(page, r0.positionId, 'currency')).toBe(before);
  });
});
