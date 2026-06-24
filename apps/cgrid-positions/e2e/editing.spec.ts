/**
 * Cycle 5 / Task 1 — text editor end-to-end coverage.
 *
 * Assumes the dev server is running and the STOMP server is feeding the
 * positions snapshot (same fixture as cycle4.spec.ts and grid.spec.ts).
 *
 * The `ticker` column is the editable target (see `positionsGrid.ts`
 * — Cycle 5 Task 1 marks it `editable: true`). We use the grid's
 * `getCellBoundsAt` helper to position synthetic clicks instead of guessing
 * pixel coordinates so the tests survive layout tweaks.
 */
import { test, expect } from '@playwright/test';

test.describe('Cell editing — text editor (Cycle 5 / Task 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // __cgridReady is set by the `firstDataRendered` handler in main.ts
    // once the first non-empty viewport chunk has been painted.
    await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, null, { timeout: 20_000 });
  });

  test('double-click ticker cell opens text editor; Enter commits typed value', async ({ page }) => {
    const bounds = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null } }).__cgrid;
      return grid.getCellBoundsAt(0, 'ticker');
    });
    expect(bounds).not.toBeNull();
    const canvasRect = await page.locator('#grid canvas').boundingBox();
    expect(canvasRect).not.toBeNull();
    const clickX = canvasRect!.x + bounds!.x + Math.min(10, bounds!.w / 2);
    const clickY = canvasRect!.y + bounds!.y + bounds!.h / 2;
    await page.mouse.dblclick(clickX, clickY);

    const input = page.locator('input.cg-cell-editor--text');
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
        return g.getCellValue(0, 'ticker');
      }),
      { timeout: 5_000 },
    ).toBe('CHANGED');
  });

  test('Escape cancels without writing', async ({ page }) => {
    const original = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellValue: (r: number, c: string) => unknown } }).__cgrid;
      return grid.getCellValue(0, 'ticker');
    });
    const bounds = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null } }).__cgrid;
      return grid.getCellBoundsAt(0, 'ticker');
    });
    const canvasRect = await page.locator('#grid canvas').boundingBox();
    const clickX = canvasRect!.x + bounds!.x + Math.min(10, bounds!.w / 2);
    const clickY = canvasRect!.y + bounds!.y + bounds!.h / 2;
    await page.mouse.dblclick(clickX, clickY);

    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    await input.fill('TYPED');
    await input.press('Escape');
    await expect(input).toHaveCount(0);

    const after = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: { getCellValue: (r: number, c: string) => unknown } }).__cgrid;
      return grid.getCellValue(0, 'ticker');
    });
    expect(after).toBe(original);
  });
});
