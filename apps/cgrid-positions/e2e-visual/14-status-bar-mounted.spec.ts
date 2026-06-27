import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 13 / Task 1 — status-bar host scaffold. Visual baseline for the
// empty bar (no panels yet — Tasks 2 + 3 add the count + agg panels).
//
// What regression this catches:
//   - Bar chrome disappearing (border-top, --cg-header-bg tint, 28px
//     height) — any of these slipping breaks the "shelf below the body"
//     read and reverts the bar to a slapped-together `<div>`. Per the
//     design notes, a transparent/unstyled bar fails the task acceptance
//     criterion regardless of pixel-diff result.
//   - Canvas drawable area NOT shrinking to make room for the bar — if
//     the body still paints all the way to the bottom edge, the
//     reserveStatusBarSpace plumbing is broken.
//   - Editor overlay / scroller not respecting the bottom inset.
//
// Test setup: seed 50 deterministic rows (same as the rest of the matrix)
// + opt into the empty status bar via the `?statusBar=mounted` query
// flag. Settle 12 rAF frames so the canvas re-fits to the inset region.
test('status bar — mounted, empty (no panels)', async ({ page }) => {
  await gridReadyWithQuery(page, '?statusBar=mounted');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('14-status-bar-mounted.png');
});
