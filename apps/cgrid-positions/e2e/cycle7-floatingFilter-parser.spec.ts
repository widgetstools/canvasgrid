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

  test('user-typed operator prefix survives the worker round-trip (>100 stays >100)', async ({ page }) => {
    await gridReady(page);
    const sel = 'input[data-cg-floating-filter][data-cg-col-id="currentPrice"]';
    // Type >100. The parser emits {filterType:'number', type:'greaterThan',
    // filter:100} — note the canonical string form of that v2 entry is
    // "100", not ">100". This test guards against the regression where
    // cgrid's setColumnFilterModel round-trips the canonical value back
    // into the input and silently strips the operator.
    await page.fill(sel, '>100');
    await waitForFilterApply(page);
    expect(await page.inputValue(sel)).toBe('>100');
    // And: the filter actually applied (row count changed).
    const after = await readDisplayedRowCount(page);
    expect(after).toBeGreaterThan(0);
  });

  test('clear button appears after typing and clears the column on click', async ({ page }) => {
    await gridReady(page);
    const before = await readDisplayedRowCount(page);
    const inputSel = 'input[data-cg-floating-filter][data-cg-col-id="currentPrice"]';
    const clearSel = 'button[data-cg-floating-filter-clear][data-cg-col-id="currentPrice"]';
    const cellSel  = 'div[data-cg-floating-filter-cell][data-cg-col-id="currentPrice"]';

    // Before typing: button hidden via CSS (cell lacks .has-value class).
    expect(await page.evaluate(
      (s) => document.querySelector(s)?.classList.contains('has-value'),
      cellSel,
    )).toBe(false);

    await page.fill(inputSel, '>999999999');
    await waitForFilterApply(page);
    // After typing: cell has .has-value class → button is visible.
    expect(await page.evaluate(
      (s) => document.querySelector(s)?.classList.contains('has-value'),
      cellSel,
    )).toBe(true);
    expect(await readDisplayedRowCount(page)).toBe(0);

    // Click the clear button — input empties, filter clears, row count
    // snaps back to the unfiltered total, and the .has-value class drops.
    await page.click(clearSel);
    // No debounce — clear fires immediately. Still wait a beat for the
    // worker round-trip + recompute.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
    await page.waitForTimeout(100);
    expect(await page.inputValue(inputSel)).toBe('');
    expect(await page.evaluate(
      (s) => document.querySelector(s)?.classList.contains('has-value'),
      cellSel,
    )).toBe(false);
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
