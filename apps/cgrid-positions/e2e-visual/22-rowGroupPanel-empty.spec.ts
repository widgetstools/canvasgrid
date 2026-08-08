import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 6 — empty-state row group panel baseline.
// Mounts the demo with `?rowGroupPanel=empty` so the row group panel
// (`rowGroupPanelShow: 'always'`) sits ABOVE the column headers with
// NO chips, exposing the dashed empty-state placeholder reading
// "Drag here to set row groups" — verbatim from the Cycle 11 sidebar
// Columns panel.
//
// What regression this catches:
//   - Panel mount break: if `RowGroupPanelHost` stopped mounting when
//     `rowGroupPanelShow === 'always'`, the column header row would
//     shift up to the very top of the grid and the baseline's top 32px
//     would no longer show the strip.
//   - Empty-state vocabulary drift: if the placeholder text moved
//     away from the verbatim sidebar phrase ("Drag here to set row
//     groups" → "Drop columns here to group"), the diff would catch
//     the divergence so the cycle's drop-zone vocabulary stays
//     coherent.
//   - Top-inset regression: the panel's 32 px must combine with the
//     status bar's 0 px (no status bar in this cell) to push the
//     scroller / canvas down by exactly 32 px. A regression that
//     dropped the row group panel inset would overlap the strip with
//     the column header row.
//   - Dashed-border vocabulary drift: the placeholder shares its
//     dashed-border style with `.vg-columns-panel-drop-zone`; a
//     theme regression that changed only one of the two would break
//     the cycle's drop-zone visual continuity.
//   - Empty-state foreground colour drift: the placeholder text uses
//     `--vg-row-group-panel-empty-fg` (60% fg via color-mix). A
//     regression that left the text at full opacity would read it as
//     content rather than as a placeholder.
//
// Test setup: 50 deterministic rows seeded via `seedGrid`, no
// grouping active, no status bar — the only chrome under test is the
// row group panel itself + the column header row directly below it.

test('row group panel — empty state (Drag here to set row groups)', async ({ page }) => {
  await gridReadyWithQuery(page, '?rowGroupPanel=empty&totals=off');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('22-rowGroupPanel-empty.png');
});
