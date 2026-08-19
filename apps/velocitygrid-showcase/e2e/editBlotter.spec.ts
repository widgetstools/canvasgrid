import { test, expect, type Page } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21g / Task 12 — edit-blotter feature.
//
// Cells are canvas-painted; edits round-trip through the kernel's REAL
// `.vg-editor-overlay input` DOM overlay (commitBack.test.ts precedent) —
// so this suite drives real dblclick/keyboard input, not just probing
// resolved colDefs. `window.__cgridEdit` (the `EditBridgeHandle`) is the
// assertion surface for journal/smart-edit/bulk-update state; `window.__cgrid`
// supplies geometry (`getCellBoundsAt`) and cell values (`getCellValue`).
//
// DISCOVERED KERNEL DEFECT (same root cause as
// `rendererBlotter.spec.ts`'s F5 test, a DIFFERENT call site): plus/minus
// nudges and letter shortcuts are routed through the kernel's `cellKeyDown`
// event, whose `rowId` is stamped by the private `rowIdAt(rowIndex)` stub
// (`packages/kernel/src/velocityGrid.ts` — "Foundation" stub, always returns a
// synthetic `row-N`; see `stringRowIdAt` a few lines below it for the real
// per-chunk string ids). `wireEditIntoKernel`'s `buildFocusedTarget` (Task
// 11, `packages/edit/src/bridge.ts`) looks that `rowId` up in a bridge-owned
// `rowMirror` keyed by the REAL string ids (seeded from `forEachRow` /
// `rowsChanged`) — the synthetic id never matches, so the lookup misses,
// `buildFocusedTarget` returns `null`, and `tryNudge` / `tryShortcut` return
// BEFORE calling `preventDefault()`. Net effect, confirmed by manually
// exercising the running dev server before writing these tests. HISTORY:
// tests 4, 5, and 8 were originally `test.fail()` tripwires because the
// kernel's `rowIdAt()` stub fed synthetic `row-N` ids into `cellKeyDown`,
// so nudges/shortcuts could never intercept against a real kernel. PR #98
// fixed `rowIdAt()` to delegate to `stringRowIdAt()`, and the tripwires
// were flipped to genuinely-passing tests on that PR's branch.

const EDITOR_INPUT = '.vg-editor-overlay input';

interface Bounds { x: number; y: number; w: number; h: number }

async function cellBounds(page: Page, rowIndex: number, colId: string): Promise<Bounds> {
  return page.evaluate(([ri, cid]) => (window.__cgrid as unknown as {
    getCellBoundsAt: (r: number, c: string) => Bounds;
  }).getCellBoundsAt(ri as number, cid as string), [rowIndex, colId] as const);
}

async function clickCell(page: Page, rowIndex: number, colId: string, opts?: { shift?: boolean; dbl?: boolean }): Promise<void> {
  const b = await cellBounds(page, rowIndex, colId);
  const canvas = page.locator('#grid-host canvas').first();
  const position = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  if (opts?.dbl) {
    await canvas.dblclick({ position });
  } else if (opts?.shift) {
    await canvas.click({ position, modifiers: ['Shift'] });
  } else {
    await canvas.click({ position });
  }
}

async function cellValue(page: Page, rowIndex: number, colId: string): Promise<unknown> {
  return page.evaluate(([ri, cid]) => (window.__cgrid as unknown as {
    getCellValue: (r: number, c: string) => unknown;
  }).getCellValue(ri as number, cid as string), [rowIndex, colId] as const);
}

async function journalEntries(page: Page): Promise<Array<{ source: string; patches: Array<{ rowId: string }> }>> {
  return page.evaluate(() => (window.__cgridEdit as unknown as {
    journal: { entries: () => Array<{ source: string; patches: Array<{ rowId: string }> }> };
  }).journal.entries());
}

