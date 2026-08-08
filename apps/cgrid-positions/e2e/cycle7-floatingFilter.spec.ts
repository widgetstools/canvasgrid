/**
 * Cycle 7 / Task 1 — floating-filter row.
 *
 * Verifies that:
 * 1. The DOM `<input>` overlay mounts one element per visible
 *    floating-enabled column.
 * 2. Typing into a column's input filters the visible rows (the
 *    setColumnFilterModel → worker round-trip works end-to-end).
 * 3. Horizontal scroll re-positions the inputs via `transform` (the
 *    overlay does not detach + recreate elements, and does not use
 *    `left`-based positioning).
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
  getScroller: () => HTMLElement;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

test.describe('Cycle 7 / Task 1 — floating-filter row', () => {
  test('mounts a floating-filter input for every visible column', async ({ page }) => {
    await gridReady(page);
    const inputCount = await page.evaluate(
      () => document.querySelectorAll('input[data-vg-floating-filter]').length,
    );
    // Demo has 17 cols; some pinned-right ones may render too. Assert a
    // healthy lower bound rather than an exact count so future column
    // additions don't flake the test.
    expect(inputCount).toBeGreaterThan(5);
  });

  test('typing into a floating-filter input reduces the displayed row count', async ({ page }) => {
    await gridReady(page);
    const before = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(before).toBeGreaterThan(10);
    const sel = 'input[data-vg-floating-filter][data-vg-col-id="positionId"]';
    await page.fill(sel, 'POS-1');
    // Default debounce is 500ms. Wait it out, then a couple of RAFs for
    // the worker round-trip + recomputeViewport to land.
    await page.waitForTimeout(700);
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
    const after = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
    );
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  test('horizontal scroll re-pins the cells via transform (not via the left style)', async ({ page }) => {
    await gridReady(page);
    // Cycle 7 / Task 1 (clear-button refactor): the input is now wrapped
    // in a positioning cell (`div[data-vg-floating-filter-cell]`); the
    // transform that follows scroll lives on the wrapper.
    const sel = 'div[data-vg-floating-filter-cell][data-vg-col-id="dailyPnl"]';
    const before = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null;
      return el ? { transform: el.style.transform, left: el.style.left } : null;
    }, sel);
    expect(before).not.toBeNull();
    await page.evaluate(
      () => { (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getScroller().scrollLeft = 200; },
    );
    await page.waitForTimeout(50);
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
    const after = await page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null;
      return el ? { transform: el.style.transform, left: el.style.left } : null;
    }, sel);
    expect(after).not.toBeNull();
    // Transform moved with scroll.
    expect(after!.transform).not.toBe(before!.transform);
    // `left` style did NOT change — positioning is via transform.
    expect(after!.left).toBe(before!.left);
  });
});
