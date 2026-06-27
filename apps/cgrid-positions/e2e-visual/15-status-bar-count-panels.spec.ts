import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 13 / Task 2 — built-in count status panels. Visual baseline
// for the four count components (Total / Filtered / Selected /
// TotalAndFiltered) all mounted in the right zone.
//
// What regression this catches:
//   - Hierarchy collapse: if `--cg-status-bar-fg-muted` lost its 60%
//     alpha mix (or the label class dropped its color rule), label
//     and value would render at the same weight and the panels would
//     read as flat text rows — exactly the "labels and numbers
//     separated by spaces" anti-pattern the design notes warn
//     against.
//   - Inter-pair gap regression in agTotalAndFilteredRowCountComponent:
//     if the `--combined` modifier lost its `gap: 2ch` override, the
//     two label-value pairs would collapse to the base 1ch and read
//     as four loose tokens (`Total Rows: 200 Rows: 200`) instead of
//     two paired facts.
//   - Inter-panel gap regression: if the zone's
//     `--cg-status-bar-gap` (16px) shifted, panels would either
//     touch (looks broken) or sprawl across the bar (loses the
//     "right-loaded glance" pattern).
//   - en-US comma grouping vanishing: `Intl.NumberFormat('en-US')`
//     produces `3,000`; if a future change swapped in a different
//     formatter or dropped grouping, the rendered count would read
//     as `3000` and the screenshot diff would catch it.
//
// Test setup: seed 200 deterministic rows (same row generator as
// every other matrix cell) and mount the bar via `?statusBar=counts`.
// Settle 12 rAF frames so the canvas re-fits, the panels' init() has
// landed, and the modelUpdated event from the seed has propagated.
test('status bar — four built-in count panels in the right zone', async ({ page }) => {
  await gridReadyWithQuery(page, '?statusBar=counts');
  await seedGrid(page, 200);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('15-status-bar-count-panels.png');
});
