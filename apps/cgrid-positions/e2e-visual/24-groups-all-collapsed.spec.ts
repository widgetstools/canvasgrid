import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 7 — group expand / collapse interaction baseline.
// Mounts the demo grouped by `ticker` (one level) via
// `?grouping=ticker`, seeds 100 rows, then calls the new
// `collapseAll()` API. Every chevron paints in the right-pointing
// (collapsed) state and the data rows underneath each group disappear.
// The 20 group rows + 0 data rows compress the body to a tight
// vertical strip; the chevron toggle on each group is the only
// affordance.
//
// What regression this catches:
//   - Worker handler break: if the `setExpandedKeys` handler stopped
//     honouring an empty-array `keys` payload (= "collapse all"), the
//     slicer would walk every flatOrder entry and the data rows
//     would reappear — the baseline would diff against ~120 visible
//     rows instead of 20.
//   - Slicer / meta-lookup divergence: the slicer drops collapsed
//     descendants by depth comparison; the meta-lookup paints
//     `isExpanded` per chevron. Both must read the same expandedKeys
//     set. A divergence ships chevrons in the wrong direction OR
//     leaks data rows under a collapsed group — the diff catches
//     either.
//   - Chunk `isExpanded` regression: the per-row Uint8Array carries
//     the expanded flag the renderer keys off. If the slicer
//     defaulted to `1` (expanded) for every row regardless of state,
//     every chevron would paint down-pointing even when collapsed.
//   - Auto-group column placement: the auto-group column still sits
//     at column index 0 in the collapsed view; if column-order
//     resolution drifted, the chevrons would shift columns.
//
// No status bar, no pinned rows, no totals — every other surface off
// so the diff isolates the collapsed-state chrome.

test('group expand/collapse — every group collapsed via api.collapseAll()', async ({ page }) => {
  await gridReadyWithQuery(page, '?grouping=ticker&totals=off');
  await seedGrid(page, 100);
  await waitForFrames(page, 12);
  // The mount lands with every group expanded (the default-all
  // sentinel). Drive collapseAll() through the imperative API the
  // chevron click also routes through and wait for the repaint.
  await page.evaluate(() => {
    const w = window as unknown as { __cgrid: { collapseAll: () => void } };
    w.__cgrid.collapseAll();
  });
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('24-groups-all-collapsed.png');
});
