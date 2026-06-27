import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 5 — `groupDisplayType: 'multipleColumns'` baseline.
// Mounts the demo grid grouped three levels deep (`ticker` → `sector`
// → `subSector`) via `?grouping=multipleColumns`. The three synthesized
// auto-group columns appear at the start of the visible-leaf order,
// each carrying chrome ONLY for group rows whose own depth matches the
// column's slot — column 1 lights up on depth-0 (Ticker) groups,
// column 2 on depth-1 (Sector) groups, column 3 on depth-2 (SubSector)
// groups, and every other cell stays blank.
//
// What regression this catches:
//   - Synthesis break: if `synthesizeAutoGroupColumns` stopped emitting
//     N columns for `'multipleColumns'` (e.g. fell back to the single-
//     column path), the baseline would lose two auto-group columns and
//     the rest of the layout would shift left.
//   - Own-depth filter regression: if the `'group'` renderer's
//     `params.groupColumnDepth` filter inverted (paints chrome when
//     depth DOES NOT match), every column would paint chevron + value
//     on every group row, and the three columns would read identically
//     instead of stacking levels.
//   - Indent rule break: multipleColumns pins indent to 0 within each
//     column (the column ORDER carries the hierarchy). A regression
//     that fell back to `depth × 14px` would push the depth-2 chevron
//     ~28px right inside its column, breaking the column-aligned
//     vertical chevron stack.
//   - Per-level `cellRendererParams.groupColumnDepth` lookup regression:
//     if `synthesizeAutoGroupColumns` stopped tagging each column with
//     its depth slot, the renderer's filter would silently fail open
//     (own-depth would always look up `null` and paint chrome on every
//     row, falling back to the singleColumn rule), and the screenshot
//     would look like three identical singleColumn views stacked
//     side-by-side.
//   - Chunk format / cellAt break: if `cellAt` stopped recognizing the
//     per-level colIds (`ag-Grid-AutoColumn-0`, `-1`, `-2`) as auto-
//     group columns via `isAutoGroupColumnId`, the painter would route
//     to the standard numeric/text reader and the cells would render
//     empty strings.
//
// Test setup: 200 deterministic rows seeded via `seedGrid` so the
// per-ticker `sector` + `subSector` maps fully populate. The
// rowGroupCols `['ticker', 'sector', 'subSector']` produces a 3-level
// tree; with every group expanded (Task 9 ships
// `groupDefaultExpanded`; for now every group is expanded), the
// baseline shows top-level Ticker rows interleaved with their nested
// Sector rows and SubSector rows + the leaf data rows underneath.
// `totals=off` keeps the body free of the synthesis-row chrome from
// Cycle 14 so the diff isolates the multipleColumns auto-group columns.

test('multipleColumns — three-level grouping (Ticker → Sector → SubSector)', async ({ page }) => {
  await gridReadyWithQuery(page, '?grouping=multipleColumns&totals=off');
  await seedGrid(page, 200);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('21-group-three-level-multipleColumns.png');
});
