import { test, expect } from '@playwright/test';

// AG-Grid renders a header cell for a leaf column as
// [role="columnheader"][col-id="<field>"]; a group header is
// .ag-header-group-cell with an aria-label containing the group name.
const leaf = (field: string) => `[role="columnheader"][col-id="${field}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="grid"]')).toBeVisible();
  // Wait for at least one data row. AG-Grid renders a row-index="0" shell once
  // per column container (pinned-left AND center), so scope to the center
  // viewport — otherwise the locator resolves to two elements (strict-mode
  // violation) even though there's only one logical row.
  await expect(
    page.locator('.ag-center-cols-container [role="row"][row-index="0"]'),
  ).toBeVisible();
});

test('renders in dark theme', async ({ page }) => {
  const scheme = await page.evaluate(() => {
    const el = document.querySelector('.ag-root-wrapper') as HTMLElement;
    return getComputedStyle(el).colorScheme;
  });
  expect(scheme).toContain('dark');
});

test('Position ID is present and pinned left', async ({ page }) => {
  await expect(page.locator(leaf('positionId'))).toBeVisible();
  const pinnedLeft = page.locator('.ag-pinned-left-header ' + leaf('positionId'));
  await expect(pinnedLeft).toHaveCount(1);
});

test('Instrument group shows all three fields and has no expand caret', async ({ page }) => {
  await expect(page.locator(leaf('instrument'))).toBeVisible();
  await expect(page.locator(leaf('cusip'))).toBeVisible();
  await expect(page.locator(leaf('assetClass'))).toBeVisible();
  const group = page.locator('.ag-header-group-cell', { hasText: 'Instrument' });
  // AG-Grid always renders BOTH the "expanded" and "collapsed" caret icons in
  // the DOM for every group cell (even non-expandable ones) and toggles which
  // one is shown via the `ag-hidden` class rather than adding/removing nodes.
  // So `.ag-header-expand-icon` always has count 2; the correct check for "no
  // caret" is that none of them is the *visible* one.
  await expect(group.locator('.ag-header-expand-icon:not(.ag-hidden)')).toHaveCount(0);
});

test('Book & Coverage group is CLOSED by default (region shown, desk hidden)', async ({ page }) => {
  // grp-coverage has openByDefault: false, so it starts CLOSED. Per AG-Grid's
  // columnGroupShow semantics, 'closed'-flagged leaves are shown when the
  // group is closed and 'open'-flagged leaves are hidden — the opposite of
  // what the brief's draft assumed. `region` is columnGroupShow: 'closed', so
  // it is visible by default; `desk`/`trader` are columnGroupShow: 'open', so
  // they're hidden by default. `book` has no columnGroupShow (always visible).
  await expect(page.locator(leaf('book'))).toBeVisible();
  await expect(page.locator(leaf('region'))).toBeVisible();
  await expect(page.locator(leaf('desk'))).toHaveCount(0);
  await expect(page.locator(leaf('trader'))).toHaveCount(0);
});

test('Valuation group is OPEN by default (mtm shown, prevClose hidden)', async ({ page }) => {
  await expect(page.locator(leaf('price'))).toBeVisible();
  await expect(page.locator(leaf('mtm'))).toBeVisible();
  await expect(page.locator(leaf('prevClose'))).toHaveCount(0);
});

test('Expand all reveals open-only columns; Collapse all hides them', async ({ page }) => {
  await page.getByTestId('btn-expand-all').click();
  await expect(page.locator(leaf('desk'))).toBeVisible();      // coverage open child
  await expect(page.locator(leaf('dayPnl'))).toBeVisible();    // pnl open child
  await expect(page.locator(leaf('delta'))).toBeVisible();     // greeks sub-group (open)

  await page.getByTestId('btn-collapse-all').click();
  await expect(page.locator(leaf('desk'))).toHaveCount(0);
  await expect(page.locator(leaf('dayPnl'))).toHaveCount(0);
  await expect(page.locator(leaf('delta'))).toHaveCount(0);
  // closed-only columns now appear
  await expect(page.locator(leaf('region'))).toBeVisible();    // coverage closed child
  await expect(page.locator(leaf('prevClose'))).toBeVisible(); // valuation closed child
});

test('Risk group centerpiece: mixed leaf fields + nested sub-groups switch by state', async ({ page }) => {
  await page.getByTestId('btn-collapse-all').click();
  // collapsed: always-visible leaf dv01 + always-visible Exposure sub-group; closed-only duration + Scenario
  await expect(page.locator(leaf('dv01'))).toBeVisible();
  await expect(page.locator(leaf('grossExp'))).toBeVisible();   // Exposure (always)
  await expect(page.locator(leaf('duration'))).toBeVisible();   // closed-only leaf
  await expect(page.locator(leaf('up100bp'))).toBeVisible();    // Scenario sub-group (closed)
  await expect(page.locator(leaf('cr01'))).toHaveCount(0);      // open-only leaf hidden
  await expect(page.locator(leaf('delta'))).toHaveCount(0);     // Greeks hidden when closed

  await page.getByTestId('btn-expand-all').click();
  // open: dv01 + Exposure still there; cr01 + Greeks appear; duration + Scenario hide
  await expect(page.locator(leaf('dv01'))).toBeVisible();
  await expect(page.locator(leaf('grossExp'))).toBeVisible();
  await expect(page.locator(leaf('cr01'))).toBeVisible();       // open-only leaf
  await expect(page.locator(leaf('delta'))).toBeVisible();      // Greeks (open)
  await expect(page.locator(leaf('duration'))).toHaveCount(0);  // closed-only leaf hidden
  await expect(page.locator(leaf('up100bp'))).toHaveCount(0);   // Scenario hidden when open
});
