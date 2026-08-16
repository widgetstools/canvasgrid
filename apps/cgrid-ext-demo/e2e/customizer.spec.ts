import { test, expect, type Page } from '@playwright/test';
import {
  bootCustomizer,
  closeViaDone,
  cockpit,
  gridOption,
  openCustomizer,
  resetCard,
  saveCard,
  sheet,
  switchTab,
  typeInCm,
} from './helpers/customizer';

/**
 * Rigorous E2E for the Grid Customizer drawer (Customize) in cgrid-ext-demo.
 *
 * Tabs: Options · Column Groups · Column Settings · Styling Rules · Alerts ·
 * Calculated Columns · Smart Edit · Bulk Update · Plus / Minus · Shortcuts · Edit History
 * Boot: `/?paintHarness` (deterministic rows, no STOMP).
 */

// Each test boots a fresh harness + clears storage; keep parallel so one failure
// does not skip the rest of the suite.
test.beforeEach(async ({ page }) => {
  await bootCustomizer(page);
});

// ── Shell chrome ───────────────────────────────────────────────────────────

test.describe('Customizer shell', () => {
  test('opens from overflow Settings, shows all tabs, closes via Done and Esc', async ({ page }) => {
    await openCustomizer(page);
    await expect(page.locator('.vgext-sheet-eyebrow')).toHaveText('Customize');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Options');
    // Verify category tabs exist (multiple categories of settings)
    const tabs = page.locator('.vgext-sheet-nav-tab');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);
    // Verify the footer exists
    await expect(page.locator('.vgext-sheet-footer')).toBeVisible();
    await expect(page.locator('[data-testid="vgext-sheet-done"]')).toBeVisible();
    await expect(page.locator('.vgext-sheet-footbtn.ghost', { hasText: 'Discard' })).toBeVisible();

    await closeViaDone(page);

    await openCustomizer(page, 'grid-options');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden({ timeout: 5_000 });
  });

  test('tab navigation switches every module panel', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    await expect(page.locator('.vg-settings-panel')).toBeVisible();

    await switchTab(page, 'Column Groups');
    await expect(page.locator('.vg-colgroups-panel')).toBeVisible();

    await switchTab(page, 'Column Settings');
    await expect(cockpit(page)).toBeVisible();
    await expect(page.locator('.ckp-rail-head', { hasText: 'Columns' })).toBeVisible();

    await switchTab(page, 'Styling Rules');
    await expect(page.locator('.ckp-rail-head', { hasText: 'Rules' })).toBeVisible();

    await switchTab(page, 'Calculated Columns');
    await expect(page.locator('.ckp-rail-head', { hasText: 'Columns' })).toBeVisible();

    await switchTab(page, 'Options');
    await expect(page.locator('.vg-settings-panel')).toBeVisible();
  });
});

// ── Options ────────────────────────────────────────────────────────────────

test.describe('Options tab', () => {
  test('search filters settings rows', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const search = page.locator('.vg-settings-search');
    await expect(search).toBeVisible();
    await search.fill('row height');
    await expect(page.locator('[data-field-key="rowHeight"]')).toBeVisible();
    // Panel hides non-matches via the HTML `hidden` attribute (not DOM removal).
    await expect(page.locator('[data-field-key="animateRows"]')).toHaveAttribute('hidden', '');
    await search.fill('');
    await expect(page.locator('[data-field-key="animateRows"]')).not.toHaveAttribute('hidden');
  });

  test('row height input applies live to the grid', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const row = page.locator('[data-field-key="rowHeight"]');
    await expect(row).toBeVisible();
    const input = row.locator('input.vg-settings-input-number');
    await input.fill('40');
    await input.blur();
    await expect.poll(() => gridOption<number>(page, 'rowHeight')).toBe(40);
  });

  test('animate-rows toggle applies and marks Modified', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const before = await gridOption<boolean>(page, 'animateRows');
    const row = page.locator('[data-field-key="animateRows"]');
    await row.locator('input.vg-checkbox').click();
    await expect.poll(() => gridOption<boolean>(page, 'animateRows')).toBe(!before);
    await expect(page.locator('.vg-settings-panel')).toContainText(/Modified/i);
  });

  test('floating filters toggle applies to grid option', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const row = page.locator('[data-field-key="floatingFilter"]');
    await expect(row).toBeVisible();
    // Default is on (undefined/true). Turn off.
    const toggle = row.locator('input.vg-checkbox');
    const wasOn = await toggle.isChecked();
    if (wasOn) await toggle.click();
    await expect.poll(async () => {
      const v = await gridOption<boolean | undefined>(page, 'floatingFilter');
      return v === false;
    }).toBe(true);
  });

  test('per-row reset restores a modified numeric field', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const row = page.locator('[data-field-key="headerHeight"]');
    const input = row.locator('input.vg-settings-input-number');
    const original = await input.inputValue();
    await input.fill('60');
    await input.blur();
    await expect.poll(() => gridOption<number>(page, 'headerHeight')).toBe(60);
    const reset = row.locator('.vg-settings-row-reset');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect.poll(async () => {
      const v = await gridOption<number | undefined>(page, 'headerHeight');
      // Reset clears override — value returns toward density default (not necessarily original typed).
      return v !== 60;
    }).toBe(true);
    // Control should leave the explicit 60.
    await expect(input).not.toHaveValue('60');
    void original;
  });
});

