/**
 * Cycle 5 / Task 3 — popup editor end-to-end coverage.
 *
 * The `notes` column wires the largeText editor (`isPopup() === true`).
 * Verifies:
 *   1. Double-click opens a popup textarea (mounted directly on the editor
 *      host, NOT wrapped in `.vg-editor-overlay`).
 *   2. The popup is wider than the cell column (proves it's not inline).
 *   3. Ctrl+Enter commits; getCellValue reads the typed text back.
 *
 * `notes` sits past the natural viewport width — every test scrolls it into
 * view via `api.ensureColumnVisible` before reading bounds.
 */
import { test, expect } from '@playwright/test';

type VelocityGridGlobal = {
  getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
  getCellValue: (r: number, c: string) => unknown;
  ensureColumnVisible: (c: string, p?: 'auto' | 'start' | 'middle' | 'end') => void;
};

async function openNotesPopup(page: import('@playwright/test').Page) {
  // Scroll `notes` into view first (it sits past the right edge of the
  // default 1400px viewport). Returns the cell bounds + canvas rect for
  // the synthetic dblclick.
  await page.evaluate(() => {
    const grid = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
    grid.ensureColumnVisible('notes', 'start');
  });
  // ensureColumnVisible kicks the worker fetch; wait a frame for the
  // chunk to land so getCellBoundsAt resolves.
  await page.waitForFunction(
    () => {
      const grid = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
      return grid.getCellBoundsAt(0, 'notes') !== null;
    },
    null,
    { timeout: 5_000 },
  );
  const bounds = await page.evaluate(() => {
    const grid = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
    return grid.getCellBoundsAt(0, 'notes');
  });
  expect(bounds).not.toBeNull();
  const canvasRect = await page.locator('#grid canvas').boundingBox();
  expect(canvasRect).not.toBeNull();
  const clickX = canvasRect!.x + bounds!.x + Math.min(10, bounds!.w / 2);
  const clickY = canvasRect!.y + bounds!.y + bounds!.h / 2;
  await page.mouse.dblclick(clickX, clickY);
  return { bounds: bounds!, canvasRect: canvasRect! };
}

test.describe('Cell editing — popup editor (Cycle 5 / Task 3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
  });

  test('double-click notes cell opens popup textarea (not inline)', async ({ page }) => {
    const { bounds } = await openNotesPopup(page);
    const textarea = page.locator('textarea.vg-cell-editor--large-text');
    await expect(textarea).toBeVisible();

    // Popup mode marker: the textarea is NOT inside the `.vg-editor-overlay`
    // wrapper that inline mode creates.
    const wrapped = await textarea.evaluate(
      (el) => el.closest('.vg-editor-overlay') !== null,
    );
    expect(wrapped).toBe(false);

    // Popup textarea uses intrinsic sizing (rows: 6, cols: 40) so its
    // rendered width is well above the 140 px notes column.
    const taWidth = await textarea.evaluate((el) => (el as HTMLTextAreaElement).offsetWidth);
    expect(taWidth).toBeGreaterThan(bounds.w);
  });

  test('popup textarea commits typed value via Ctrl+Enter', async ({ page }) => {
    await openNotesPopup(page);
    const textarea = page.locator('textarea.vg-cell-editor--large-text');
    await expect(textarea).toBeVisible();
    await textarea.fill('LINE1\nLINE2 — popup commit');
    await textarea.press('Control+Enter');
    await expect(textarea).toHaveCount(0);

    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
        return g.getCellValue(0, 'notes');
      }),
      { timeout: 5_000 },
    ).toBe('LINE1\nLINE2 — popup commit');
  });

  test('Escape inside popup cancels without writing', async ({ page }) => {
    // Read the original value AFTER scrolling notes into view so the worker
    // chunk has been requested for the now-visible column.
    await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
      grid.ensureColumnVisible('notes', 'start');
    });
    await page.waitForFunction(
      () => {
        const g = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
        return g.getCellBoundsAt(0, 'notes') !== null;
      },
      null,
      { timeout: 5_000 },
    );
    const original = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
      return g.getCellValue(0, 'notes');
    });

    await openNotesPopup(page);
    const textarea = page.locator('textarea.vg-cell-editor--large-text');
    await expect(textarea).toBeVisible();
    await textarea.fill('discard me');
    await textarea.press('Escape');
    await expect(textarea).toHaveCount(0);

    const after = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: VelocityGridGlobal }).__cgrid;
      return g.getCellValue(0, 'notes');
    });
    expect(after).toBe(original);
  });
});
