import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 14 / Task 1 — TotalsSubgrid baseline. Mounts the pinned grand-
// totals row at the bottom of the grid body via `?totals=bottom`. The
// demo's columns carry `aggFunc` declarations on every P&L / valuation
// numeric (notional, marketValue, currentPrice, pnl, dailyPnl,
// unrealizedPnl, yield, spread, dv01, pv01), so the totals row reads
// with values across the visible width.
//
// What regression this catches:
//   - Subgrid math break: if `computeViewport` stopped honouring stack
//     order for totals (or the post-data pass stopped firing), the
//     row would disappear and the diff would catch the empty space at
//     the body bottom going back to body bg.
//   - Chrome regression: if the row-bg pass stopped picking
//     `theme.totalsBg` for `isTotals` rows, the row would paint with
//     `theme.headerBg` (loud) or `theme.bg` (vanishing). The 3%-tint
//     "lift" is the signature; either flip would diff the bottom row's
//     fill.
//   - Top-border regression: if `gridLinesPainter` stopped painting
//     the 1px `theme.totalsBorderTop` rule at `Math.round(row.top) - 1`,
//     the row would lose its single visual lift and the diff would
//     catch the missing pixel-row above the totals.
//   - Body↔totals scroll inversion: if a refactor made the totals row
//     a data subgrid (e.g. `isData: true` instead of `isTotals`), the
//     row would scroll with the data and the baseline at scrollTop=0
//     would still match — but `firstRow`/`lastRow` would shift. We
//     anchor at scrollTop=0 here; cells 11–13 (deeper scroll) already
//     catch that regression for the data subgrid.
//   - Value path regression: if `byRows.ts` stopped reading
//     `row.subgrid.getCell(...)` for `isTotals` rows, the row would
//     render empty (no values, just chrome). The diff catches the
//     missing right-aligned numerics in the totals row.
//
// Test setup: 50 deterministic rows (same `seedGrid` generator every
// other matrix cell uses) + `?totals=bottom`. ZERO selection,
// ZERO range — the totals row reads grand totals computed by the
// worker's AggPass, which fires automatically on the first viewport
// chunk. No status bar (default demo without `?statusBar=...`) so the
// body bottom is owned by the totals row alone — the diff isolates the
// totals chrome from the status-bar regression cells (14–16).
//
// Baseline note: this cell ships the SUBGRID CHROME from Task 1's
// `tokens.css` change (top border + reserved row height + tint + value
// renderer falling back to the column's default cellRenderer for raw
// values). Cycle 14 / Task 5 re-baselines this cell against the
// polished `'totals'` cell renderer (em-dash placeholder, per-column
// halign-from-data overrides). The PR title at that point gets
// `[visual-baseline-update]`; this PR is `[visual-baseline-new]`.
test('totals row — pinned at bottom of grid body, values across width', async ({ page }) => {
  await gridReadyWithQuery(page, '?totals=bottom');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('17-totals-row-bottom.png');
});