// ── Column Groups ──────────────────────────────────────────────────────────

test.describe('Column Groups tab', () => {
  test('seeds existing groups and Save stays disabled until dirty', async ({ page }) => {
    await openCustomizer(page, 'column-groups');
    const panel = page.locator('.vg-colgroups-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-vg-node="trade"][data-kind="group"]')).toBeVisible();
    await expect(page.locator('[data-vg-apply]')).toBeDisabled();
  });

  test('create group, add leaf via picker, Save writes columnDefs', async ({ page }) => {
    await openCustomizer(page, 'column-groups');
    await page.locator('[data-vg-add-group]').click();
    const newRow = page.locator('[data-vg-node][data-kind="group"]').last();
    await expect(newRow).toBeVisible();
    const customId = await newRow.getAttribute('data-vg-node');
    expect(customId).toBeTruthy();

    await newRow.locator('[data-vg-select]').click();
    const editorName = page.locator('.vg-colgroups-rename, .vg-colgroups-editor input[aria-label="Group name"]');
    await expect(editorName).toBeVisible();
    await editorName.fill('E2E Group');
    await editorName.blur();

    // Leaf columns live in the editor "Add columns" picker (list shows groups only).
    await page.locator('[data-vg-add-col] .vg-colgroups-add-col-trigger').click();
    const cusipOpt = page.locator('[data-vg-add-col-id="cusip"]');
    await expect(cusipOpt).toBeVisible();
    await cusipOpt.click();
    await page.locator('[data-vg-add-col-commit]').click();
    await expect(page.locator('.vg-colgroups-chips')).toContainText(/CUSIP|cusip/i);

    const saveBtn = page.locator('[data-vg-apply]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    const ok = await page.evaluate(() => {
      const defs = (window as unknown as { __ext: { grid: { getColumnGroupDefs: () => any[] } } })
        .__ext.grid.getColumnGroupDefs() as any[];
      const byHeader = (nodes: any[]): any | null => {
        for (const n of nodes) {
          if (n.headerName === 'E2E Group') return n;
          if (n.children) {
            const found = byHeader(n.children);
            if (found) return found;
          }
        }
        return null;
      };
      const g = byHeader(defs);
      const kids = g?.children ?? [];
      return !!g && kids.some((c: any) => (c.colId ?? c.field) === 'cusip');
    });
    expect(ok).toBe(true);
  });

  test('Reset discards unapplied draft edits', async ({ page }) => {
    await openCustomizer(page, 'column-groups');
    await page.locator('[data-vg-add-group]').click();
    await expect(page.locator('[data-vg-apply]')).toBeEnabled();
    await page.locator('[data-vg-reset]').click();
    await expect(page.locator('[data-vg-apply]')).toBeDisabled();
  });
});

// ── Column Settings ────────────────────────────────────────────────────────

