import { test, expect, type Page } from '@playwright/test';

/**
 * Regression — horizontal scroll must survive a model REORDER.
 *
 * Bug: with a column sorted and the grid updating in real time, horizontally
 * scrolling the grid snapped back to its original position on the next tick.
 * Root cause: a reorder re-resolves the focused cell's rowId to a new visible
 * INDEX (`rebuildSelectionFromPersistentIds` → `rebuildIndices`), and the
 * selection `onChange` handler treated that index change as a focus change and
 * called `ensureColIdVisible`, scrolling the focused column back into view.
 *
 * A sort *toggle* (asc → desc) is a deterministic proxy for the real-time
 * reorder: it moves the focused row's index without any live-feed timing.
 * The grid is a <canvas>, so state goes through `window.__cgapi`.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    { timeout: 10_000 },
  );
  // Grid-ready fires before the STOMP snapshot populates rows — wait for data.
  await page.waitForFunction(
    () => ((window as any).__cgapi?.getDisplayedRowCount?.() ?? 0) > 100,
    { timeout: 10_000 },
  );
}

/** Click a Ticker-column cell (2nd column) well inside the data area and wait
 *  for the focus to land. Returns the focused rowId. */
async function focusTickerCell(page: Page): Promise<string> {
  const canvas = page.locator('.cg-grid canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + 175, box.y + 220);
  await page.waitForFunction(() => {
    const f = (window as any).__cgapi.getFocusedCell?.();
    return !!(f && f.colId === 'ticker' && f.rowId != null);
  }, { timeout: 5_000 });
  return page.evaluate(() => (window as any).__cgapi.getFocusedCell().rowId);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  // Narrow viewport so the columns overflow horizontally (room to scroll).
  await page.setViewportSize({ width: 760, height: 700 });
  await page.reload();
  await waitForGridReady(page);
});

test('horizontal scroll is preserved when a sorted grid reorders (focused cell re-maps)', async ({ page }) => {
  // 1) Sort a column ascending so a later toggle reorders the rows.
  await page.evaluate(() => (window as any).__cgapi.setSortModel([{ colId: 'pnl', sort: 'asc' }]));

  // 2) Focus a cell in the Ticker column.
  const focusedRowId = await focusTickerCell(page);

  // 3) Scroll horizontally to the far right — the focused Ticker column
  //    scrolls out of view.
  const scrolled = await page.evaluate(() => {
    const s = document.querySelector('.cg-scroller') as HTMLElement;
    s.scrollLeft = s.scrollWidth;
    s.dispatchEvent(new Event('scroll'));
    return { scrollLeft: s.scrollLeft, maxScroll: s.scrollWidth - s.clientWidth };
  });
  // There must be real horizontal overflow for the assertion to mean anything.
  expect(scrolled.maxScroll).toBeGreaterThan(20);
  expect(scrolled.scrollLeft).toBe(scrolled.maxScroll);

  // 4) Toggle the sort desc → the focused row's index changes (reorder).
  await page.evaluate(() => (window as any).__cgapi.setSortModel([{ colId: 'pnl', sort: 'desc' }]));
  await page.waitForTimeout(300);

  // 5) The reorder must NOT have auto-scrolled the viewport back.
  const after = await page.evaluate(() => {
    const s = document.querySelector('.cg-scroller') as HTMLElement;
    return { scrollLeft: s.scrollLeft, focused: (window as any).__cgapi.getFocusedCell() };
  });
  expect(after.scrollLeft).toBe(scrolled.scrollLeft);         // horizontal scroll preserved
  expect(after.focused?.rowId).toBe(focusedRowId);            // focus survived the reorder
});

test('genuine column navigation still scrolls the focused column into view (no regression)', async ({ page }) => {
  const canvas = page.locator('.cg-grid canvas').first();
  const box = await canvas.boundingBox();

  // Focus a right-side cell while scrolled to the far right.
  await page.evaluate(() => {
    const s = document.querySelector('.cg-scroller') as HTMLElement;
    s.scrollLeft = s.scrollWidth;
    s.dispatchEvent(new Event('scroll'));
  });
  await page.mouse.click(box!.x + box!.width - 40, box!.y + 220);
  await page.waitForFunction(() => (window as any).__cgapi.getFocusedCell?.()?.rowId != null, { timeout: 5_000 });
  const before = await page.evaluate(() => (document.querySelector('.cg-scroller') as HTMLElement).scrollLeft);

  // Navigate focus left across several columns — the viewport SHOULD follow.
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => (document.querySelector('.cg-scroller') as HTMLElement).scrollLeft);
  expect(after).toBeLessThan(before);   // navigation-driven auto-scroll still works
});
