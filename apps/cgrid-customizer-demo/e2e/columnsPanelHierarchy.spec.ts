import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Columns tool panel — hierarchy + group-aware drag E2E (T4).
 *
 * T1-T3 built: a group-membership mutation API (`moveColumnToGroup` /
 * `moveColumnGroup` on `VelocityGridApi`), hierarchical rendering of the
 * `columns` sideBar tool panel (group rows with carets + tri-state
 * checkboxes, indented children), and group-aware drag (reorder +
 * re-parent) within that panel.
 *
 * Like `columnGroups.spec.ts`, the grid renders to <canvas> — column
 * headers are NOT DOM — so every assertion about grid/column-def STATE
 * goes through `window.__cgapi` (the live VelocityGridApi handed to `gridReady`).
 * The tool PANEL itself (the "Columns" sidebar tab) is real DOM, so panel
 * interactions (clicks, drags) use normal Playwright locators.
 *
 * Seeded tree (see `src/main.ts`): a top-level `trade` group containing a
 * nested `valuation` sub-group (`notionalAmount`, `marketValue`) plus
 * `pnl`/`dailyPnl`, and a separate top-level `risk` group (`dv01`, `pv01`,
 * `yield`, `spread`). `cusip` and `ticker` are ungrouped top-level leaves.
 */

const STORAGE_KEY = 'velocity-grid:state:customizer-demo';

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

async function getColumnState(page: Page): Promise<AnyDef[]> {
  return page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.getColumnState());
}

async function moveColumnToGroup(page: Page, colId: string, targetGroupId: string | null): Promise<void> {
  await page.evaluate(
    ({ colId, targetGroupId }) =>
      (window as unknown as { __cgapi: any }).__cgapi.moveColumnToGroup(colId, targetGroupId),
    { colId, targetGroupId },
  );
}

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

async function openColumnsTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Columns' }).click();
  await expect(page.locator('.vg-columns-panel')).toBeVisible();
}

/** Real mouse drag honoring the panel's drag-promotion threshold — mirrors
 *  `dragOnto` in `columnGroups.spec.ts`. A plain mousedown+mouseup with no
 *  meaningful movement never starts a drag session in this panel either
 *  (`DRAG_THRESHOLD_PX` in `visibilityPanel.ts`). */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error('dragOnto: source or target has no bounding box');
  const startX = sBox.x + sBox.width / 2;
  const startY = sBox.y + sBox.height / 2;
  const endX = tBox.x + tBox.width / 2;
  const endY = tBox.y + tBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY + 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

/** Reads the `--vg-indent` custom property a row carries as inline style
 *  (`visibilityPanel.ts`'s `buildRow`/`buildGroupRow`), as a number. */