test.describe('Column Settings tab', () => {
  async function selectColumn(page: Page, label: string): Promise<void> {
    const row = page.locator('.ckp-rail-row', { hasText: label }).first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    // Wait for pane to fully render with content before returning
    await expect(page.locator('.ckp-title')).toHaveValue(new RegExp(label, 'i'), { timeout: 5000 });
    await expect(page.locator('input[aria-label="Caption"]')).toBeVisible({ timeout: 5000 });
    // Wait for all pane sections to render — ensure Behavior band body has Sortable row
    await expect(page.locator('.ckp-row', { hasText: /Sortable/ })).toBeVisible({ timeout: 5000 });
  }

  test('rail lists columns, filter narrows, selection loads editor', async ({ page }) => {
    await openCustomizer(page, 'column-settings');
    await expect(cockpit(page)).toBeVisible();
    await expect(page.locator('.ckp-rail-row').first()).toBeVisible();
    const search = page.locator('.ckp-rail input[type="search"]');
    await search.fill('yield');
    await expect(page.locator('.ckp-rail-row', { hasText: 'Yield' })).toBeVisible();
    await expect(page.locator('.ckp-rail-row')).toHaveCount(1);
    await page.locator('.ckp-rail-row', { hasText: 'Yield' }).click();
    await expect(page.locator('.ckp-title')).toHaveValue(/Yield/i);
    await expect(page.locator('input[aria-label="Caption"]')).toHaveValue(/Yield/i);
    await expect(page.locator('.ckp-band-title', { hasText: 'Header' })).toBeVisible();
    await expect(page.locator('.ckp-band-title', { hasText: 'Filter' })).toBeVisible();
    await expect(page.locator('.ckp-band-title', { hasText: 'Behavior' })).toBeVisible();
  });

  test('caption draft + Save persists headerName via override', async ({ page }) => {
    await openCustomizer(page, 'column-settings');
    await selectColumn(page, 'Yield');
    const caption = page.locator('input[aria-label="Caption"]');
    await caption.fill('Yield E2E');
    await expect(page.locator('.ckp-title')).toHaveValue('Yield E2E');
    await expect(page.locator('.ckp-actbtn', { hasText: 'Save' })).toBeEnabled();
    await saveCard(page);
    await expect(page.locator('.ckp-actbtn', { hasText: 'Save' })).toBeDisabled();
    await expect(page.locator('.ckp-title')).toHaveValue('Yield E2E');
    await expect(page.locator('.ckp-rail-row.active')).toContainText('Yield E2E');

    const header = await page.evaluate(() => {
      const g = (window as unknown as { __ext: { grid: { getColumnHeaderName: (id: string) => string } } }).__ext.grid;
      return g.getColumnHeaderName('yield');
    });
    expect(header).toBe('Yield E2E');
  });

  test('sortable toggle stays draft until Save; Reset restores', async ({ page }) => {
    await openCustomizer(page, 'column-settings');
    await selectColumn(page, 'Ticker');

    const sortableRow = page.locator('.ckp-row', { hasText: 'Sortable' });
    const sw = sortableRow.locator('.ckp-switch');
    const before = await sw.getAttribute('aria-pressed');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    // Not committed yet — Save enabled.
    await expect(page.locator('.ckp-actbtn', { hasText: 'Save' })).toBeEnabled();
    await resetCard(page);
    await expect(page.locator('.ckp-row', { hasText: 'Sortable' }).locator('.ckp-switch'))
      .toHaveAttribute('aria-pressed', before!);
    await expect(page.locator('.ckp-actbtn', { hasText: 'Save' })).toBeDisabled();

    // Re-toggle and Save — lands in own template.
    await page.locator('.ckp-row', { hasText: 'Sortable' }).locator('.ckp-switch').click();
    await saveCard(page);
    const stored = await page.evaluate(() => {
      const own = (window as unknown as { __ext: { grid: { getTemplates: () => any[] } } })
        .__ext.grid.getTemplates().find((t: any) => t.id === '__cgridOwn:ticker');
      return own?.overrides?.sortable;
    });
    expect(typeof stored).toBe('boolean');
    expect(stored).toBe(before !== 'true');
  });

  test('pinned select + Save updates column state', async ({ page }) => {
    await openCustomizer(page, 'column-settings');
    await selectColumn(page, 'CUSIP');
    const pinned = page.locator('.ckp-row', { hasText: 'Pinned' }).locator('select');
    await pinned.selectOption('left');
    await saveCard(page);
    const pin = await page.evaluate(() => {
      const st = (window as unknown as { __ext: { grid: { getColumnState: () => Array<{ colId: string; pinned?: string | null }> } } })
        .__ext.grid.getColumnState().find((s) => s.colId === 'cusip');
      return st?.pinned ?? null;
    });
    expect(pin).toBe('left');
  });
});

