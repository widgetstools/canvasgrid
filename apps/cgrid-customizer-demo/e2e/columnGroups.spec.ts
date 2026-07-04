import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Cycle 21i / Task 5 — Column Groups tab E2E.
 *
 * The grid renders to <canvas> — column headers are NOT DOM, so every
 * assertion about grid/column-def STATE goes through
 * `window.__cgapi.getColumnGroupDefs()` (the live CGridApi handed to the
 * `gridReady` event — see `src/main.ts`). The tool PANEL itself (the
 * "Column Groups" sidebar tab) is real DOM, so panel interactions
 * (clicks, drags, form fields) use normal Playwright locators.
 *
 * Each test starts from a clean `persistState` slate: `persistState: true`
 * with `gridId: 'customizer-demo'` writes to `localStorage` under
 * `cgrid:state:customizer-demo` (see
 * packages/kernel/src/core/statePersistence.ts), so a prior test's Apply
 * would otherwise leak into the next test via that key.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

type AnyDef = Record<string, any>;

/** Depth-first search over a `getColumnGroupDefs()` tree for the first def
 *  (group or leaf) matching `match`. */
function findNode(defs: AnyDef[], match: (d: AnyDef) => boolean): AnyDef | null {
  for (const d of defs) {
    if (match(d)) return d;
    if (Array.isArray(d.children)) {
      const found = findNode(d.children, match);
      if (found) return found;
    }
  }
  return null;
}

async function getColumnGroupDefs(page: Page): Promise<AnyDef[]> {
  return page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.getColumnGroupDefs());
}

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

async function openColumnGroupsTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Column Groups' }).click();
  await expect(page.locator('.cg-colgroups-panel')).toBeVisible();
}

