/**
 * Cycle 5 / Task 5 — Excel-style editing E2E.
 *
 * Verifies the per-edit Enter / Edit mode dispatch:
 *   - Type-to-edit opens in 'enter' mode → arrow keys commit + move focus
 *     to the adjacent cell.
 *   - F2 / dblclick / single-click open in 'edit' mode → arrow keys move
 *     the input caret (editor stays open).
 *   - Mousedown inside an 'enter'-mode editor flips it to 'edit' so the
 *     user can keep typing/clicking without an accidental commit on the
 *     next arrow.
 *
 * The demo opts in via `enableExcelEditing: true` (positionsGrid.ts).
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

async function focusCell(page: import('@playwright/test').Page, row: number, colId: string) {
  // Click on the (non-editable) positionId column in the same row first so
  // the focus lands there without auto-opening an editor; then ArrowRight
  // walks to the editable target. Keeps focus on the canvas (input not
  // mounted) so type-to-edit fires.
  const b = await bounds(page, row, 'positionId');
  expect(b).not.toBeNull();
  const canvasRect = await page.locator('#grid canvas').boundingBox();
  expect(canvasRect).not.toBeNull();
  await page.mouse.click(
    canvasRect!.x + b!.x + Math.min(10, b!.w / 2),
    canvasRect!.y + b!.y + b!.h / 2,
  );
  // Walk right until focus is on the target column.
  const visited = new Set<string>(['positionId']);
  for (let i = 0; i < 20; i++) {
    const f = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getFocusedCell();
    });
    if (f?.colId === colId) return;
    if (f?.colId) visited.add(f.colId);
    await page.keyboard.press('ArrowRight');
  }
  throw new Error(`focusCell could not reach ${colId} (visited ${[...visited].join(', ')})`);
}

test.describe('Excel-style editing (Cycle 5 / Task 5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
  });

  test("type-to-edit on cusip + ArrowDown commits 'X' and moves focus down", async ({ page }) => {
    await focusCell(page, 0, 'cusip');
    // Type 'X' — editor opens in 'enter' mode with charPress='X'.
    await page.keyboard.press('X');
    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('X');
    // ArrowDown in 'enter' mode → commit + move focus down.
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveCount(0);
    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
        return g.getCellValue(0, 'cusip');
      }),
      { timeout: 5_000 },
    ).toBe('X');
    // Focus advanced to row 1 / cusip.
    const focused = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getFocusedCell();
    });
    expect(focused?.colId).toBe('cusip');
  });

  test("F2 opens in 'edit' mode: ArrowDown moves caret, editor stays open", async ({ page }) => {
    await focusCell(page, 0, 'cusip');
    await page.keyboard.press('F2');
    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    // ArrowDown in 'edit' mode → caret move; editor must remain mounted.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await expect(input).toBeVisible();
    // Escape cancels — original value preserved.
    await input.press('Escape');
    await expect(input).toHaveCount(0);
  });

  test("type-to-edit then mousedown in input flips to 'edit': ArrowDown stays open", async ({ page }) => {
    await focusCell(page, 0, 'cusip');
    await page.keyboard.press('Q');
    const input = page.locator('input.cg-cell-editor--text');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Q');
    // Mousedown inside the input flips 'enter' → 'edit'.
    await input.click();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    // Editor still open, no commit yet.
    await expect(input).toBeVisible();
    // Cancel via Escape so the spec doesn't pollute the row data.
    await input.press('Escape');
    await expect(input).toHaveCount(0);
  });
});