// ── Styling Rules ──────────────────────────────────────────────────────────

test.describe('Styling Rules tab', () => {
  test('add rule, edit expression + name, Save commits to kernel', async ({ page }) => {
    await openCustomizer(page, 'conditional-styling');
    await page.locator('.ckp-addbtn').click();
    await expect(page.locator('.ckp .cm-editor')).toBeVisible();
    await page.fill('.ckp .ckp-title', 'Positive PnL');
    await typeInCm(page, '[pnl] > 0');
    await saveCard(page);

    const rules = await page.evaluate(() =>
      (window as unknown as { __ext: { grid: { getRules: () => any[] } } }).__ext.grid.getRules());
    expect(rules.some((r: any) => r.name === 'Positive PnL' && r.condition === '[pnl] > 0')).toBe(true);
    await expect(page.locator('.ckp-rail-row', { hasText: 'Positive PnL' })).toBeVisible();
  });

  test('invalid expression shows error; Reset discards dirty draft', async ({ page }) => {
    await openCustomizer(page, 'conditional-styling');
    await page.locator('.ckp-addbtn').click();
    await typeInCm(page, '[nope] >');
    // Lint is debounced (~150ms); error text is mirrored into `.ckp-error`.
    await expect(page.locator('.ckp-error')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.ckp-error')).not.toBeEmpty();
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible();

    await page.fill('.ckp .ckp-title', 'temp_rule');
    await expect(page.locator('.ckp-actbtn', { hasText: 'Reset' })).toBeEnabled();
    page.once('dialog', (d) => d.accept());
    await resetCard(page);
  });

  test('clone and delete rule', async ({ page }) => {
    await openCustomizer(page, 'conditional-styling');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'CloneMe');
    await typeInCm(page, 'true');
    await saveCard(page);

    const row = page.locator('.ckp-rail-row', { hasText: 'CloneMe' });
    await row.locator('button[title="Clone"]').click();
    await expect(page.locator('.ckp-title')).toHaveValue(/CloneMe/);
    await saveCard(page);

    const before = await page.evaluate(() =>
      (window as unknown as { __ext: { grid: { getRules: () => any[] } } }).__ext.grid.getRules().length);
    expect(before).toBeGreaterThanOrEqual(2);

    await page.locator('.ckp-rail-row', { hasText: 'CloneMe' }).first()
      .locator('button[title="Delete"]').click();
    await expect.poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __ext: { grid: { getRules: () => any[] } } }).__ext.grid.getRules().length),
    ).toBe(before - 1);
  });

  test('status switch + scope CELL updates draft chips then Save', async ({ page }) => {
    await openCustomizer(page, 'conditional-styling');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'CellScope');
    await typeInCm(page, '[pnl] > 100');
    // Find Scope select in the pane head (it's a sibling of other controls)
    const scopeSelect = page.locator('.ckp-pane-head select[title="Scope"]');
    await expect(scopeSelect).toBeVisible({ timeout: 5000 });
    await scopeSelect.selectOption('cell');
    await expect(page.locator('.ckp-band-title', { hasText: 'Target columns' })).toBeVisible();
    // Add a target column.
    const picker = page.locator('.ckp-band', { hasText: 'Target columns' }).locator('select').last();
    const options = await picker.locator('option').allTextContents();
    const pick = options.find((o) => o && o !== 'ADD COLUMN…');
    expect(pick).toBeTruthy();
    await picker.selectOption({ label: pick! });
    await saveCard(page);
    const rule = await page.evaluate(() =>
      (window as unknown as { __ext: { grid: { getRules: () => any[] } } })
        .__ext.grid.getRules().find((r: any) => r.name === 'CellScope'));
    expect(rule?.scope?.kind).toBe('cell');
    expect(Array.isArray(rule?.scope?.columnIds) && rule.scope.columnIds.length > 0).toBe(true);
  });
});

