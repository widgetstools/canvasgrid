import { test, expect } from '@playwright/test';
import { setupGrid, silenceCaret, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — DOM editor on a center column. Opens the
// `notionalAmount` editor (number → text input) on a visible row;
// `notionalAmount` lives in the center band at default horizontal
// scroll, so the editor mounts in view rather than no-op'ing on an
// off-screen cell. The DOM editor must sit exactly over the cell
// bounds — commit `0d0ce17` regressed when the editor lagged its
// focused cell on scroll, and commit `d302071` regressed when the
// editor floated over the header strip. A 4-px drift either way
// pushes this snapshot past the 0.5 % diff threshold and fails
// the gate.
test('editor open on center column (notionalAmount) — DOM input over cell bounds', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: { openEditor: (rowIndex: number, colId: string) => void };
    }).__cgrid;
    g.openEditor(4, 'notionalAmount');
  });
  await silenceCaret(page);
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('04-editor-center-column.png');
});
