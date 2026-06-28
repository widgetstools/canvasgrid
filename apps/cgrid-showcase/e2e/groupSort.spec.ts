import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

// Per-level group sort: setRowGroupColumnSort(colId, dir) must actually
// re-order the groups (not just paint a decorative pill chevron). The
// worker's SortPass.applyGrouped sorts each group level by the sort entry
// targeting that level's grouping column.
//
// Seed desks are ['APAC','EMEA','AMER','LATAM'] → default composite-key
// asc order puts AMER first; desc puts LATAM first.

async function firstGroupKey(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => (window.__cgrid as any).getGroupKeyAtRow(0) as string);
}

/** Poll getGroupKeyAtRow(0) until it contains `needle` (the worker re-sort
 *  is async via setSortModel → round-trip → requestViewport). */
async function waitForFirstGroup(page: import('@playwright/test').Page, needle: string): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const k = (window.__cgrid as any)?.getGroupKeyAtRow?.(0) as string | undefined;
      return typeof k === 'string' && k.includes(n);
    },
    needle,
    { timeout: 5_000 },
  );
}

test.describe('groupSort feature — per-level group sort', () => {
  test('loads grouped by desk then ticker', async ({ page }) => {
    await gotoFeature(page, 'groupSort');
    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk', 'ticker']);
  });

  test('Desk ↓ reverses the top-level group order; Desk ↑ restores it', async ({ page }) => {
    await gotoFeature(page, 'groupSort');

    // Default composite-key asc → AMER is the first top-level group.
    await waitForFirstGroup(page, 'AMER');
    expect(await firstGroupKey(page)).toContain('AMER');

    // Desk ↓ → descending → LATAM first.
    await page.getByRole('button', { name: /Desk ↓/ }).click();
    await waitForFirstGroup(page, 'LATAM');
    expect(await firstGroupKey(page)).toContain('LATAM');

    // Desk ↑ → ascending again → AMER first.
    await page.getByRole('button', { name: /Desk ↑/ }).click();
    await waitForFirstGroup(page, 'AMER');
    expect(await firstGroupKey(page)).toContain('AMER');
  });

  test('Clear Sort returns to the default ascending group order', async ({ page }) => {
    await gotoFeature(page, 'groupSort');

    // Flip to desc first.
    await page.getByRole('button', { name: /Desk ↓/ }).click();
    await waitForFirstGroup(page, 'LATAM');

    // Clear → back to default asc (AMER first). `exact` avoids colliding
    // with the row group panel pill chevron's "Clear sort on Desk" aria-label.
    await page.getByRole('button', { name: 'Clear Sort', exact: true }).click();
    await waitForFirstGroup(page, 'AMER');
    expect(await firstGroupKey(page)).toContain('AMER');
  });
});
