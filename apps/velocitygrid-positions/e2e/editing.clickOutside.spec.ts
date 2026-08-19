/**
 * Click-on-another-cell-while-editing has Esc semantics.
 *
 * When the user has an editor open on cell A and clicks a different
 * body cell B, the edit on A is cancelled (no write, mirrors the Esc
 * keypress) and focus moves to B. The demo's `singleClickEdit: true`
 * then re-opens an editor on B, but the previously-typed value on A
 * does not persist.
 */
import { test, expect } from '@playwright/test';

type VelocityGridGlobal = {
  getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
  getCellValue: (r: number, c: string) => unknown;
  getFocusedCell: () => { rowId: string; colId: string } | null;
};

async function bounds(page: import('@playwright/test').Page, row: number, colId: string) {
  return page.evaluate(([r, c]) => {
    const grid = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
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

test.describe('Editing — click another cell cancels the edit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
  });

  test('clicking another body cell mid-edit closes the editor and discards typed value', async ({ page }) => {
    const originalA = await page.evaluate(
      () => (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid.getCellValue(0, 'cusip'),
    );
    // Open editor on cell A (row 0, cusip) via singleClickEdit.
    await clickCell(page, 0, 'cusip');
    const editor = page.locator('input.vg-cell-editor--text');
    await expect(editor).toBeVisible();
    await editor.fill('SHOULD-NOT-PERSIST');
    // Click another body cell (row 2, cusip) — should cancel A's edit
    // (Esc semantics) and re-open an editor on row 2 via singleClickEdit.
    await clickCell(page, 2, 'cusip');
    // The previous editor must be gone. singleClickEdit will open a NEW
    // editor on row 2, but that's a fresh DOM input; the value typed
    // into the row-0 editor must NOT have committed.
    const afterA = await page.evaluate(
      () => (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid.getCellValue(0, 'cusip'),
    );
    expect(afterA).toBe(originalA);
    // Focus moved to row 2.
    const focused = await page.evaluate(
      () => (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid.getFocusedCell(),
    );
    expect(focused?.colId).toBe('cusip');
    // New editor open on row 2 — its value matches row 2's underlying
    // value, not the discarded 'SHOULD-NOT-PERSIST' from row 0.
    const newEditorValue = await editor.inputValue();
    const row2Value = await page.evaluate(
      () => (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid.getCellValue(2, 'cusip'),
    );
    expect(newEditorValue).toBe(String(row2Value));
  });

  test('clicking a different column mid-edit cancels and opens an editor on the new cell', async ({ page }) => {
    const originalCusip = await page.evaluate(
      () => (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid.getCellValue(0, 'cusip'),
    );
    await clickCell(page, 0, 'cusip');
    const cusipEditor = page.locator('input.vg-cell-editor--text');
    await expect(cusipEditor).toBeVisible();
    await cusipEditor.fill('NOPE');
    // Click a different column on the same row — ticker (a 'select' editor).
    await clickCell(page, 0, 'ticker');
    const afterCusip = await page.evaluate(
      () => (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid.getCellValue(0, 'cusip'),
    );
    expect(afterCusip).toBe(originalCusip);
    // The text editor should be gone; ticker's select editor should be open.
    await expect(page.locator('input.vg-cell-editor--text')).toHaveCount(0);
    await expect(page.locator('select.vg-cell-editor--select')).toBeVisible();
  });
});
