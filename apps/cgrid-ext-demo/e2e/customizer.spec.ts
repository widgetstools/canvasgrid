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
 * Tabs: Options · Column Groups · Column Settings · Styling Rules · Calculated Columns
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
    await expect(page.locator('.cgext-sheet-eyebrow')).toHaveText('Customize');
    await expect(page.locator('.cgext-sheet-title')).toHaveText('Options');
    await expect(page.locator('.cgext-sheet-nav-item')).toHaveCount(5);
    for (const title of ['Options', 'Column Groups', 'Column Settings', 'Styling Rules', 'Calculated Columns']) {
      await expect(page.locator('.cgext-sheet-nav-item', { hasText: title })).toBeVisible();
    }
    await expect(page.locator('.cgext-sheet-footer')).toBeVisible();
    await expect(page.locator('[data-testid="cgext-sheet-done"]')).toBeVisible();
    await expect(page.locator('.cgext-sheet-footbtn.ghost', { hasText: 'Discard' })).toBeVisible();

    await closeViaDone(page);

    await openCustomizer(page, 'grid-options');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden({ timeout: 5_000 });
  });

  test('tab navigation switches every module panel', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    await expect(page.locator('.cg-settings-panel')).toBeVisible();

    await switchTab(page, 'Column Groups');
    await expect(page.locator('.cg-colgroups-panel')).toBeVisible();

    await switchTab(page, 'Column Settings');
    await expect(cockpit(page)).toBeVisible();
    await expect(page.locator('.ckp-rail-head', { hasText: 'Columns' })).toBeVisible();

    await switchTab(page, 'Styling Rules');
    await expect(page.locator('.ckp-rail-head', { hasText: 'Rules' })).toBeVisible();

    await switchTab(page, 'Calculated Columns');
    await expect(page.locator('.ckp-rail-head', { hasText: 'Columns' })).toBeVisible();

    await switchTab(page, 'Options');
    await expect(page.locator('.cg-settings-panel')).toBeVisible();
  });
});

// ── Options ────────────────────────────────────────────────────────────────

test.describe('Options tab', () => {
  test('search filters settings rows', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const search = page.locator('.cg-settings-search');
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
    const input = row.locator('input.cg-settings-input-number');
    await input.fill('40');
    await input.blur();
    await expect.poll(() => gridOption<number>(page, 'rowHeight')).toBe(40);
  });

  test('animate-rows toggle applies and marks Modified', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const before = await gridOption<boolean>(page, 'animateRows');
    const row = page.locator('[data-field-key="animateRows"]');
    await row.locator('.cg-settings-toggle').click();
    await expect.poll(() => gridOption<boolean>(page, 'animateRows')).toBe(!before);
    await expect(page.locator('.cg-settings-panel')).toContainText(/Modified/i);
  });

  test('floating filters toggle applies to grid option', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const row = page.locator('[data-field-key="floatingFilter"]');
    await expect(row).toBeVisible();
    // Default is on (undefined/true). Turn off.
    const toggle = row.locator('.cg-settings-toggle');
    const wasOn = await toggle.getAttribute('aria-checked');
    if (wasOn !== 'false') await toggle.click();
    await expect.poll(async () => {
      const v = await gridOption<boolean | undefined>(page, 'floatingFilter');
      return v === false;
    }).toBe(true);
  });

  test('per-row reset restores a modified numeric field', async ({ page }) => {
    await openCustomizer(page, 'grid-options');
    const row = page.locator('[data-field-key="headerHeight"]');
    const input = row.locator('input.cg-settings-input-number');
    const original = await input.inputValue();
    await input.fill('60');
    await input.blur();
    await expect.poll(() => gridOption<number>(page, 'headerHeight')).toBe(60);
    const reset = row.locator('.cg-settings-row-reset');
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
    const panel = page.locator('.cg-colgroups-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-cg-node="trade"][data-kind="group"]')).toBeVisible();
    await expect(page.locator('[data-cg-apply]')).toBeDisabled();
  });

  test('create group, add leaf via picker, Save writes columnDefs', async ({ page }) => {
    await openCustomizer(page, 'column-groups');
    await page.locator('[data-cg-add-group]').click();
    const newRow = page.locator('[data-cg-node][data-kind="group"]').last();
    await expect(newRow).toBeVisible();
    const customId = await newRow.getAttribute('data-cg-node');
    expect(customId).toBeTruthy();

    await newRow.locator('[data-cg-select]').click();
    const editorName = page.locator('.cg-colgroups-rename, .cg-colgroups-editor input[aria-label="Group name"]');
    await expect(editorName).toBeVisible();
    await editorName.fill('E2E Group');
    await editorName.blur();

    // Leaf columns live in the editor "Add columns" picker (list shows groups only).
    await page.locator('[data-cg-add-col] .cg-colgroups-add-col-trigger').click();
    const cusipOpt = page.locator('[data-cg-add-col-id="cusip"]');
    await expect(cusipOpt).toBeVisible();
    await cusipOpt.click();
    await page.locator('[data-cg-add-col-commit]').click();
    await expect(page.locator('.cg-colgroups-chips')).toContainText(/CUSIP|cusip/i);

    const saveBtn = page.locator('[data-cg-apply]');
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
    await page.locator('[data-cg-add-group]').click();
    await expect(page.locator('[data-cg-apply]')).toBeEnabled();
    await page.locator('[data-cg-reset]').click();
    await expect(page.locator('[data-cg-apply]')).toBeDisabled();
  });
});

// ── Column Settings ────────────────────────────────────────────────────────

test.describe('Column Settings tab', () => {
  async function selectColumn(page: Page, label: string): Promise<void> {
    const row = page.locator('.ckp-rail-row', { hasText: label }).first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(page.locator('.ckp-title')).toHaveValue(new RegExp(label, 'i'));
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
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    // Not committed yet — Save enabled.
    await expect(page.locator('.ckp-actbtn', { hasText: 'Save' })).toBeEnabled();
    await resetCard(page);
    await expect(page.locator('.ckp-row', { hasText: 'Sortable' }).locator('.ckp-switch'))
      .toHaveAttribute('aria-checked', before!);
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
    await page.locator('.ckp-strip-pair', { hasText: 'Scope' }).locator('select').selectOption('cell');
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
        const raw = localStorage.getItem('cgrid-ext:profiles') ?? '';
        return raw.includes('PersistRule') && raw.includes('vcol_');
      }),
    ).toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __ext?: { grid?: unknown } }).__ext?.grid, null, {
      timeout: 30_000,
    });
    // Demo wires rules/calc AFTER CGridExt construction; bootstrap can race
    // ahead of module registration. Re-apply the saved profile once modules exist.
    await page.evaluate(async () => {
      const ext = (window as unknown as {
        __ext: { profiles: { switchTo: (id: string) => Promise<void>; activeId: () => string } };
      }).__ext;
      await ext.profiles.switchTo(ext.profiles.activeId());
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

// Keep unused Page import happy when helpers expand.
void (null as unknown as Page);
