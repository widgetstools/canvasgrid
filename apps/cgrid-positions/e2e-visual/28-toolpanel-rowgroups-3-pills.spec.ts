import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15.5 / Task 2 — Tool panel Row Groups drop zone baseline.
//
// Mounts the demo with `?rowGroupPanel=threeChips` so the grid seeds a
// three-level grouping (`Ticker → Sector → Sub Sector`). With grouping
// active, the columns tool panel's Row Groups SECTION renders a live
// drop zone with one COMPACT pill per group level (vertically stacked
// per the Cycle 15.5 / Task 2 design pass). The screenshot captures
// the pills + the dashed outline + the section header — the third
// view over the same `rowGroupColumns` list the row group panel and
// header context menu mutate.
//
// What regression this catches:
//   - Pill rendering break: if `refreshRowGroupPills` stopped reading
//     `api.getRowGroupColumns()` (or the order broke), the pill stack
//     would mis-render and the baseline would catch the chrome change.
//   - Pill order break: pills must mirror nesting order. A regression
//     that reversed the order (or didn't honor it) would shift the
//     visible labels.
//   - Empty-state fallback: when grouping is on, the empty placeholder
//     ("Drag here to set row groups") MUST NOT render. A regression
//     that left the placeholder visible alongside the pills would
//     read as broken.
//   - `columnRowGroupChanged` subscription break: the zone renders
//     pills off the initial state via `init`. A regression that
//     deferred initial render until the first event would show an
//     empty zone instead of three pills.
//   - Compact-pill style drift: the tool-panel pills are a COMPACT
//     variant of the row group panel chip (no drag handle glyph, no
//     sort indicator, 11px font). A regression that copy-pasted the
//     panel chip styling would shift the silhouette.
//
// Test setup: 200 rows so the per-ticker `sector` + `subSector`
// derivations fully populate. The tool panel opens via
// `openToolPanel('agColumnsToolPanel')` so the sidebar host mounts
// the columns panel with the live drop zone.

test('tool panel — Row Groups drop zone with 3 pills', async ({ page }) => {
  await gridReadyWithQuery(page, '?rowGroupPanel=threeChips&totals=off');
  await seedGrid(page, 200);
  await waitForFrames(page, 12);

  await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: { openToolPanel: (id: string) => void };
    }).__cgrid;
    g.openToolPanel('agColumnsToolPanel');
  });
  await waitForFrames(page, 8);

  await expect(page).toHaveScreenshot('28-toolpanel-rowgroups-3-pills.png');
});