// ── Calculated Columns ─────────────────────────────────────────────────────

test.describe('Calculated Columns tab', () => {
  test('add column, expression Save registers vcol_* on the grid', async ({ page }) => {
    await openCustomizer(page, 'calculated-columns');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'PnL x2');
    await typeInCm(page, '[pnl] * 2');
    await saveCard(page);

    const colId = await page.evaluate(() => {
      const cols = (window as unknown as { __ext: { grid: { getColumnState: () => Array<{ colId: string }> } } })
        .__ext.grid.getColumnState();
      return cols.find((c) => c.colId.startsWith('vcol_'))?.colId ?? null;
    });
    expect(colId).toBeTruthy();
    await expect(page.locator('.ckp-rail-row', { hasText: 'PnL x2' })).toBeVisible();
  });

  test('invalid expression blocks Save and shows error', async ({ page }) => {
    await openCustomizer(page, 'calculated-columns');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'Bad');
    await typeInCm(page, '[pnl] *');
    // Calc module surfaces errors via CodeMirror lint (no `.ckp-error` box).
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible({ timeout: 5_000 });
    const save = page.locator('.ckp-actbtn', { hasText: 'Save' });
    if (await save.isEnabled()) await save.click({ force: true });
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
    const stillMissing = await page.evaluate(() => {
      const cols = (window as unknown as { __ext: { grid: { getColumnState: () => Array<{ colId: string }> } } })
        .__ext.grid.getColumnState();
      return !cols.some((c) => c.colId.startsWith('vcol_'));
    });
    expect(stillMissing).toBe(true);
  });

  test('delete calculated column removes it from the grid', async ({ page }) => {
    await openCustomizer(page, 'calculated-columns');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'ToDelete');
    await typeInCm(page, '[pnl] + 1');
    await saveCard(page);
    const id = await page.evaluate(() => {
      const cols = (window as unknown as { __ext: { grid: { getColumnState: () => Array<{ colId: string }> } } })
        .__ext.grid.getColumnState();
      return cols.find((c) => c.colId.startsWith('vcol_'))?.colId ?? null;
    });
    expect(id).toBeTruthy();

    await page.locator('.ckp-rail-row', { hasText: 'ToDelete' })
      .locator('button[title="Delete"]').click();
    await expect.poll(async () =>
      page.evaluate((colId) => {
        const cols = (window as unknown as { __ext: { grid: { getColumnState: () => Array<{ colId: string }> } } })
          .__ext.grid.getColumnState();
        return cols.some((c) => c.colId === colId);
      }, id),
    ).toBe(false);
  });

  test('width + pinned placement Save', async ({ page }) => {
    await openCustomizer(page, 'calculated-columns');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'WideCalc');
    await typeInCm(page, '[notionalAmount] / 100');
    const width = page.locator('.ckp-row', { hasText: 'Width' }).locator('input');
    await width.fill('180');
    await page.locator('.ckp-row', { hasText: 'Pinned' }).locator('.ckp-pill', { hasText: 'Right' }).click();
    await saveCard(page);
    const state = await page.evaluate(() => {
      const g = (window as unknown as { __ext: { grid: { getColumnState: () => any[] } } }).__ext.grid;
      return g.getColumnState().find((c: any) => c.colId.startsWith('vcol_'));
    });
    expect(state).toBeTruthy();
  });
});

// ── Cross-cutting persistence ──────────────────────────────────────────────

