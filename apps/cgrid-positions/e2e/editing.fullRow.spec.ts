/**
 * Cycle 5 / Task 10 — full-row edit end-to-end coverage.
 *
 * The demo opts into full-row mode via the `?editType=fullRow` query
 * param (main.ts reads URL, forwards into createPositionsGrid). In this
 * mode, triggering an edit on any editable cell mounts an editor for
 * EVERY editable column in that row simultaneously. Tab cycles between
 * them; Enter commits all; Esc cancels all.
 *
 * The demo's positionsGrid has 7 editable columns (cusip, ticker,
 * notional, tradeDate, expiryDate, notes, confirmed) — but only those
 * currently in the viewport's visible column window will mount editors.
 * The viewport is sized at 800×600 so the pinned-left `cusip` plus the
 * first several body cols are visible — covers Tab navigation across
 * editor types (text → select → number).
 */
import { test, expect } from '@playwright/test';

type CGridGlobal = {
  getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
  getCellValue: (r: number, c: string) => unknown;
  on: (type: string, handler: (e: unknown) => void) => () => void;
};

async function bounds(page: import('@playwright/test').Page, row: number, colId: string) {
  return page.evaluate(([r, c]) => {
    const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
    return g.getCellBoundsAt(r as number, c as string);
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

test.describe('Cell editing — full-row mode (Cycle 5 / Task 10)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?stress=light&editType=fullRow');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
    // Park a sink for row-level events on window so tests can assert
    // they fired by the time the editor closes.
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      const events: string[] = [];
      (window as unknown as { __rowEvents: string[] }).__rowEvents = events;
      g.on('rowEditingStarted', () => events.push('rowEditingStarted'));
      g.on('rowEditingStopped', () => events.push('rowEditingStopped'));
      g.on('rowValueChanged', () => events.push('rowValueChanged'));
    });
  });

  test('clicking cusip opens editors for all editable cells in the row + rowEditingStarted fires', async ({ page }) => {
    await clickCell(page, 0, 'cusip');
    // The text editor for cusip is mounted; the select editor for ticker
    // is mounted; the number editor for notional is mounted. Each visible
    // editable column lights up at once.
    await expect(page.locator('.cg-editor-overlay--row input.cg-cell-editor--text').first()).toBeVisible();
    await expect(page.locator('.cg-editor-overlay--row select.cg-cell-editor--select')).toBeVisible();
    await expect(page.locator('.cg-editor-overlay--row input.cg-cell-editor--number')).toBeVisible();
    // Count is ≥ 3 — exact count depends on the visible-column window but
    // cusip, ticker, notional are reliably in view at 800×600.
    const editorCount = await page.locator('.cg-editor-overlay--row').count();
    expect(editorCount).toBeGreaterThanOrEqual(3);
    // rowEditingStarted fired exactly once.
    const events = await page.evaluate(
      () => (window as unknown as { __rowEvents: string[] }).__rowEvents,
    );
    expect(events).toContain('rowEditingStarted');
  });

  test('Tab cycles focus through editors within the row', async ({ page }) => {
    await clickCell(page, 0, 'cusip');
    const cusipInput = page.locator('.cg-editor-overlay--row input.cg-cell-editor--text').first();
    await expect(cusipInput).toBeFocused();
    await cusipInput.press('Tab');
    // Tab from cusip (text) lands on ticker (select) — the next editable
    // column in render order.
    await expect(page.locator('.cg-editor-overlay--row select.cg-cell-editor--select')).toBeFocused();
  });

  test('Enter commits every changed editor + rowEditingStopped + rowValueChanged fire', async ({ page }) => {
    const originalCusip = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getCellValue(0, 'cusip');
    });
    await clickCell(page, 0, 'cusip');
    const cusipInput = page.locator('.cg-editor-overlay--row input.cg-cell-editor--text').first();
    await expect(cusipInput).toBeVisible();
    await cusipInput.fill('FULLROW-CUSIP');
    // Commit row.
    await cusipInput.press('Enter');
    // All row editors gone.
    await expect(page.locator('.cg-editor-overlay--row')).toHaveCount(0);
    // Committed value reflected in the chunk.
    await expect.poll(
      () => page.evaluate(() => {
        const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
        return g.getCellValue(0, 'cusip');
      }),
      { timeout: 5_000 },
    ).toBe('FULLROW-CUSIP');
    expect(originalCusip).not.toBe('FULLROW-CUSIP');
    const events = await page.evaluate(
      () => (window as unknown as { __rowEvents: string[] }).__rowEvents,
    );
    expect(events).toContain('rowEditingStopped');
    expect(events).toContain('rowValueChanged');
  });

  test('Escape cancels every editor in the row + no commit + rowEditingStopped fires (no rowValueChanged)', async ({ page }) => {
    const original = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getCellValue(0, 'cusip');
    });
    await clickCell(page, 0, 'cusip');
    const cusipInput = page.locator('.cg-editor-overlay--row input.cg-cell-editor--text').first();
    await expect(cusipInput).toBeVisible();
    await cusipInput.fill('SHOULD-NOT-COMMIT');
    await cusipInput.press('Escape');
    await expect(page.locator('.cg-editor-overlay--row')).toHaveCount(0);
    const after = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: CGridGlobal }).__cgrid;
      return g.getCellValue(0, 'cusip');
    });
    expect(after).toBe(original);
    const events = await page.evaluate(
      () => (window as unknown as { __rowEvents: string[] }).__rowEvents,
    );
    expect(events).toContain('rowEditingStopped');
    expect(events).not.toContain('rowValueChanged');
  });
});
