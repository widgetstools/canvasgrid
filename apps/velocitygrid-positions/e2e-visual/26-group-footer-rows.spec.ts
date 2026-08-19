import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 12 — group footer rows + grand-total footer baseline.
// Mounts the demo grouped by `ticker` (one level) with the per-group
// footer rows AND the grand-total footer enabled via
// `?grouping=ticker&groupIncludeFooter=1&groupIncludeTotalFooter=1`.
// Seeds 100 deterministic rows. The body reads as group → child rows
// → footer → group → child rows → footer → … → grand-total footer at
// the very end.
//
// Each footer row carries the totals signature ("hairline lift") —
// `--vg-group-footer-bg` tint + `--vg-group-footer-border-top` rule +
// `--vg-group-footer-font-weight` bump — making it visually identical
// to the grand-total row (same stripe). The label in the auto-group
// cell says `Total ${groupValue}` at the parent group's depth indent;
// the grand-total footer says just `Total` at depth 0. Distinguishing
// per-group footers from the grand total relies on label + position,
// not on chrome weight — per the design plan's "label + position
// differentiation" rule.
//
// What regression this catches:
//   - Footer emission break: if `GroupPass.apply` stopped honoring
//     `includeFooter` (or `SortPass.applyGrouped` stripped the footer
//     entries during the rebuild), the body would lose every footer
//     row and the diff would catch the missing stripes.
//   - Per-group totals computation drift: `AggPass.applyGroups` walks
//     the tree computing per-group sums; a regression here (off-by-one
//     in a leaf bucket, ancestor not aggregated, custom func dispatch
//     dropped) would shift the rendered numbers on every footer row.
//   - Renderer bind regression: footers route through the new
//     `'groupFooter'` cell renderer. If a future refactor dropped the
//     registry registration the painter would fall back to the default
//     text renderer and footer cells would paint `[object Object]`
//     instead of formatted values.
//   - Token bind regression: `theme.groupFooterBg` /
//     `groupFooterBorderTop` / `groupFooterFontWeight` resolve from
//     `--vg-group-footer-*`. If the painter started reading directly
//     from `--vg-totals-*`, an app override that scoped the per-group
//     family without touching the grand-total family would silently
//     no-op — the baseline catches the un-scoped read.
//   - Label / indent regression: per-group footers paint at parent
//     depth × indent; grand-total at depth 0. A drift would shift the
//     "Total APAC" / "Total" labels horizontally — caught by the diff.
//
// No status bar, no pinned rows, no other surfaces enabled — every
// other chrome off so the diff isolates the footer-row surface.

test('group footer rows — per-group + grand-total footers, one-level grouping by ticker', async ({ page }) => {
  await gridReadyWithQuery(page, '?grouping=ticker&totals=off&groupIncludeFooter=1&groupIncludeTotalFooter=1');
  await seedGrid(page, 100);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('26-group-footer-rows.png');
});
