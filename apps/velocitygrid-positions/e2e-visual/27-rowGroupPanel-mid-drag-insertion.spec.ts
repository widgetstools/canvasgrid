import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15.5 / Task 1 — mid-drag insertion-line + drag-ghost baseline.
//
// Mounts the demo with `?rowGroupPanel=threeChips` so three pills
// (`Ticker → Sector → Sub Sector`) sit in the panel, then drives a
// pointerdown on the last pill (Sub Sector) and a pointermove that
// crosses the 4 px threshold AND parks the pointer between pills 1
// and 2 (at the gap between `Ticker` and `Sector`). The screenshot
// captures the panel mid-flight: the live vertical insertion line
// painted at the gap, the floating drag ghost following the cursor,
// and the source pill at rest in its original position.
//
// What regression this catches:
//   - Insertion-line paint drift: if the line's color drifted away
//     from `--vg-row-group-panel-drop-border` (focus-ring), or its
//     width changed, the baseline would catch the chrome change.
//   - Insertion-line snap-algorithm regression: the line MUST land at
//     the gap nearest the pointer. A regression that snapped to the
//     wrong gap (e.g. always snapped to the trailing edge) would
//     shift the line off the expected position.
//   - Ghost mount regression: if `mountGhost` failed to clone the
//     source chip + position it `(+8, +8)` from the cursor, the
//     ghost would be missing or misplaced.
//   - Ghost-vs-source double-paint regression: the SOURCE chip must
//     stay in its place during the drag (Task 1 doesn't visually
//     remove the source during the drag — that's a deliberate
//     decision; the user reads the original-position chip as "from"
//     and the ghost as "to"). A regression that hid the source
//     pill mid-drag would lose that read.
//
// Test setup: 200 deterministic rows so the chips' header names
// fully populate (matches visual cell 23 seed count). The drag is
// driven via `__cgridPlaywright.pillReorderMidDrag` — a tiny
// playwright-only helper that dispatches the pointerdown / pointermove
// sequence the row group panel host listens to. The helper is wired
// in `apps/velocitygrid-positions/src/positionsGrid.ts` next to the existing
// drag harness.

test('row group panel — mid-drag insertion line + ghost', async ({ page }) => {
  await gridReadyWithQuery(page, '?rowGroupPanel=threeChips&totals=off');
  await seedGrid(page, 200);
  await waitForFrames(page, 12);

  // Drive the pointerdown + pointermove sequence directly on the
  // panel via window.__cgridPlaywright so the screenshot captures
  // the panel mid-drag (the ghost mounts on document.body, the
  // insertion line mounts inside the panel).
  await page.evaluate(() => {
    const w = window as unknown as {
      __cgridPlaywright?: { pillReorderMidDrag: () => void };
    };
    if (!w.__cgridPlaywright) {
      throw new Error('__cgridPlaywright harness missing (positionsGrid.ts)');
    }
    w.__cgridPlaywright.pillReorderMidDrag();
  });

  await waitForFrames(page, 4);
  await expect(page).toHaveScreenshot('27-rowGroupPanel-mid-drag-insertion.png');
});
