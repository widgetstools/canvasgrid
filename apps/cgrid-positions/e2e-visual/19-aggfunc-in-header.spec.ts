import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 14 / Task 4 — `suppressAggFuncInHeader` toggle baseline. TWO
// snapshots covering the same 50-row dataset with the same totals row
// pinned at the bottom (`?totals=bottom`), differing only in the
// header-decoration toggle. Reading the diff between the two PNGs
// gives reviewers the regression footprint of the toggle in
// isolation: only the leaf-column header text should change.
//
// `19-aggfunc-in-header-on.png` is the canonical default — the demo
// ships with `suppressAggFuncInHeader: false`, so the aggFunc-in-
// header decoration is ON. Every leaf column with an `aggFunc`
// declared on its colDef renders as `aggFuncName(headerName)` (e.g.
// `sum(Notional)`, `sum(Market Value)`, `avg(Price)`, `sum(Total)`
// for the P&L column, `avg(Yield)`, `avg(Spread)`, `sum(DV01)`,
// `sum(PV01)`, `sum(Unrealized)`, `sum(Daily)`).
//
// `19-aggfunc-in-header-off.png` covers the inverse — the user
// flipped `suppressAggFuncInHeader: true` (`?suppressAggHeader=1`),
// turning the aggFunc-in-header decoration OFF. The totals row at
// the bottom is still there carrying the values; every leaf header
// reads its raw `headerName`, identical to what the headers would
// have looked like before Cycle 14.
//
// What regression this catches:
//   - Decorator wiring: if `byRows.ts` stopped calling
//     `decorateHeader(def, suppressAggFuncInHeader)` at the leaf-
//     header text path, both snapshots would render identical raw
//     headers and the on-snapshot diff would catch the missing
//     `sum(` / `avg(` prefixes.
//   - Toggle propagation: if the runtime option failed to flow from
//     `CGridOptions.suppressAggFuncInHeader` through the renderer's
//     `getSuppressAggFuncInHeader` callback into `PainterCtx`, the
//     off-snapshot would still show the decoration. The diff between
//     `?suppressAggHeader=1` and the default URL isolates the
//     toggle's pixel footprint.
//   - Format regression: if a refactor changed the format from
//     `sum(Notional)` to e.g. `SUM(Notional)` (allcaps), or
//     `Notional [sum]`, or `Notional (sum)`, the on-snapshot would
//     diff. The Cycle 14 / Task 4 design plan locks the format as
//     lowercase-verb + parens + no spaces — this baseline is the
//     pixel guard for that decision.
//   - Group-header noise: if the decorator accidentally fired on
//     group headers (the column-group cells `Pricing`, `Risk`, etc.
//     in the demo), the on-snapshot would show e.g. `sum(Pricing)`.
//     The plan specifies leaf-only application; the baseline
//     verifies group headers stay raw.
//   - Truncation: narrow columns truncate the column-name portion
//     first (per the design plan's decision 5 — right-side
//     ellipsification preserves the verb). The on snapshot captures
//     this — if a regression flipped the ellipsis side or dropped
//     the verb, the diff would surface.

test('aggFunc-in-header on (default) — every aggFunc column reads as `sum(Notional)`', async ({ page }) => {
  await gridReadyWithQuery(page, '?totals=bottom');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('19-aggfunc-in-header-on.png');
});

test('aggFunc-in-header off (suppressed) — every aggFunc column reads its raw header', async ({ page }) => {
  await gridReadyWithQuery(page, '?totals=bottom&suppressAggHeader=1');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await expect(page).toHaveScreenshot('19-aggfunc-in-header-off.png');
});
