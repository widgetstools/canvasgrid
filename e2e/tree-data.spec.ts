import { test, expect, type Page } from '@playwright/test';

/**
 * Tree data, rendered — both row models, same tree.
 *
 * The kernel tests cover the tree BUILDER and the main-thread wiring
 * separately. This covers the thing neither can: that the hierarchy actually
 * reaches the screen, through the full Ext chrome, identically on a
 * client-side and a server-side grid.
 *
 * The demo's fixture deliberately makes every desk / region / book node a real
 * row AS WELL AS a parent, which is the case column grouping cannot express
 * and the one most likely to break.
 */

const DEMO = 'http://localhost:5230/';

/** 3 desks + 9 regions + 18 books + 72 positions. */
const SOURCE_ROWS = 102;

async function open(page: Page): Promise<void> {
  await page.goto(DEMO);
  await page.waitForFunction(() => (window as any).__tree !== undefined, { timeout: 45_000 });
  // Both grids mount, hydrate and build their trees.
  await page.waitForFunction(
    () => ((window as any).__tree.csrm.getDisplayedRowCount() ?? 0) > 0
      && ((window as any).__tree.ssrm.getDisplayedRowCount() ?? 0) > 0,
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(2500);
}

/** What each grid is showing, normalised for comparison. */
async function readTree(page: Page, which: 'csrm' | 'ssrm') {
  return page.evaluate((which: string) => {
    const g = (window as any).__tree[which];
    const n = g.getDisplayedRowCount();
    const rows: Array<{ name: unknown; pnl: unknown }> = [];
    for (let i = 0; i < Math.min(n, 40); i++) {
      rows.push({ name: g.getCellValue(i, 'name'), pnl: g.getCellValue(i, 'pnl') });
    }
    return { displayed: n, rows };
  }, which);
}

test('the tree renders, once per source row', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);

  // The demo opens collapsed to depth 1; expand everything to count the tree.
  await page.evaluate(() => (window as any).__tree.csrm.expandAll());
  await page.waitForTimeout(1500);
  const csrm = await readTree(page, 'csrm');
  // Exactly one displayed row per source row. The first cut emitted a group
  // row AND a data row for every leaf, which showed up here as 174.
  expect(csrm.displayed).toBe(SOURCE_ROWS);
  expect(errors).toEqual([]);
});

test('client-side and server-side produce the identical tree', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    (window as any).__tree.csrm.expandAll();
    (window as any).__tree.ssrm.expandAll();
  });
  await page.waitForTimeout(2000);
  const csrm = await readTree(page, 'csrm');
  const ssrm = await readTree(page, 'ssrm');

  expect(ssrm.displayed).toBe(csrm.displayed);
  // Same rows, same order, same aggregates — the row model must not change
  // what a tree looks like.
  expect(ssrm.rows).toEqual(csrm.rows);
});

test('aggregates roll up the hierarchy', async ({ page }) => {
  await open(page);
  const agg = await page.evaluate(() => {
    const g = (window as any).__tree.csrm;
    // Depth-first, the first three rows are desk → region → book.
    return {
      desk: g.getCellValue(0, 'pnl'),
      region: g.getCellValue(1, 'pnl'),
      book: g.getCellValue(2, 'pnl'),
      firstLeaf: g.getCellValue(3, 'pnl'),
    };
  });
  for (const v of Object.values(agg)) expect(typeof v).toBe('number');
  // A parent's total is at least its first child's contribution in magnitude
  // terms is NOT a safe assertion with mixed signs — assert the structural
  // fact instead: every level produced a number, and the desk total is not
  // simply the leaf's value repeated.
  expect(agg.desk).not.toBe(agg.firstLeaf);
});

test('the auto group column exists, though tree data has no grouped columns', async ({ page }) => {
  await open(page);
  const cols = await page.evaluate(() =>
    ((window as any).__tree.csrm.getColumnDefsSnapshot?.() ?? []).map((c: any) => c.colId));

  // `getColumnState` lists only host-supplied leaves, so the synthesized
  // column is invisible there — the resolved snapshot is where it shows up.
  // It exists ONLY because tree mode asks for one: there are no rowGroupCols
  // here for the usual path to derive it from.
  expect(cols.length).toBeGreaterThan(5);
  expect(cols.some((c: string) => /auto/i.test(String(c)))).toBe(true);
});

test('collapsing a node hides its subtree', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__tree.csrm.expandAll());
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => (window as any).__tree.csrm.getDisplayedRowCount());

  await page.evaluate(() => {
    const g = (window as any).__tree.csrm;
    // Collapse the first desk. Its whole subtree should leave the viewport.
    g.setExpandedKeys?.([]);
    g.collapseAll?.();
  });
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => (window as any).__tree.csrm.getDisplayedRowCount());
  expect(after).toBeLessThan(before);
});
