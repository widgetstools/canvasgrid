/**
 * Cycle 5 / Task 1 — text editor end-to-end coverage.
 *
 * Assumes the dev server is running and the STOMP server is feeding the
 * positions snapshot (same fixture as cycle4.spec.ts and grid.spec.ts).
 *
 * The `cusip` column is the text-editable target. (Originally `ticker`
 * carried this coverage; Cycle 5 Task 2 re-targets ticker to the select
 * editor and promotes cusip to the text-edit target so this spec stays
 * focused on the default 'text' editor.)
 */
import { test, expect } from '@playwright/test';

test.describe('Cell editing — text editor (Cycle 5 / Task 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light');
    // __cgridReady is set by the `firstDataRendered` handler in main.ts
    // once the first non-empty viewport chunk has been painted.
    await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, null, { timeout: 20_000 });
  });

  test('double-click cusip cell opens text editor; Enter commits typed value', async ({ page }) => {
    const bounds = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null } }).__cgrid;
      return grid.getCellBoundsAt(0, 'cusip');
    });
    expect(bounds).not.toBeNull();
    const canvasRect = await page.locator('#grid canvas').boundingBox();
    expect(canvasRect).not.toBeNull();
    const clickX = canvasRect!.x + bounds!.x + Math.min(10, bounds!.w / 2);
    const clickY = canvasRect!.y + bounds!.y + bounds!.h / 2;
    await page.mouse.dblclick(clickX, clickY);

    const input = page.locator('input.vg-cell-editor--text');
    await expect(input).toBeVisible();
    await input.fill('CHANGED');
    await input.press('Enter');
    await expect(input).toHaveCount(0);

    // Commit is async: editor.onCommit → worker.getRowByIndex →
    // applyTransaction → modelUpdated → new chunk → getCellValue sees
    // 'CHANGED'. Poll instead of a one-shot read.
    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: { getCellValue: (r: number, c: string) => unknown } }).__cgrid;
        return g.getCellValue(0, 'cusip');
      }),
      { timeout: 5_000 },
    ).toBe('CHANGED');
  });

  test('Escape cancels without writing', async ({ page }) => {
    const original = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellValue: (r: number, c: string) => unknown } }).__cgrid;
      return grid.getCellValue(0, 'cusip');
    });
    const bounds = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null } }).__cgrid;
      return grid.getCellBoundsAt(0, 'cusip');
    });
    const canvasRect = await page.locator('#grid canvas').boundingBox();
    const clickX = canvasRect!.x + bounds!.x + Math.min(10, bounds!.w / 2);
    const clickY = canvasRect!.y + bounds!.y + bounds!.h / 2;
    await page.mouse.dblclick(clickX, clickY);

    const input = page.locator('input.vg-cell-editor--text');
    await expect(input).toBeVisible();
    await input.fill('TYPED');
    await input.press('Escape');
    await expect(input).toHaveCount(0);

    const after = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellValue: (r: number, c: string) => unknown } }).__cgrid;
      return grid.getCellValue(0, 'cusip');
    });
    expect(after).toBe(original);
  });
});
