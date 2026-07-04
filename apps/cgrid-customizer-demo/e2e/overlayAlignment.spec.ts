import { test, expect, type Page } from '@playwright/test';

/**
 * Cycle 21i Phase 2 / T1 regression — canvas ↔ DOM-overlay alignment
 * must survive a side-bar reflow.
 *
 * The grid's top-strip stack (intrinsic toolbar + status bar + pivot +
 * row-group panels) is applied to the canvas through TWO paths:
 * `applyVerticalInsets` (strip mounts) and `reserveSideBarSpace`
 * (side-bar open/close/resize). When the two formulas disagree, the
 * canvas slides out from under the DOM overlays the moment a tool
 * panel opens — floating filter inputs land on top of data rows and
 * header captions drift (user-reported 2026-07-04). Both paths now
 * share `computeTopInset()`; this spec pins the symptom.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

/** Vertical geometry the overlays + canvas must agree on. */
async function measure(page: Page): Promise<{ canvasTop: number; filterTop: number }> {
  return page.evaluate(() => {
    const grid = document.querySelector('.cg-grid')!;
    const canvas = grid.querySelector('canvas')!;
    const filterInput = grid.querySelector('.cg-floating-filter-overlay input, .cg-grid input')!;
    return {
      canvasTop: Math.round(canvas.getBoundingClientRect().top),
      filterTop: Math.round(filterInput.getBoundingClientRect().top),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('floating filters + canvas stay put when a side-bar panel opens and closes', async ({ page }) => {
  const before = await measure(page);

  // Opening a tool panel fires reserveSideBarSpace (horizontal reflow) —
  // vertical geometry must not move.
  await page.getByRole('button', { name: 'Column Groups' }).click();
  await expect(page.locator('.cg-colgroups-panel')).toBeVisible();
  const open = await measure(page);
  expect(open).toEqual(before);

  // Close it again — still no vertical drift.
  await page.getByRole('button', { name: 'Column Groups' }).click();
  await expect(page.locator('.cg-colgroups-panel')).toBeHidden();
  const closed = await measure(page);
  expect(closed).toEqual(before);
});

test('alignment also holds with a second panel (Options) and after toolbar height change', async ({ page }) => {
  const before = await measure(page);

  await page.getByRole('button', { name: 'Options' }).click();
  const open = await measure(page);
  expect(open).toEqual(before);

  // Runtime toolbarHeight change while the panel is open: overlays and
  // canvas must shift together (same delta), never apart.
  await page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.setGridOption('toolbarHeight', 56));
  const grown = await measure(page);
  expect(grown.canvasTop - open.canvasTop).toBe(16);
  expect(grown.filterTop - open.filterTop).toBe(16);

  await page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.setGridOption('toolbarHeight', undefined));
  const reverted = await measure(page);
  expect(reverted).toEqual(open);
});
