import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Cycle 21i / Task 5 — Column Groups tab E2E.
 *
 * The grid renders to <canvas> — column headers are NOT DOM, so every
 * assertion about grid/column-def STATE goes through
 * `window.__cgapi.getColumnGroupDefs()` (the live VelocityGridApi handed to the
 * `gridReady` event — see `src/main.ts`). The tool PANEL itself (the
 * "Column Groups" sidebar tab) is real DOM, so panel interactions
 * (clicks, drags, form fields) use normal Playwright locators.
 *
 * Each test starts from a clean `persistState` slate: `persistState: true`
 * with `gridId: 'customizer-demo'` writes to `localStorage` under
 * `velocity-grid:state:customizer-demo` (see
 * packages/kernel/src/core/statePersistence.ts), so a prior test's Apply
 * would otherwise leak into the next test via that key.
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

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

async function openColumnGroupsTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Column Groups' }).click();
  await expect(page.locator('.vg-colgroups-panel')).toBeVisible();
}

/** Real mouse drag honoring the panel's 4px drag-promotion threshold
 *  (`DRAG_THRESHOLD_PX` in columnGroupsPanel.ts) — a plain mousedown+mouseup
 *  with no meaningful movement never starts a drag session there. */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  // The panel's node list can be taller than its visible scroll area
  // (chrome above the grid — e.g. the intrinsic toolbar — shrinks it
  // further). Raw-coordinate mouse events on an off-screen row hit
  // nothing, so bring both endpoints into view before measuring.
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

  await expect(page.locator('[data-vg-node="trade"][data-kind="group"]')).toBeVisible();
  await expect(page.locator('[data-vg-node="valuation"][data-kind="group"]')).toBeVisible();
  await expect(page.locator('[data-vg-node="risk"][data-kind="group"]')).toBeVisible();

  // Sanity: the nested group's own children are present under it.
  await expect(page.locator('[data-vg-node="notionalAmount"]')).toBeVisible();
  await expect(page.locator('[data-vg-node="marketValue"]')).toBeVisible();
});

/** Drives the "create a group, move a column into it" journey up through
 *  Apply and returns the resulting defs — shared by the passing test below
 *  and the reload/persistence `test.fixme`. */