/** Real mouse drag honoring the panel's 4px drag-promotion threshold
 *  (`DRAG_THRESHOLD_PX` in columnGroupsPanel.ts) — a plain mousedown+mouseup
 *  with no meaningful movement never starts a drag session there. */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error('dragOnto: source or target has no bounding box');
  const startX = sBox.x + sBox.width / 2;
  const startY = sBox.y + sBox.height / 2;
  const endX = tBox.x + tBox.width / 2;
  const endY = tBox.y + tBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Cross the drag threshold first (well past 4px) before heading to the
  // target, so the panel promotes this to a real drag session.
  await page.mouse.move(startX + 20, startY + 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Start every test from a clean persisted-state slate.
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('Column Groups tab shows the seeded nested tree', async ({ page }) => {
  await openColumnGroupsTab(page);

  await expect(page.locator('[data-cg-node="trade"][data-kind="group"]')).toBeVisible();
  await expect(page.locator('[data-cg-node="valuation"][data-kind="group"]')).toBeVisible();
  await expect(page.locator('[data-cg-node="risk"][data-kind="group"]')).toBeVisible();

  // Sanity: the nested group's own children are present under it.
  await expect(page.locator('[data-cg-node="notionalAmount"]')).toBeVisible();
  await expect(page.locator('[data-cg-node="marketValue"]')).toBeVisible();
});

/** Drives the "create a group, move a column into it" journey up through
 *  Apply and returns the resulting defs — shared by the passing test below
 *  and the reload/persistence `test.fixme`. */
async function createAndPopulateCustomGroup(page: Page): Promise<void> {
  await openColumnGroupsTab(page);

  await page.locator('[data-cg-add-group]').click();
  const newRow = page.locator('[data-cg-node]').last();
  await expect(newRow).toHaveAttribute('data-kind', 'group');
  const customId = await newRow.getAttribute('data-cg-node');
  expect(customId).toBeTruthy();

  const nameInput = page.locator(`[data-cg-node="${customId}"] input.cg-colgroups-name-group`);
  await nameInput.fill('Custom');
  await nameInput.press('Tab'); // blur -> 'change' -> renameGroup(...)

  // Groups must be non-empty to pass Apply's validate() — drag an
  // ungrouped leaf (CUSIP) into the new group.
  await dragOnto(
    page,
    page.locator('[data-cg-node="cusip"] .cg-colgroups-handle'),
    page.locator(`[data-cg-node="${customId}"]`),
  );

  const applyBtn = page.locator('[data-cg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();
}

test('create a group, move a column into it, and Apply writes it to the grid', async ({ page }) => {
  await createAndPopulateCustomGroup(page);

  const defs = await getColumnGroupDefs(page);
  const custom = findNode(defs, (d) => d.headerName === 'Custom');
  expect(custom, 'Custom group should exist after Apply').toBeTruthy();
  expect(custom!.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(true);
});

// `persistState`'s GridState snapshot (packages/kernel/src/core/
// stateSnapshot.ts) only carries `columnState` (per-leaf geometry: width,
// hide, pinned, sort…) plus whatever lands in `runtimeTouchedOptions` via
// `setGridOption`. `columnDefs` is deliberately in `INITIAL_ONLY_OPTIONS`
// (packages/kernel/src/cgrid.ts) and `updateGridOptions({ columnDefs })` —
// the ONLY way the Column Groups panel's Apply writes structural changes —
// special-cases it (cgrid.ts `updateGridOptions`, ~line 5359) and never
// calls `setGridOption`, so it never reaches `runtimeTouchedOptions` /
// `GridState.gridOptions`. Verified directly: after Apply-ing a new
// "Custom" group + drag-moved column, `localStorage['cgrid:state:
// customizer-demo']` contains a `columnState` array with no trace of the
// new group at all. Column-GROUP STRUCTURE edits made via this panel
// therefore do not survive a reload today — a missing kernel capability
// (not a demo/test bug), out of this task's file scope
// (apps/cgrid-customizer-demo/ only) to fix. Left here, unskipped in body,
// as the acceptance test for whenever that kernel support lands.
test.fixme(
  'column-group structure created via the panel persists across reload',
  async ({ page }) => {
    await createAndPopulateCustomGroup(page);

    await page.waitForFunction(
      (key) => (localStorage.getItem(key) ?? '').includes('"Custom"'),
      STORAGE_KEY,
      { timeout: 5_000 },
    );

    await page.reload();
    await waitForGridReady(page);

    let defs: AnyDef[] = [];
    let custom: AnyDef | null = null;
    await expect
      .poll(async () => {
        defs = await getColumnGroupDefs(page);
        custom = findNode(defs, (d) => d.headerName === 'Custom');
        return custom !== null;
      }, { timeout: 10_000 })
      .toBe(true);
    expect(custom!.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(true);
  },
);

test('unchecking a leaf visibility checkbox sets hide:true after Apply', async ({ page }) => {
  await openColumnGroupsTab(page);

  const checkbox = page.locator('[data-cg-node="cusip"] input.cg-colgroups-checkbox');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();

  const applyBtn = page.locator('[data-cg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const cusip = findNode(defs, (d) => d.colId === 'cusip');
  expect(cusip).toBeTruthy();
  expect(cusip!.hide).toBe(true);
});

test('group header styling: bold + background color apply to headerStyle', async ({ page }) => {
  await openColumnGroupsTab(page);

  await page.locator('[data-cg-node="trade"] [data-cg-select]').click();
  await expect(page.locator('[data-cg-style][data-for="trade"]')).toBeVisible();

  // Bold switch.
  await page.locator('[data-cg-field="fontWeight"] .cg-settings-toggle').click();
  await expect(page.locator('[data-cg-field="fontWeight"] .cg-settings-toggle')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Background color — a custom swatch + popover (not a native <input
  // type=color>): click the swatch, type a hex into the popover's hex
  // field, then Tab to blur (fires 'change' -> commits).
  await page.locator('[data-cg-field="bg"] .cg-colorpicker-swatch').click();
  const hexInput = page.locator('.cg-colorpicker-popover .cg-colorpicker-hex');
  await expect(hexInput).toBeVisible();
  await hexInput.fill('#ff0000');
  await hexInput.press('Tab');

  const applyBtn = page.locator('[data-cg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const trade = findNode(defs, (d) => d.groupId === 'trade');
  expect(trade).toBeTruthy();
  expect(trade!.headerStyle?.fontWeight).toBe('bold');
  expect(trade!.headerStyle?.bg).toBe('rgb(255, 0, 0)');
});

test('drag an ungrouped column onto a group row to nest it', async ({ page }) => {
  await openColumnGroupsTab(page);

  await dragOnto(
    page,
    page.locator('[data-cg-node="cusip"] .cg-colgroups-handle'),
    page.locator('[data-cg-node="risk"]'),
  );

  const applyBtn = page.locator('[data-cg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const risk = findNode(defs, (d) => d.groupId === 'risk');
  expect(risk).toBeTruthy();
  expect(risk!.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(true);
});
