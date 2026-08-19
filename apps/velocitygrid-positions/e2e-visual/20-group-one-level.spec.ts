import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 4 — auto-group column + `'group'` cell renderer
// baseline. Mounts the demo grid grouped by `ticker` (one level) via
// `?grouping=ticker`. The auto-group column synthesizes at index 0 of
// the visible-leaf order and paints chevron + indent + value +
// `(count)` for every visible group row.
//
// What regression this catches:
//   - Column-order break: if `computeVisibleColumnOrder` stopped
//     prepending the auto-group column when grouping is active, the
//     baseline would lose its leftmost column entirely and the rest
//     of the header / body would shift left.
//   - Renderer registration break: if the `'group'` renderer dropped
//     out of `CellRendererRegistry`, the painter would fall back to
//     the default text renderer and the group cells would paint
//     plain stringified payload objects ("[object Object]") instead
//     of chevron + value.
//   - Chevron glyph regression: if `chevron-right` / `chevron-down`
//     paths drifted or the icon scale changed, the chevron pixel
//     footprint would diff. The painter draws ZERO chevrons on data
//     rows; if a refactor flipped the `rowKind !== 1` gate, every
//     data row would paint a stray chevron and the diff would catch
//     it.
//   - Indent / spacing regression: the design plan locks indent at
//     one chevron-width per depth, chevron→value gap at 6px,
//     value→count gap at 4px. Any spacing drift surfaces here.
//   - Count formatting regression: the suffix is `(N)` with
//     `toLocaleString()`; if a refactor dropped the parens or
//     swapped to raw `String(n)` the baseline would diff.
//   - Chunk plumbing break: if `cellAt` stopped returning the
//     synthesized GroupCellValue payload for the auto-group column
//     id, the renderer would receive a plain string and short-
//     circuit, leaving every group cell blank.
//
// Test setup: 100 deterministic rows (same `seedGrid` generator the
// other matrix cells use) seeded across 20 tickers (`AAPL`, `MSFT`,
// `GOOG`, …). Worker GroupPass builds the tree synchronously on the
// first viewport request after `setGroupModel`; the viewport slicer
// (Task 2) walks the flat order producing group rows interleaved
// with data rows. With every group expanded (the default — Task 9
// will ship `groupDefaultExpanded`; for now the worker emits every
// group expanded), the baseline shows 20 group rows + 100 data rows
// across the body, with the first ~15 rows visible at scrollTop=0.
//
// No status bar, no pinned rows, no totals row — every other surface
// off so the diff isolates the auto-group column chrome.

test('auto-group column — one-level grouping by ticker, every group expanded', async ({ page }) => {
  await gridReadyWithQuery(page, '?grouping=ticker&totals=off');
  await seedGrid(page, 100);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('20-group-one-level.png');
});