async function createAndPopulateCustomGroup(page: Page): Promise<void> {
  await openColumnGroupsTab(page);

  await page.locator('[data-vg-add-group]').click();
  const newRow = page.locator('[data-vg-node]').last();
  await expect(newRow).toHaveAttribute('data-kind', 'group');
  const customId = await newRow.getAttribute('data-vg-node');
  expect(customId).toBeTruthy();

  const nameInput = page.locator(`[data-vg-node="${customId}"] input.vg-colgroups-name-group`);
  await nameInput.fill('Custom');
  await nameInput.press('Tab'); // blur -> 'change' -> renameGroup(...)

  // Groups must be non-empty to pass Apply's validate() — drag an
  // ungrouped leaf (CUSIP) into the new group.
  await dragOnto(
    page,
    page.locator('[data-vg-node="cusip"] .vg-colgroups-handle'),
    page.locator(`[data-vg-node="${customId}"]`),
  );

  const applyBtn = page.locator('[data-vg-apply]');
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

// Cycle 21i / Task 6 — `updateGridOptions({ columnDefs })` (the Column
// Groups panel's ONLY Apply path) now emits `columnDefsChanged`, which the
// `stateUpdatedBus` maps to the `columnGroupDefs` GridState key (see
// `EVENT_TO_KEY` in packages/kernel/src/core/stateUpdatedBus.ts). `getState()`
// captures the flattened, def-stripped group overlay
// (`GridState.columnGroupDefs`) whenever at least one GROUP exists, and
// `setState()` rehydrates it (by colId, against the live base columnDefs)
// and re-applies it through the same columnDefs-rebuild path BEFORE
// `columnState` restores per-leaf geometry. So a "Custom" group created via
// this panel now survives a reload.
test(
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

  const checkbox = page.locator('[data-vg-node="cusip"] input.vg-colgroups-checkbox');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();

  const applyBtn = page.locator('[data-vg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const cusip = findNode(defs, (d) => d.colId === 'cusip');
  expect(cusip).toBeTruthy();
  expect(cusip!.hide).toBe(true);
});

test('group header styling: bold + background color apply to headerStyle', async ({ page }) => {
  await openColumnGroupsTab(page);

  await page.locator('[data-vg-node="trade"] [data-vg-select]').click();
  await expect(page.locator('[data-vg-style][data-for="trade"]')).toBeVisible();

  // Bold — now a segment toggle button carrying data-vg-field directly.
  await page.locator('[data-vg-field="fontWeight"]').click();
  await expect(page.locator('[data-vg-field="fontWeight"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Background color — a custom swatch + popover (not a native <input
  // type=color>): click the swatch, type a hex into the popover's hex
  // field, then Tab to blur (fires 'change' -> commits).
  await page.locator('[data-vg-field="bg"] .vg-colorpicker-swatch').click();
  const hexInput = page.locator('.vg-colorpicker-popover .vg-colorpicker-hex');
  await expect(hexInput).toBeVisible();
  await hexInput.fill('#ff0000');
  await hexInput.press('Tab');

  const applyBtn = page.locator('[data-vg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const trade = findNode(defs, (d) => d.groupId === 'trade');
  expect(trade).toBeTruthy();
  expect(trade!.headerStyle?.fontWeight).toBe('bold');
  expect(trade!.headerStyle?.bg).toBe('rgb(255, 0, 0)');
});

// Task 9 — StarUI parity: italic/underline/fontSize/alignment/border added
// to the Style band's Header section. This journey exercises Italic (switch)
// + an all-sides dashed border (three fields composing one `border.all`
// object), then proves both survive Apply and a reload.
test('group header styling: italic + dashed border apply to headerStyle and persist across reload', async ({ page }) => {
  await openColumnGroupsTab(page);

  await page.locator('[data-vg-node="trade"] [data-vg-select]').click();
  await expect(page.locator('[data-vg-style][data-for="trade"]')).toBeVisible();

  // Italic — segment toggle button carrying data-vg-field directly.
  await page.locator('[data-vg-field="fontStyle"]').click();
  await expect(page.locator('[data-vg-field="fontStyle"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Border editor — the Side selector reads "All" by default, so width/style/
  // colour compose a single border.all object. Width + style (native number/
  // select controls).
  await page.locator('[data-vg-field="borderWidth"] input').fill('2');
  await page.locator('[data-vg-field="borderWidth"] input').blur();
  await page.locator('[data-vg-field="borderStyle"] select').selectOption('dashed');

  // Border colour — same colour-picker idiom as the Background field above.
  await page.locator('[data-vg-field="borderColor"] .vg-colorpicker-swatch').click();
  const borderHex = page.locator('.vg-colorpicker-popover .vg-colorpicker-hex');
  await expect(borderHex).toBeVisible();
  await borderHex.fill('#00ff00');
  await borderHex.press('Tab');

  const applyBtn = page.locator('[data-vg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const trade = findNode(defs, (d) => d.groupId === 'trade');
  expect(trade).toBeTruthy();
  expect(trade!.headerStyle?.fontStyle).toBe('italic');
  expect(trade!.headerStyle?.border?.all).toEqual({ width: 2, style: 'dashed', color: 'rgb(0, 255, 0)' });

  await page.waitForFunction(
    (key) => (localStorage.getItem(key) ?? '').includes('"dashed"'),
    STORAGE_KEY,
    { timeout: 5_000 },
  );

  await page.reload();
  await waitForGridReady(page);

  let defsAfterReload: AnyDef[] = [];
  let tradeAfterReload: AnyDef | null = null;
  await expect
    .poll(async () => {
      defsAfterReload = await getColumnGroupDefs(page);
      tradeAfterReload = findNode(defsAfterReload, (d) => d.groupId === 'trade');
      return tradeAfterReload?.headerStyle?.border?.all?.style ?? null;
    }, { timeout: 10_000 })
    .toBe('dashed');
  expect(tradeAfterReload!.headerStyle?.fontStyle).toBe('italic');
});

// Task 12 — the border editor writes a single selected side. Choosing "Top"
// in the Side selector scopes width/style to headerStyle.border.top (leaving
// border.all untouched), which then survives Apply + a reload.
test('group header styling: a per-side (top) border applies to headerStyle.border.top and persists', async ({ page }) => {
  await openColumnGroupsTab(page);

  await page.locator('[data-vg-node="trade"] [data-vg-select]').click();
  await expect(page.locator('[data-vg-style][data-for="trade"]')).toBeVisible();

  // Scope the border editor to the top side via the Side selector, then set
  // width + style.
  await page.locator('[data-vg-border] [data-vg-border-side]').selectOption('top');
  await expect(page.locator('[data-vg-border] [data-vg-border-side]')).toHaveValue('top');
  await page.locator('[data-vg-field="borderWidth"] input').fill('3');
  await page.locator('[data-vg-field="borderWidth"] input').blur();
  await page.locator('[data-vg-field="borderStyle"] select').selectOption('dotted');

  const applyBtn = page.locator('[data-vg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const trade = findNode(defs, (d) => d.groupId === 'trade');
  expect(trade).toBeTruthy();
  expect(trade!.headerStyle?.border?.top).toEqual({ width: 3, style: 'dotted' });
  expect(trade!.headerStyle?.border?.all).toBeUndefined();

  await page.waitForFunction(
    (key) => (localStorage.getItem(key) ?? '').includes('"dotted"'),
    STORAGE_KEY,
    { timeout: 5_000 },
  );

  await page.reload();
  await waitForGridReady(page);

  let tradeAfterReload: AnyDef | null = null;
  await expect
    .poll(async () => {
      const reloaded = await getColumnGroupDefs(page);
      tradeAfterReload = findNode(reloaded, (d) => d.groupId === 'trade');
      return tradeAfterReload?.headerStyle?.border?.top?.style ?? null;
    }, { timeout: 10_000 })
    .toBe('dotted');
  expect(tradeAfterReload!.headerStyle?.border?.top?.width).toBe(3);
});

// Task 7 — `columnGroupShow` (always/open/closed) authoring. 'pnl' is a
// direct child of the seeded 'trade' group (see apps/velocitygrid-customizer-demo/
// src/main.ts), so it carries the inline `data-vg-groupshow` control. The
// kernel already ENFORCES the runtime open/closed semantics
// (`resolveVisibleLeaves`, unit-covered) — this journey only proves the
// editor round-trips the authored value through Apply and persistence.
test('setting a grouped column\'s columnGroupShow to "When collapsed" persists across reload', async ({ page }) => {
  await openColumnGroupsTab(page);

  // `columnGroupShow` is a 3-state segment (eye = always · ⌄ = when expanded ·
  // › = when collapsed), revealed on ROW HOVER — so hover the row first.
  const row = page.locator('[data-vg-node="pnl"]');
  await row.hover();
  const groupShow = row.locator('[data-vg-groupshow]');
  await expect(groupShow).toBeVisible();
  await groupShow.locator('[data-value="closed"]').click();

  const applyBtn = page.locator('[data-vg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const pnl = findNode(defs, (d) => d.colId === 'pnl');
  expect(pnl).toBeTruthy();
  expect(pnl!.columnGroupShow).toBe('closed');

  await page.waitForFunction(
    (key) => (localStorage.getItem(key) ?? '').includes('"closed"'),
    STORAGE_KEY,
    { timeout: 5_000 },
  );

  await page.reload();
  await waitForGridReady(page);

  let defsAfterReload: AnyDef[] = [];
  let pnlAfterReload: AnyDef | null = null;
  await expect
    .poll(async () => {
      defsAfterReload = await getColumnGroupDefs(page);
      pnlAfterReload = findNode(defsAfterReload, (d) => d.colId === 'pnl');
      return pnlAfterReload?.columnGroupShow ?? null;
    }, { timeout: 10_000 })
    .toBe('closed');
});

// Column-group UI refactor — the inline visibility control (eye / ⌄ / ›) is
// hidden at rest and revealed only on row hover, so idle rows stay uncluttered.
test('the column-group visibility control is hidden at rest and revealed on row hover', async ({ page }) => {
  await openColumnGroupsTab(page);
  const row = page.locator('[data-vg-node="pnl"]');
  const picker = row.locator('.vg-colgroups-vis-picker');
  // pnl is a grouped column → it has the control, but it is hidden at rest.
  await expect(picker).toHaveCount(1);
  await expect(picker).toBeHidden();
  // Hovering the row reveals the 3-state picker.
  await row.hover();
  await expect(picker).toBeVisible();
});

// The per-GROUP Style editor floats out of the sidebar into a non-modal
// palette (invoked from the gear ["Edit group style"] icon on a group row's
// caption) rather than the whole Column Groups panel popping out.
test('clicking a group\'s gear opens a floating Style editor (Close-only, no dock) and closing it deselects the group', async ({ page }) => {
  await openColumnGroupsTab(page);

  const groupRow = page.locator('[data-vg-node="trade"][data-kind="group"]');
  await groupRow.hover();
  await groupRow.locator('[data-vg-select]').click();

  const float = page.locator('.vg-floating-panel');
  await expect(float).toBeVisible();
  await expect(page.locator('.vg-floating-panel-title')).toHaveText('Style — Trade');
  // Style controls are present (fill/text swatches).
  await expect(float.locator('[data-vg-field="bg"]')).toBeVisible();
  await expect(float.locator('[data-vg-field="fg"]')).toBeVisible();
  // Close-only — nowhere to dock back to.
  await expect(float.locator('.vg-floating-panel-dock')).toHaveCount(0);
  await expect(float.locator('.vg-floating-panel-close')).toBeVisible();
  // The gear reflects the selection.
  await expect(groupRow.locator('[data-vg-select]')).toHaveAttribute('aria-pressed', 'true');
  await expect(groupRow).toHaveAttribute('data-selected', '');

  // Close — the float disappears and the group is deselected.
  await float.locator('.vg-floating-panel-close').click();
  await expect(page.locator('.vg-floating-panel')).toHaveCount(0);
  await expect(groupRow).not.toHaveAttribute('data-selected', '');
  await expect(groupRow.locator('[data-vg-select]')).toHaveAttribute('aria-pressed', 'false');
});

// Clicking the gear on a DIFFERENT group while one is already floating
// retargets the SAME float to the new group instead of opening a second one.
test('selecting a different group\'s gear retargets the Style float to the new group', async ({ page }) => {
  await openColumnGroupsTab(page);

  const tradeRow = page.locator('[data-vg-node="trade"][data-kind="group"]');
  const riskRow = page.locator('[data-vg-node="risk"][data-kind="group"]');

  await tradeRow.hover();
  await tradeRow.locator('[data-vg-select]').click();
  await expect(page.locator('.vg-floating-panel-title')).toHaveText('Style — Trade');

  await riskRow.hover();
  await riskRow.locator('[data-vg-select]').click();
  await expect(page.locator('.vg-floating-panel')).toHaveCount(1);
  await expect(page.locator('.vg-floating-panel-title')).toHaveText('Style — Risk');
  await expect(tradeRow).not.toHaveAttribute('data-selected', '');
  await expect(riskRow).toHaveAttribute('data-selected', '');
});

// Cycle 21i / Task 8 — the RUNTIME open/collapse state of a column group
// (as opposed to its authored `openByDefault`, covered by Task 6/7 above)
// now persists too: `columnGroupOpened` (fired by `ColumnGroupState`'s
// `apply`/`toggle`) maps to the `columnGroupOpen` GridState key, and
// `setState()` re-applies it AFTER the `columnGroupDefs` structural
// restore so the user's runtime collapse wins over `openByDefault`.
test('collapsing a group at runtime persists its open/collapse state across reload', async ({ page }) => {
  await waitForGridReady(page);

  const initialState = await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.getColumnGroupState(),
  );
  const trade = initialState.find((s: AnyDef) => s.groupId === 'trade');
  expect(trade, 'seeded "trade" group should report open state').toBeTruthy();
  expect(trade.open).toBe(true);

  await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.setColumnGroupState([{ groupId: 'trade', open: false }]),
  );

  // Phase 2 / T2 — open/collapse state persists inside the module-state
  // envelope (`modules.columnGroups.data.open`), so wait for the
  // collapsed entry itself rather than the legacy top-level key.
  await page.waitForFunction(
    (key) => (localStorage.getItem(key) ?? '').includes('"groupId":"trade","open":false'),
    STORAGE_KEY,
    { timeout: 5_000 },
  );

  await page.reload();
  await waitForGridReady(page);

  let stateAfterReload: AnyDef[] = [];
  let tradeAfterReload: AnyDef | null = null;
  await expect
    .poll(async () => {
      stateAfterReload = await page.evaluate(() =>
        (window as unknown as { __cgapi: any }).__cgapi.getColumnGroupState(),
      );
      tradeAfterReload = stateAfterReload.find((s: AnyDef) => s.groupId === 'trade') ?? null;
      return tradeAfterReload?.open ?? null;
    }, { timeout: 10_000 })
    .toBe(false);
});

test('drag an ungrouped column onto a group row to nest it', async ({ page }) => {
  await openColumnGroupsTab(page);

  await dragOnto(
    page,
    page.locator('[data-vg-node="cusip"] .vg-colgroups-handle'),
    page.locator('[data-vg-node="risk"]'),
  );

  const applyBtn = page.locator('[data-vg-apply]');
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();

  const defs = await getColumnGroupDefs(page);
  const risk = findNode(defs, (d) => d.groupId === 'risk');
  expect(risk).toBeTruthy();
  expect(risk!.children?.some((c: AnyDef) => c.colId === 'cusip')).toBe(true);
});

// Task 10 — regular column-group headers now paint a leading horizontal
// expand/collapse caret (chevron-left open / chevron-right closed), same
// as pivot result groups already had. The caret pixel isn't DOM-assertable
// on a canvas surface, so this journey asserts the underlying behavior the
// caret communicates: collapsing "Valuation" (which owns a
// `columnGroupShow:'open'` child — see `src/main.ts`) actually drops that
// column out of the rendered viewport, and reopening brings it back.
// `getHeaderBoundsAt(colId)` is the real runtime-visibility signal here —
// it returns non-null bounds only while the column is in the current
// column order (see `VelocityGridApi.getHeaderBoundsAt`'s doc comment).
test('collapsing "Valuation" hides its columnGroupShow:"open" column; reopening restores it', async ({ page }) => {
  await waitForGridReady(page);

  const groupState = await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.getColumnGroupState(),
  );
  const valuation = groupState.find((s: AnyDef) => s.groupId === 'valuation');
  expect(valuation, 'seeded "valuation" group should report open state').toBeTruthy();
  expect(valuation.open).toBe(true);

  // Open: the 'open'-tagged marketValue column is in the visible header order.
  const boundsWhileOpen = await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.getHeaderBoundsAt('marketValue'),
  );
  expect(boundsWhileOpen, 'marketValue should be visible while its group is open').not.toBeNull();

  // Collapse "Valuation" via the same primitive the panel/click path uses.
  await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.setColumnGroupState([{ groupId: 'valuation', open: false }]),
  );

  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.getHeaderBoundsAt('marketValue')),
    )
    .toBeNull();

  const stateAfterCollapse = await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.getColumnGroupState(),
  );
  expect(stateAfterCollapse.find((s: AnyDef) => s.groupId === 'valuation').open).toBe(false);

  // Reopen: the column reappears and its own def/state are unaffected —
  // only runtime visibility toggled, not the authored columnDefs.
  await page.evaluate(() =>
    (window as unknown as { __cgapi: any }).__cgapi.setColumnGroupState([{ groupId: 'valuation', open: true }]),
  );

  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.getHeaderBoundsAt('marketValue')),
    )
    .not.toBeNull();

  const defsAfter = await getColumnGroupDefs(page);
  const marketValue = findNode(defsAfter, (d) => d.colId === 'marketValue');
  expect(marketValue).toBeTruthy();
  expect(marketValue!.columnGroupShow).toBe('open');
});
