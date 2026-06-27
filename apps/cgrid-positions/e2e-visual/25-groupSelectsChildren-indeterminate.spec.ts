import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 15 / Task 8 — `groupSelectsChildren` tri-state checkbox
// baseline. Mounts the demo grouped by `ticker` (one level) with
// `groupSelectsChildren: true` via `?grouping=ticker&groupSelectsChildren=1`,
// seeds 50 deterministic rows, then selects exactly ONE leaf row
// belonging to the AAPL group (`POS-000000`). The AAPL group's
// auto-group cell paints the tri-state checkbox in the INDETERMINATE
// state (horizontal dash inside an outlined box) while every other
// group's checkbox stays empty (border-only).
//
// What regression this catches:
//   - Checkbox SHAPE regression: the design rule from
//     `cycle-15-grouping-design.md` § Task 8 is "differentiate by
//     SHAPE, not fill / colour". If a future refactor flipped to a
//     filled-blue check + filled-blue dash (the AI default the design
//     pass explicitly rejected), every selected group row would gain
//     row-level chrome that fights data rows below — the baseline
//     diff catches that drift on the AAPL group.
//   - Layout regression: the checkbox sits AFTER the chevron, BEFORE
//     the value text. Drifting it to the row left edge (the rejected
//     alternative) would shift every group's text rightward by ~20
//     px — caught by the baseline.
//   - Cascade computation drift: the tri-state state is computed in
//     the SelectionModel against the worker's descendant cache. A
//     break in either path (cache not refreshed after setRowData,
//     resolver collapses to empty, state computation off-by-one)
//     would render AAPL as 'none' (empty box, no dash) — the
//     baseline catches that too.
//   - Token bind regression: the indeterminate dash colour resolves
//     from `--cg-group-checkbox-indeterminate-color`. If the
//     painter started reaching into the theme directly instead of
//     via CellPaintConfig, theme overrides would silently no-op —
//     the baseline catches a single-pixel colour shift.
//
// No status bar, no pinned rows, no totals — every other surface
// off so the diff isolates the checkbox surface.

test('groupSelectsChildren — AAPL group shows indeterminate dash after partial leaf selection', async ({ page }) => {
  await gridReadyWithQuery(page, '?grouping=ticker&totals=off&groupSelectsChildren=1');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  // Seed exactly one descendant of the AAPL group as selected. The
  // demo's seedGrid uses `TICKERS[i % 20]` cycling through 20
  // tickers, so `POS-000000`, `POS-000020`, `POS-000040` all land
  // on AAPL. Selecting one of three flips AAPL from 'none' to
  // 'partial'; the renderer paints the horizontal dash glyph.
  // Other groups stay at 'none' — empty boxes.
  await page.evaluate(() => {
    const w = window as unknown as {
      __cgrid: { setSelectedRowIds: (ids: string[]) => void };
    };
    w.__cgrid.setSelectedRowIds(['POS-000000']);
  });
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('25-groupSelectsChildren-indeterminate.png');
});
