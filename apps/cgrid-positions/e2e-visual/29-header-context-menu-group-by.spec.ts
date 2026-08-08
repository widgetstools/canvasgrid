import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15.5 / Task 2 — header context menu "Group by" item baseline.
//
// Mounts the demo with `?rowGroupPanel=empty` so the `ticker` column
// carries `enableRowGroup: true` (the demo's existing wiring opts in
// when any rowGroupPanel mode is on) WITHOUT any active grouping. A
// right-click on the `ticker` header opens the main menu — the
// snapshot captures the menu with the Cycle 15.5 / Task 2 group
// section appended at the end: a separator, then "Group by Ticker"
// (and no Un-Group or Expand/Collapse items, since grouping is
// inactive).
//
// What regression this catches:
//   - Group section ordering: the group items live AFTER the column-
//     ops items (Pin / Autosize / Reset). A regression that mixed
//     the two blocks (or put group items above Pin Column) would
//     shift the menu order and break the user's positional muscle
//     memory.
//   - Visibility predicate break: "Group by" should ONLY render
//     when `enableRowGroup === true` AND the column is not already
//     grouped. A regression that always showed the item (regardless
//     of `enableRowGroup`) or that swapped the predicate would
//     change the menu's contents.
//   - Trailing separator anti-pattern: when at least one group item
//     is visible, a separator precedes the group block; when ALL
//     four are hidden, the separator is OMITTED. A regression
//     adding a dangling separator (or omitting the needed one)
//     would shift the menu's footprint.
//   - Icon-family drift: `Group by` uses `☰` (U+2630 TRIGRAM FOR
//     HEAVEN) per the design plan — same family as the Cycle 11
//     sidebar Row Groups SECTION header. A regression to a folder
//     glyph or a plus sign would break the cross-surface icon
//     vocabulary.
//   - Label format drift: "Group by Ticker" (with the resolved
//     headerName, not the raw colId). A regression to "Group by
//     ticker" would catch a lookup-fallback regression.
//
// Test setup: 50 rows (small enough that the menu doesn't get
// occluded by body content). The right-click lands on the `ticker`
// header — the demo's only consistently `enableRowGroup`-flagged
// column when no other grouping mode is on. The menu is centered
// near the click; the screenshot pins the menu's contents +
// silhouette.

test('header context menu — Group by Ticker (groupable, not grouped)', async ({ page }) => {
  await gridReadyWithQuery(page, '?rowGroupPanel=empty&totals=off');
  await seedGrid(page, 50);
  await waitForFrames(page, 8);

  const bounds = await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: {
        getHeaderBoundsAt: (c: string) => { x: number; y: number; w: number; h: number } | null;
      };
    }).__cgrid;
    return g.getHeaderBoundsAt('ticker');
  });
  if (!bounds) throw new Error('header bounds for ticker not available');

  const canvasBox = await page.locator('#grid canvas').boundingBox();
  if (!canvasBox) throw new Error('canvas bounding box not available');

  await page.mouse.click(
    canvasBox.x + bounds.x + bounds.w / 2,
    canvasBox.y + bounds.y + bounds.h / 2,
    { button: 'right' },
  );

  await page.waitForSelector('.vg-context-menu', { state: 'visible' });
  await waitForFrames(page, 6);

  await expect(page).toHaveScreenshot('29-header-context-menu-group-by.png');
});
