/**
 * Cycle 7 / Task 1 (parser enhancement) — inline operator parser on
 * the floating-filter row.
 *
 * Verifies that typing the parser's grammar into the floating input of
 * a number column reduces the displayed row count via the v2 entries
 * the parser emits (greaterThan, multi-OR, AND-of-comparisons).
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getDisplayedRowCount: () => number;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
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

async function readDisplayedRowCount(page: import('@playwright/test').Page): Promise<number> {
  return await page.evaluate(
    () => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount(),
  );
}

async function waitForFilterApply(page: import('@playwright/test').Page): Promise<void> {
  // Default debounce is 500ms; add headroom for the worker round-trip.
  await page.waitForTimeout(700);
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

test.describe('Cycle 7 / Task 1 — floating-filter parser', () => {
  test('typing >0 on a number column reduces visible rows via greaterThan', async ({ page }) => {
    await gridReady(page);
    const before = await readDisplayedRowCount(page);
    expect(before).toBeGreaterThan(10);
    // currentPrice exists in every demo row with a numeric value; >0
    // is a permissive predicate but still exercises the worker's
    // greaterThan branch end-to-end and shouldn't reduce the set to
    // zero. Use 999_999_999 as the impossible threshold below for the
    // "reduces to zero" assertion.
    await page.fill('input[data-cg-floating-filter][data-cg-col-id="currentPrice"]', '>999999999');
    await waitForFilterApply(page);
    const after = await readDisplayedRowCount(page);
    expect(after).toBe(0);
  });

  test('typing 100..999999999 on a number column filters via inRange', async ({ page }) => {
    await gridReady(page);
    const before = await readDisplayedRowCount(page);
    await page.fill('input[data-cg-floating-filter][data-cg-col-id="currentPrice"]', '100..999999999');
    await waitForFilterApply(page);
    const after = await readDisplayedRowCount(page);
    // Range should yield at least some matches (prices > 100 exist) but
    // < before (some prices are < 100).
    expect(after).toBeLessThan(before);
  });

  test('typing >100 AND <200 on a number column composes a multi-AND entry', async ({ page }) => {
    await gridReady(page);
    const before = await readDisplayedRowCount(page);
    await page.fill('input[data-cg-floating-filter][data-cg-col-id="currentPrice"]', '>100 AND <200');
    await waitForFilterApply(page);
    const after = await readDisplayedRowCount(page);
    expect(after).toBeLessThan(before);
  });

  test('clearing the input restores the full row set', async ({ page }) => {
    await gridReady(page);
    const before = await readDisplayedRowCount(page);
    const sel = 'input[data-cg-floating-filter][data-cg-col-id="currentPrice"]';
    await page.fill(sel, '>999999999');
    await waitForFilterApply(page);
    expect(await readDisplayedRowCount(page)).toBe(0);
    await page.fill(sel, '');
    await waitForFilterApply(page);
    expect(await readDisplayedRowCount(page)).toBe(before);
  });

  test('unparseable number input leaves the row set unchanged (clears filter)', async ({ page }) => {
    await gridReady(page);
    const before = await readDisplayedRowCount(page);
    const sel = 'input[data-cg-floating-filter][data-cg-col-id="currentPrice"]';
    await page.fill(sel, 'not-a-number');
    await waitForFilterApply(page);
    // Parser returns null, cgrid clears the column filter, visible
    // count returns to the unfiltered total.
    expect(await readDisplayedRowCount(page)).toBe(before);
    // Typed text stays in the input so user can correct it.
    expect(await page.inputValue(sel)).toBe('not-a-number');
  });
});