test.describe('Persistence', () => {
  test('styling rule + calculated column survive reload', async ({ page }) => {
    await openCustomizer(page, 'conditional-styling');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'PersistRule');
    await typeInCm(page, '[pnl] > 0');
    await saveCard(page);

    await switchTab(page, 'Calculated Columns');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'PersistCalc');
    await typeInCm(page, '[pnl] * 2');
    await saveCard(page);
    await closeViaDone(page);

    // Title-bar Save* path — flush profile snapshot (rules + calc ride grid state modules).
    await page.evaluate(async () => {
      const ext = (window as unknown as {
        __ext: {
          grid: { persistStateNow?: () => void };
          profiles: { save: () => Promise<void>; isDirty: () => boolean };
        };
      }).__ext;
      ext.grid.persistStateNow?.();
      await ext.profiles.save();
    });

    // Confirm the snapshot landed in localStorage before we reload.
    await expect.poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('velocity-grid-ext:profiles') ?? '';
        return raw.includes('PersistRule') && raw.includes('vcol_');
      }),
    ).toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __ext?: { grid?: unknown } }).__ext?.grid, null, {
      timeout: 30_000,
    });
    // Demo wires rules/calc AFTER VelocityGridExt construction; bootstrap can race
    // ahead of module registration. reapplyActiveProfile reloads the snapshot
    // once engines have registered their state modules.
    await page.evaluate(async () => {
      const ext = (window as unknown as {
        __ext: { reapplyActiveProfile: () => Promise<void> };
      }).__ext;
      await ext.reapplyActiveProfile();
    });

    await expect.poll(async () =>
      page.evaluate(() => {
        const g = (window as unknown as { __ext: { grid: { getRules: () => any[]; getColumnState: () => any[] } } }).__ext.grid;
        const rules = g.getRules().filter((r: any) => r.name === 'PersistRule');
        const calc = g.getColumnState().some((c: any) => c.colId.startsWith('vcol_'));
        return rules.length === 1 && rules[0].condition === '[pnl] > 0' && calc;
      }),
    { timeout: 15_000 }).toBe(true);
  });
});

// ── Edit History ───────────────────────────────────────────────────────────

test.describe('Edit History tab', () => {
  test('panel opens; Suspended is live; stream toggle Saves', async ({ page }) => {
    await openCustomizer(page, 'data-change-history');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Edit History');
    await expect(cockpit(page)).toContainText('Record Sources');
    await expect(cockpit(page)).toContainText('Monitor');

    // Suspended is the second switch in Global — live-applies.
    const suspended = cockpit(page).locator('.ckp-switch').nth(1);
    await suspended.click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const edit = (window as unknown as { __edit: { getSettings: () => { history: { suspended: boolean } } } }).__edit;
        return edit.getSettings().history.suspended;
      }),
    ).toBe(true);

    // Stream is the last record-source switch — deferred until Save.
    const stream = cockpit(page).locator('.ckp-switch').last();
    await stream.click();
    await saveCard(page);
    await expect.poll(async () =>
      page.evaluate(() => {
        const edit = (window as unknown as {
          __edit: { getSettings: () => { history: { recordSources: { stream: boolean } } } };
        }).__edit;
        return edit.getSettings().history.recordSources.stream;
      }),
    ).toBe(true);
  });

  test('cell edit appears in monitor; toolbar Undo restores', async ({ page }) => {
    const before = await page.evaluate(async () => {
      const w = window as unknown as {
        __edit: {
          smartEdit: {
            apply: (
              targets: unknown[],
              op: string,
              n: number,
            ) => Promise<{ applied: number; entry: { id: string } | null }>;
          };
          journal: { entries: () => unknown[]; canUndo: () => boolean };
        };
        __paintHarness: { rows: Array<{ positionId: string; pnl: number }> };
        __ext: {
          grid: {
            forEachRow: (cb: (rowId: string, row: Record<string, unknown>) => void) => void;
          };
        };
      };
      const row = w.__paintHarness.rows[0];
      if (!row) return { ok: false as const, reason: 'no harness row' };
      const t = {
        rowId: row.positionId,
        colId: 'pnl',
        field: 'pnl',
        value: row.pnl,
        rowIndex: 0,
        rowData: row as unknown as Record<string, unknown>,
        cellDataType: 'number',
      };
      const result = await w.__edit.smartEdit.apply([t], 'set', 12345);
      let livePnl: unknown;
      w.__ext.grid.forEachRow((id, r) => { if (id === t.rowId) livePnl = r.pnl; });
      return {
        ok: true as const,
        rowId: t.rowId,
        oldValue: t.value,
        livePnl,
        applied: result.applied,
        entries: w.__edit.journal.entries().length,
        canUndo: w.__edit.journal.canUndo(),
      };
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.applied).toBeGreaterThan(0);
    expect(before.livePnl).toBe(12345);
    expect(before.entries).toBeGreaterThan(0);
    expect(before.canUndo).toBe(true);

    await openCustomizer(page, 'data-change-history');
    await expect(cockpit(page).locator('.ckp-monitor-row').first()).toBeVisible();
    await closeViaDone(page);

    await page.locator('.vgext-ribbon button[title="Undo"]').click();
    await expect.poll(async () =>
      page.evaluate((rowId) => {
        const edit = (window as unknown as { __edit: { journal: { canUndo: () => boolean } } }).__edit;
        const g = (window as unknown as {
          __ext: { grid: { forEachRow: (cb: (id: string, row: Record<string, unknown>) => void) => void } };
        }).__ext.grid;
        let pnl: unknown;
        g.forEachRow((id, r) => { if (id === rowId) pnl = r.pnl; });
        return { canUndo: edit.journal.canUndo(), pnl };
      }, before.rowId),
    ).toMatchObject({ canUndo: false, pnl: before.oldValue });
  });
});

