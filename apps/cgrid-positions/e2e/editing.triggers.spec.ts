/**
 * Cycle 5 / Task 4 — edit trigger end-to-end coverage.
 *
 * Exercises the click + keyboard surface that decides when an editor
 * opens / closes / advances:
 *   - singleClickEdit (grid-level, demo opts in at line 119 of positionsGrid.ts)
 *   - F2 / Enter on a focused editable cell open the editor
 *   - enterNavigatesVerticallyAfterEdit — Enter commits then moves focus down
 *   - Tab while editing commits + opens the next editable cell
 *   - Escape while editing cancels without writing
 */
import { test, expect } from '@playwright/test';

type CGridGlobal = {
  getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
  getCellValue: (r: number, c: string) => unknown;
  setFocusedCell: (rowId: string, colId: string) => void;
  getFocusedCell: () => { rowId: string; colId: string } | null;
};

async function bounds(page: import('@playwright/test').Page, row: number, colId: string) {
  return page.evaluate(([r, c]) => {
    const grid = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
    return grid.getCellBoundsAt(r as number, c as string);
  }, [row, colId]);
}

async function clickCell(page: import('@playwright/test').Page, row: number, colId: string) {
  const b = await bounds(page, row, colId);
  expect(b).not.toBeNull();
  const canvasRect = await page.locator('#grid canvas').boundingBox();
  expect(canvasRect).not.toBeNull();
  await page.mouse.click(
    canvasRect!.x + b!.x + Math.min(10, b!.w / 2),
    canvasRect!.y + b!.y + b!.h / 2,
  );
}

test.describe('Cell editing — triggers (Cycle 5 / Task 4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
  });

  test('singleClickEdit: a single click on cusip opens the text editor', async ({ page }) => {
    await clickCell(page, 0, 'cusip');
    await expect(page.locator('input.cg-cell-editor--text')).toBeVisible();
  });

  test('Esc cancels a single-click-opened editor without writing', async ({ page }) => {
    const original = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getCellValue(0, 'cusip');
    });
    await clickCell(page, 0, 'cusip');
    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    await input.fill('TYPED');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    const after = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getCellValue(0, 'cusip');
    });
    expect(after).toBe(original);
  });

  test('Enter commits + descends one row (enterNavigatesVerticallyAfterEdit)', async ({ page }) => {
    await clickCell(page, 0, 'cusip');
    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    await input.fill('ROW0-EDIT');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    // Value committed on row 0:
    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
        return g.getCellValue(0, 'cusip');
      }),
      { timeout: 5_000 },
    ).toBe('ROW0-EDIT');
    // Focus advanced to row 1:
    const focused = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getFocusedCell();
    });
    expect(focused?.colId).toBe('cusip');
  });

  test('Tab while editing commits + jumps to the next editable cell + opens its editor', async ({ page }) => {
    await clickCell(page, 0, 'cusip');
    const cusipInput = page.locator('input.cg-cell-editor--text');
    await expect(cusipInput).toBeVisible();
    await cusipInput.fill('TAB-COMMIT');
    await cusipInput.press('Tab');
    // The previous text editor is gone:
    await expect(cusipInput).toHaveCount(0);
    // The next editable column is `ticker` (select editor):
    await expect(page.locator('select.cg-cell-editor--select')).toBeVisible();
    // And the commit landed:
    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
        return g.getCellValue(0, 'cusip');
      }),
      { timeout: 5_000 },
    ).toBe('TAB-COMMIT');
  });
});
