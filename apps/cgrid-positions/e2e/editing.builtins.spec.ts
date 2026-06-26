/**
 * Cycle 5 / Task 2 — built-in editor end-to-end coverage.
 *
 * Targets the two columns the demo wires for Task 2:
 *   - `notionalAmount` → 'number' editor with { min: 0, precision: 2 }
 *   - `ticker`         → 'select' editor with a fixed values list
 */
import { test, expect } from '@playwright/test';

type CGridGlobal = {
  getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
  getCellValue: (r: number, c: string) => unknown;
};

async function bounds(page: import('@playwright/test').Page, row: number, colId: string) {
  return page.evaluate(([r, c]) => {
    const grid = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
    return grid.getCellBoundsAt(r as number, c as string);
  }, [row, colId]);
}

test.describe('Cell editing — built-in editors (Cycle 5 / Task 2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
  });

  test('number editor: double-click → type → Enter clamps to min and commits', async ({ page }) => {
    const b = await bounds(page, 0, 'notionalAmount');
    expect(b).not.toBeNull();
    const canvasRect = await page.locator('#grid canvas').boundingBox();
    expect(canvasRect).not.toBeNull();
    const clickX = canvasRect!.x + b!.x + Math.min(10, b!.w / 2);
    const clickY = canvasRect!.y + b!.y + b!.h / 2;
    await page.mouse.dblclick(clickX, clickY);

    const input = page.locator('input.cg-cell-editor--number');
    await expect(input).toBeVisible();
    // Negative input should clamp to min: 0 on commit.
    await input.fill('-50.555');
    await input.press('Enter');
    await expect(input).toHaveCount(0);

    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
        return g.getCellValue(0, 'notionalAmount');
      }),
      { timeout: 5_000 },
    ).toBe(0);
  });

  test('select editor: double-click → pick value → Enter commits typed value', async ({ page }) => {
    const original = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getCellValue(0, 'ticker');
    });
    const b = await bounds(page, 0, 'ticker');
    expect(b).not.toBeNull();
    const canvasRect = await page.locator('#grid canvas').boundingBox();
    const clickX = canvasRect!.x + b!.x + Math.min(10, b!.w / 2);
    const clickY = canvasRect!.y + b!.y + b!.h / 2;
    await page.mouse.dblclick(clickX, clickY);

    const select = page.locator('select.cg-cell-editor--select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(7);
    // Pick a value that differs from the row's original ticker so the test
    // always observes a change. selectOption fires `change` → auto-commit;
    // no Enter required.
    const newValue = original === 'TSLA' ? 'AAPL' : 'TSLA';
    await select.selectOption({ label: newValue });
    await expect(select).toHaveCount(0);

    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
        return g.getCellValue(0, 'ticker');
      }),
      { timeout: 5_000 },
    ).toBe(newValue);
  });
});
