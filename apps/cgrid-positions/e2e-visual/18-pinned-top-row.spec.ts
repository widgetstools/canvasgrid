import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 14 / Task 2 — PinnedRowsSubgrid baseline. Mounts a sample
// "Index Benchmark" pinned-top reference row via `?pinned=top`. The
// row sits between the header band and the scrollable data; its
// numeric columns render through each column's normal valueFormatter
// (e.g. the moneyFormatter on marketValue) so the values read in the
// same vocabulary as data rows.
//
// What regression this catches:
//   - Stack-order regression: if `rebuildSubgridStack` stopped pushing
//     the pinned-top subgrid BEFORE the data subgrid (or if computeViewport's
//     pre-data band classification regressed), the pinned row would
//     either disappear or land at the bottom. The baseline pins the
//     row at the top — a y-shift would diff the body-band offset.
//   - Tint regression: if the row-bg pass stopped picking
//     `theme.pinnedRowBg` for `isPinned` rows, the row would paint
//     with `theme.bg` (vanishing — reads as data) or `theme.totalsBg`
//     (slate — wrong cognitive cue). The warm 3% tint is the
//     temperature contrast the design plan calls out; either flip
//     diffs the row's fill.
//   - Structural-border regression: if the gridLinesPainter stopped
//     painting `theme.pinnedRowBorder` at the bottom of the pinned
//     stack (the data-side edge), the row would bleed into the data
//     band without a hairline boundary. The diff catches the missing
//     1px slate rule below the pinned row.
//   - Weight regression: if a future refactor accidentally wired the
//     totals weight bump to pinned rows (e.g. by reusing `isTotals`
//     as a generic "lift" flag), the values would render at weight
//     500 instead of body 400. The baseline at 400 catches the
//     mistake — the trader's "synthesis" cue (weight) must stay
//     totals-only.
//   - Value-path regression: if `byRows.ts` stopped reading
//     `row.subgrid.getCell(...)` for `isPinned` rows, the values
//     would all render empty (just chrome). The diff catches the
//     missing $25,000,000.00 in marketValue / $50,000 in notional.
//
// Test setup: 50 deterministic rows (same `seedGrid` generator the
// other matrix cells use) + `?pinned=top`. Single pinned row
// ("BENCHMARK") with flat reference numbers a trader scans against.
// No selection, no range. Default theme (light) so the diff covers
// the canonical warm-tint colour.
test('pinned-top row — warm tint, body weight, values across width', async ({ page }) => {
  await gridReadyWithQuery(page, '?pinned=top');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('18-pinned-top-row.png');
});