test.describe('edit blotter feature', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'edit-blotter');
  });

  test('loads with 12 rows and Cycle 21g description; wires window.__cgridEdit', async ({ page }) => {
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21g');
    await expect(page.locator('#grid-host canvas').first()).toBeVisible();
    const rowCount: number = await page.evaluate(() => (window.__cgrid as unknown as { rowCount: number }).rowCount);
    expect(rowCount).toBe(12);
    const wired = await page.evaluate(() => {
      const h = window.__cgridEdit;
      return {
        hasJournal: !!h?.journal,
        hasSmartEdit: typeof h?.smartEdit?.apply === 'function',
        hasBulkUpdate: typeof h?.bulkUpdate?.apply === 'function',
      };
    });
    expect(wired).toEqual({ hasJournal: true, hasSmartEdit: true, hasBulkUpdate: true });
  });

  test('editor round-trip: dblclick, type, Enter commits (+K/M/B magnitude on price); undo restores + canRedo', async ({ page }) => {
    // qty — plain digits.
    await clickCell(page, 0, 'qty', { dbl: true });
    const input = page.locator(EDITOR_INPUT);
    await expect(input).toBeVisible();
    await input.fill('999');
    await input.press('Enter');

    await expect.poll(() => cellValue(page, 0, 'qty')).toBe(999);
    const entries = await journalEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe('cell-editor');
    expect(entries[0]!.patches[0]!.rowId).toBe('e1'); // real id, not synthetic

    await page.getByTestId('btn-edit-undo').click();
    await expect.poll(() => cellValue(page, 0, 'qty')).toBe(100);
    const canRedo = await page.evaluate(() => (window.__cgridEdit as unknown as {
      journal: { canRedo: () => boolean };
    }).journal.canRedo());
    expect(canRedo).toBe(true);

    // price — K/M/B magnitude suffix (applyMagnitudeColDefTransforms, §4.2.5):
    // the typed string "2M" must commit as the number 2000000.
    await clickCell(page, 0, 'price', { dbl: true });
    await page.locator(EDITOR_INPUT).fill('2M');
    await page.locator(EDITOR_INPUT).press('Enter');
    await expect.poll(() => cellValue(page, 0, 'price')).toBe(2_000_000);
  });

  test('smart-edit ×2 over a dragged (shift-click) range, one journal entry, undo restores all', async ({ page }) => {
    await clickCell(page, 0, 'qty');
    await clickCell(page, 2, 'qty', { shift: true });
    const ranges = await page.evaluate(() => (window.__cgrid as unknown as {
      getCellRanges: () => Array<{ rowStart: number; rowEnd: number; colIds: string[] }>;
    }).getCellRanges());
    expect(ranges).toEqual([{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }]);

    const before = await Promise.all([0, 1, 2].map((i) => cellValue(page, i, 'qty')));
    expect(before).toEqual([100, 200, 50]);

    await page.getByTestId('btn-edit-op-multiply').click();
    await page.getByTestId('input-edit-operand').fill('2');
    await page.getByTestId('btn-edit-smartedit-apply').click();

    await expect.poll(() => cellValue(page, 0, 'qty')).toBe(200);
    expect(await cellValue(page, 1, 'qty')).toBe(400);
    expect(await cellValue(page, 2, 'qty')).toBe(100);

    const entries = await journalEntries(page);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe('smart-edit');
    expect(entries[0]!.patches).toHaveLength(3);
    for (const patch of entries[0]!.patches) expect(patch.rowId).not.toMatch(/^row-\d+$/);

    await page.getByTestId('btn-edit-undo').click();
    await expect.poll(() => cellValue(page, 0, 'qty')).toBe(100);
    expect(await cellValue(page, 1, 'qty')).toBe(200);
    expect(await cellValue(page, 2, 'qty')).toBe(50);
  });

  test('bulk-update with a distinct-values pick applies to the whole selected range', async ({ page }) => {
    await clickCell(page, 0, 'trader');
    await clickCell(page, 2, 'trader', { shift: true });

    const options = await page.locator('[data-testid=select-edit-bulk-distinct] option').allTextContents();
    expect(options).toEqual(['Distinct trader…', 'Alice', 'Bob', 'Carol', 'Dave']);

    await page.locator('[data-testid=select-edit-bulk-distinct]').selectOption({ label: 'Bob' });
    await expect(page.getByTestId('input-edit-bulk-value')).toHaveValue('Bob');

    await page.getByTestId('btn-edit-bulk-apply').click();

    await expect.poll(() => cellValue(page, 0, 'trader')).toBe('Bob');
    expect(await cellValue(page, 1, 'trader')).toBe('Bob');
    expect(await cellValue(page, 2, 'trader')).toBe('Bob');

    const entries = await journalEntries(page);
    expect(entries[entries.length - 1]!.source).toBe('bulk-update');
  });

  test('expression-gated + nudge: active row nudges price, inactive row opens the editor instead', async ({ page }) => {
    // Row 0 (e1) is `status: 'active'` — [status] == "active" gate passes,
    // so `+` should nudge price by +0.25 and record a 'plus-minus' entry
    // WITHOUT opening the editor.
    await clickCell(page, 0, 'price');
    const beforeActive = await cellValue(page, 0, 'price');
    await page.keyboard.press('+');
    await expect.poll(() => cellValue(page, 0, 'price')).toBe((beforeActive as number) + 0.25);
    await expect(page.locator(EDITOR_INPUT)).toHaveCount(0);
    const entries = await journalEntries(page);
    expect(entries[entries.length - 1]!.source).toBe('plus-minus');

    // Row 1 (e2) is `status: 'inactive'` — gate fails, nudge resolution
    // skips this row entirely, so `+` falls through to type-to-edit: value
    // stays put, no new journal entry, and the cell editor opens instead.
    await clickCell(page, 1, 'price');
    const beforeInactive = await cellValue(page, 1, 'price');
    const countBefore = (await journalEntries(page)).length;
    await page.keyboard.press('+');
    await expect(page.locator(EDITOR_INPUT)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await cellValue(page, 1, 'price')).toBe(beforeInactive);
    expect((await journalEntries(page)).length).toBe(countBefore);
  });

  test('scoped shortcut letter: "q" nudges qty +10 in scope, opens the editor out of scope', async ({ page }) => {
    // "q" is scoped to `qty` — pressing it while `qty` is focused adds 10
    // and records a 'shortcut' entry.
    await clickCell(page, 0, 'qty');
    const beforeQty = await cellValue(page, 0, 'qty');
    await page.keyboard.press('q');
    await expect.poll(() => cellValue(page, 0, 'qty')).toBe((beforeQty as number) + 10);
    const entries = await journalEntries(page);
    expect(entries[entries.length - 1]!.source).toBe('shortcut');

    // "q" is NOT scoped to `trader` — out-of-scope, so it falls through to
    // type-to-edit: the editor opens with "q" as the initial typed value.
    await clickCell(page, 0, 'trader');
    await page.keyboard.press('q');
    const input = page.locator(EDITOR_INPUT);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('q');
    await page.keyboard.press('Escape');
  });

  test('"+" on a non-nudge column (trader) is NOT intercepted — the editor opens', async ({ page }) => {
    await clickCell(page, 0, 'trader');
    await page.keyboard.press('+');
    await expect(page.locator(EDITOR_INPUT)).toBeVisible();
    await page.keyboard.press('Escape');
    const entries = await journalEntries(page);
    expect(entries).toHaveLength(0);
  });

  test('selection is restored after a programmatic smart-edit apply', async ({ page }) => {
    await clickCell(page, 0, 'qty');
    await clickCell(page, 2, 'qty', { shift: true });
    const before = await page.evaluate(() => ({
      ranges: (window.__cgrid as unknown as { getCellRanges: () => unknown }).getCellRanges(),
      focused: (window.__cgrid as unknown as { getFocusedCell: () => unknown }).getFocusedCell(),
    }));

    await page.getByTestId('btn-edit-op-add').click();
    await page.getByTestId('input-edit-operand').fill('5');
    await page.getByTestId('btn-edit-smartedit-apply').click();
    await expect.poll(() => cellValue(page, 0, 'qty')).toBe(105);

    const after = await page.evaluate(() => ({
      ranges: (window.__cgrid as unknown as { getCellRanges: () => unknown }).getCellRanges(),
      focused: (window.__cgrid as unknown as { getFocusedCell: () => unknown }).getFocusedCell(),
    }));
    expect(after).toEqual(before);
  });

  // Real-rowId proof (PR #98 landed) — exercised via a qty minus-nudge so
  // it isn't a literal duplicate of the plus/shortcut tests: the patch must
  // carry the row's real string id, never the legacy synthetic `row-N`.
  test('real-rowId proof: a qty minus-nudge patch carries the real string rowId, not row-N', async ({ page }) => {
    await clickCell(page, 0, 'qty');
    const before = await cellValue(page, 0, 'qty');
    await page.keyboard.press('-');
    await expect.poll(() => cellValue(page, 0, 'qty')).toBe((before as number) - 1);

    const entries = await journalEntries(page);
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1]!;
    expect(last.source).toBe('plus-minus');
    for (const patch of last.patches) expect(patch.rowId).not.toMatch(/^row-\d+$/);
  });
});
