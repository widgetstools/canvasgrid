import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 6 — three-chip row group panel baseline.
// Mounts the demo with `?rowGroupPanel=threeChips` so the row group
// panel sits pre-populated with `Ticker → Sector → Sub Sector` chips,
// matching the reference screenshot
// (`docs/catalog/screenshots/09-grouping-three-level-expanded.png`)
// top strip. The auto-group column also synthesizes since
// `setGroupModel` activates the standard grouping pipeline; the test
// pins the panel layer (chips + separators + outline) alongside the
// resulting grouped body.
//
// What regression this catches:
//   - Chip-strip ordering break: if `RowGroupPanelHost.setRowGroupCols`
//     stopped honouring the array order, the chips would render in an
//     arbitrary order and the user would no longer read the chip strip
//     as nesting order.
//   - `›` separator break: if the chip-to-chip separator stopped
//     painting (or rendered the wrong glyph), the baseline would catch
//     the typography drift directly. The screenshot includes two
//     separators for three chips.
//   - Chip shape regression: outlined-chip vocabulary (1px border,
//     transparent bg, 4px radius) is the Task 6 visual signature. A
//     regression to filled pills, larger radii, or a different border
//     colour would shift the chip's silhouette and the baseline would
//     fail.
//   - Header-name lookup regression: chips read column header names
//     via `ctx.getHeaderName`. A regression that fell back to colId
//     would render `ticker / sector / subSector` instead of `Ticker /
//     Sector / Sub Sector` — the screenshot pins the formatted
//     header-name path.
//   - Drag-handle glyph drift: chips paint `≡` (U+2261) as the
//     drag-handle glyph. A regression to `☰` (U+2630) or `⋮` would
//     shift the affordance's silhouette.
//   - `×` remove-button paint regression: each chip ends with the
//     `✕` (U+2715) glyph. If the button collapsed (e.g. visibility
//     hidden by a regression), the chip's right edge would lose its
//     "click to remove" affordance.
//
// Test setup: 200 deterministic rows so the per-ticker `sector` +
// `subSector` maps fully populate (matches visual cell 21's seed
// count). The chips render at the top strip; the body's auto-group
// column shows the leftmost depth-0 (`Ticker`) groups under the
// synthesized 'Group' column.

test('row group panel — three chips (Ticker → Sector → Sub Sector)', async ({ page }) => {
  await gridReadyWithQuery(page, '?rowGroupPanel=threeChips&totals=off');
  await seedGrid(page, 200);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('23-rowGroupPanel-three-chips.png');
});