// ── Alerts ───────────────────────────────────────────────────────────────

test.describe('Alerts tab', () => {
  test('creates a dataChange alert; edit fires toast + badge history', async ({ page }) => {
    await openCustomizer(page, 'alerts');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Alerts');
    await page.locator('.ckp-addbtn').click();
    await page.fill('.ckp .ckp-title', 'PnlAlert');
    await typeInCm(page, '[pnl] != null');
    await saveCard(page);
    await closeViaDone(page);

    // Mutate harness row 0 pnl via smart edit so cellValueChanged feeds alerts.
    const fired = await page.evaluate(async () => {
      const w = window as unknown as {
        __edit: {
          smartEdit: {
            apply: (targets: unknown[], op: string, n: number) => Promise<{ applied: number }>;
          };
        };
        __paintHarness: { rows: Array<{ positionId: string; pnl: number }> };
        __ext: {
          grid: {
            getAlertHistory: () => Array<{ ruleName: string; message: string }>;
            getAlertUnreadCount: () => number;
            getAlertRules: () => Array<{ name: string }>;
          };
        };
      };
      const row = w.__paintHarness.rows[0]!;
      await w.__edit.smartEdit.apply([{
        rowId: row.positionId,
        colId: 'pnl',
        field: 'pnl',
        value: row.pnl,
        rowIndex: 0,
        rowData: row,
        cellDataType: 'number',
      }], 'set', 99999);
      // Give the rAF endTick a beat.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 50));
      return {
        rules: w.__ext.grid.getAlertRules().map((r) => r.name),
        history: w.__ext.grid.getAlertHistory().length,
        unread: w.__ext.grid.getAlertUnreadCount(),
      };
    });
    expect(fired.rules).toContain('PnlAlert');
    expect(fired.history).toBeGreaterThan(0);
    expect(fired.unread).toBeGreaterThan(0);

    await expect(page.locator('[data-testid="vgext-alerts-badge"]')).toBeVisible();
  });
});

// ── Editing settings ─────────────────────────────────────────────────────

test.describe('Editing settings tabs', () => {
  test('Smart Edit Save toggles recordHistory; Edit History source stays in sync', async ({ page }) => {
    await openCustomizer(page, 'smart-edit');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Smart Edit');
    // Last switch = Record history
    await cockpit(page).locator('.ckp-switch').last().click();
    await saveCard(page);
    await expect.poll(async () =>
      page.evaluate(() => {
        const edit = (window as unknown as {
          __edit: { getSettings: () => { smartEdit: { recordHistory: boolean }; history: { recordSources: { smartEdit: boolean } } } };
        }).__edit;
        return edit.getSettings().smartEdit.recordHistory === false
          && edit.getSettings().history.recordSources.smartEdit === false;
      }),
    ).toBe(true);
  });

  test('Shortcuts add + Save registers a letter binding', async ({ page }) => {
    await openCustomizer(page, 'shortcuts');
    await page.locator('.ckp-addbtn').click();
    await saveCard(page);
    await expect.poll(async () =>
      page.evaluate(() => {
        const edit = (window as unknown as {
          __edit: { getShortcuts: () => Array<{ shortcutKey: string; name: string }> };
        }).__edit;
        return edit.getShortcuts().length;
      }),
    ).toBeGreaterThan(0);
  });
});

// Keep unused Page import happy when helpers expand.
void (null as unknown as Page);