async function indentOf(locator: Locator): Promise<number> {
  const raw = await locator.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--vg-indent'));
  return Number(raw);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Start every test from a clean persisted-state slate.
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('Columns panel renders the seeded groups hierarchically with indented children', async ({ page }) => {
  await openColumnsTab(page);

  const tradeGroup = page.locator('[data-group-id="trade"]');
  const valuationGroup = page.locator('[data-group-id="valuation"]');
  const riskGroup = page.locator('[data-group-id="risk"]');
  await expect(tradeGroup).toBeVisible();
  await expect(valuationGroup).toBeVisible();
  await expect(riskGroup).toBeVisible();

  // Group rows carry a caret + tri-state checkbox.
  await expect(tradeGroup.locator('.vg-columns-panel-row-caret')).toHaveCount(1);
  await expect(tradeGroup.locator('input.vg-columns-panel-row-checkbox')).toHaveCount(1);

  // A top-level, ungrouped column sits at depth 0.
  const topLevelLeaf = page.locator('[data-col-id="cusip"]');
  await expect(topLevelLeaf).toBeVisible();
  expect(await indentOf(topLevelLeaf)).toBe(0);

  // 'trade' is itself a top-level group -> depth 0, same as an ungrouped leaf.
  expect(await indentOf(tradeGroup)).toBe(0);

  // Its direct child 'pnl' is one level deeper.
  const pnlLeaf = page.locator('[data-col-id="pnl"]');
  await expect(pnlLeaf).toBeVisible();
  expect(await indentOf(pnlLeaf)).toBe(1);

  // The nested 'valuation' sub-group is also depth 1 (child of 'trade')...
  expect(await indentOf(valuationGroup)).toBe(1);

  // ...and ITS children (double-nested leaves) are depth 2 — deeper than
  // both the top-level leaf and a direct child of 'trade'.
  const notionalLeaf = page.locator('[data-col-id="notionalAmount"]');
  await expect(notionalLeaf).toBeVisible();
  const notionalIndent = await indentOf(notionalLeaf);
  expect(notionalIndent).toBe(2);
  expect(notionalIndent).toBeGreaterThan(await indentOf(topLevelLeaf));
  expect(notionalIndent).toBeGreaterThan(await indentOf(pnlLeaf));
});

test('toggling a group tri-state checkbox hides its descendant leaves', async ({ page }) => {
  await openColumnsTab(page);

  // Sanity: every descendant starts visible.
  const before = await getColumnState(page);
  const beforeById = new Map(before.map((s) => [s.colId, s]));
  for (const colId of ['notionalAmount', 'marketValue', 'pnl', 'dailyPnl']) {
    expect(beforeById.get(colId)?.hide, `${colId} should start visible`).not.toBe(true);
  }

  const tradeCheckbox = page.locator('[data-group-id="trade"] input.vg-columns-panel-row-checkbox');
  await expect(tradeCheckbox).toBeChecked();
  expect(await tradeCheckbox.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);

  await tradeCheckbox.uncheck();

  // Every leaf nested under 'trade' (direct AND via the 'valuation'
  // sub-group) is now hidden.
  const after = await getColumnState(page);
  const afterById = new Map(after.map((s) => [s.colId, s]));
  for (const colId of ['notionalAmount', 'marketValue', 'pnl', 'dailyPnl']) {
    expect(afterById.get(colId)?.hide, `${colId} should be hidden after collapsing 'trade'`).toBe(true);
  }
  // A column outside 'trade' is unaffected.
  expect(afterById.get('cusip')?.hide).not.toBe(true);

  // Re-checking restores every descendant to visible.
  await tradeCheckbox.check();
  const restored = await getColumnState(page);
  const restoredById = new Map(restored.map((s) => [s.colId, s]));
  for (const colId of ['notionalAmount', 'marketValue', 'pnl', 'dailyPnl']) {
    expect(restoredById.get(colId)?.hide).not.toBe(true);
  }
});

test('a mixed group shows an indeterminate tri-state checkbox', async ({ page }) => {
  await openColumnsTab(page);

  // Hide exactly one of 'trade's descendants directly (not via the group
  // checkbox) so the group itself lands in the 'mixed' tri-state.
  const pnlCheckbox = page.locator('[data-col-id="pnl"] input.vg-columns-panel-row-checkbox');
  await pnlCheckbox.uncheck();

  const tradeCheckbox = page.locator('[data-group-id="trade"] input.vg-columns-panel-row-checkbox');
  await expect(tradeCheckbox).not.toBeChecked();
  await expect
    .poll(() => tradeCheckbox.evaluate((el) => (el as HTMLInputElement).indeterminate))
    .toBe(true);
});

// FIXED KERNEL BUG (found during T4 E2E): `moveColumnToGroup`/
// `moveColumnGroup` (`packages/kernel/src/core/columnGroupMutation.ts`) used
// to clone the WHOLE authored columnDefs tree via raw `structuredClone`,
// which throws on ANY function-valued field anywhere in that tree — and
// `CColDef` legitimately carries them (`valueFormatter`, `cellRenderer`,
// `valueGetter`, `comparator`, ...). This demo's own 'Price' column
// (`currentPrice` in `src/main.ts`) uses a function `valueFormatter`
// (wrapping `formatPrice32`), so every call used to throw a `DataCloneError`
// here. The mutation core now reuses `cloneDefsTree` (exported from
// `packages/kernel/src/core/columnTree.ts`, originally the Column Groups
// authoring panel's local helper) which deep-clones plain objects/arrays
// while passing functions through by reference.
test('drag an ungrouped column onto a group row to re-parent it', async ({ page }) => {
  await openColumnsTab(page);

  // Precondition: 'cusip' starts top-level (not nested under any group).
  const before = await getColumnGroupDefs(page);
  expect(findNode(before, (d) => d.groupId === 'risk')?.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(
    false,
  );

  await dragOnto(
    page,
    page.locator('[data-col-id="cusip"] .vg-columns-panel-row-handle'),
    page.locator('[data-group-id="risk"]'),
  );

  const after = await getColumnGroupDefs(page);
  const risk = findNode(after, (d) => d.groupId === 'risk');
  expect(risk, "'risk' group should still exist").toBeTruthy();
  expect(risk!.children?.some((c: AnyDef) => c.colId === 'cusip'), 'cusip should now be nested under risk').toBe(
    true,
  );

  // The panel re-renders 'cusip' as an indented child of 'risk' after the
  // `columnDefsChanged` rebuild.
  const cusipRow = page.locator('[data-col-id="cusip"]');
  await expect(cusipRow).toBeVisible();
  expect(await indentOf(cusipRow)).toBeGreaterThan(0);
});

// Same fixed kernel bug as above — this direct API call used to throw a
// `DataCloneError` immediately on the first `moveColumnToGroup`, because
// `getColumnGroupDefs()` includes the 'Price' column's function
// `valueFormatter`.
test('moveColumnToGroup re-parents a column into a group and back out to top level', async ({ page }) => {
  // Exercises the same mutation API end-to-end via `__cgapi` directly —
  // keeps the wiring assertion independent of drag-geometry flakiness,
  // complementing the real-drag test above.
  await openColumnsTab(page);

  await moveColumnToGroup(page, 'cusip', 'risk');
  const nested = await getColumnGroupDefs(page);
  const risk = findNode(nested, (d) => d.groupId === 'risk');
  expect(risk!.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(true);
  expect(findNode(nested, (d) => d.colId === 'cusip' && !risk!.children!.includes(d))).toBeNull();

  // Panel reflects the re-parent: 'cusip' now renders indented under 'risk'.
  const nestedRow = page.locator('[data-col-id="cusip"]');
  await expect(nestedRow).toBeVisible();
  expect(await indentOf(nestedRow)).toBeGreaterThan(0);

  await moveColumnToGroup(page, 'cusip', null);
  const backOut = await getColumnGroupDefs(page);
  // Top level of the defs tree is the array itself — 'cusip' should be a
  // direct entry there, and no longer under 'risk'.
  expect(backOut.some((d) => d.colId === 'cusip')).toBe(true);
  const riskAfter = findNode(backOut, (d) => d.groupId === 'risk');
  expect(riskAfter!.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(false);

  // Panel reflects the move back to top level: depth 0, same as another
  // ungrouped leaf.
  const topLevelRow = page.locator('[data-col-id="cusip"]');
  await expect(topLevelRow).toBeVisible();
  expect(await indentOf(topLevelRow)).toBe(0);
});
