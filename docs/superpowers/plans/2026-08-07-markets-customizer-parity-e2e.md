# Markets Customizer Parity E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status (2026-08-07):** Phase 1–3 scaffolding complete. Phase 1 (14) + Phase 2 (9) e2e green. Checklist at `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md`. Remaining items are `gap` rows in the checklist.

**Goal:** Add hermetic Playwright coverage proving Customize + toolbar settings match Markets behavior and the grid executes them.

**Architecture:** Split specs by Markets module under `apps/cgrid-ext-demo/e2e/`. Shared boot/helpers in `helpers/customizer.ts` (+ `helpers/editOps.ts`). Assert via `__ext.grid` / `__edit` APIs on `/?paintHarness`. Phases: (1) Customize gap-fill → (2) toolbar → (3) checklist + remaining gaps.

**Tech Stack:** Playwright, Vite demo on `:5188`, `@wellsfargo-starui/velocity-grid-edit` `EditBridgeHandle`, existing `bootCustomizer` / `openCustomizer` helpers.

## Global Constraints

- Boot only `/?paintHarness` (no STOMP) for these specs
- Cite Markets source: `// Markets: v2-<name> — <case>`
- Prefer `__edit.*.apply` + `addCellRange` over canvas cell clicks
- Do not blur CodeMirror before Save; do not Esc while typing in CM
- Do not start Phase 2 until Phase 1 green; Phase 3 after Phase 2 green
- Keep existing `customizer.spec.ts` smoke; do not dedupe until new specs green

---

## File map

| Path | Role |
|------|------|
| `e2e/helpers/customizer.ts` | Existing boot / sheet helpers (extend lightly) |
| `e2e/helpers/editOps.ts` | **Create** — selection, harness row, apply bulk/smart/±/shortcut, read cell |
| `e2e/customizer-bulkUpdate.spec.ts` | Phase 1 |
| `e2e/customizer-plusMinus.spec.ts` | Phase 1 |
| `e2e/customizer-smartEdit.spec.ts` | Phase 1 |
| `e2e/customizer-shortcuts.spec.ts` | Phase 1 |
| `e2e/customizer-alerts.spec.ts` | Phase 1 |
| `e2e/savedFilters.spec.ts` | Phase 2 |
| `e2e/formattingToolbar.spec.ts` | Phase 2 |
| `e2e/parity/CHECKLIST.md` | Phase 3 |
| `apps/cgrid-ext-demo/package.json` | Wire `test:e2e:customizer` / `test:e2e:parity` |

**Window APIs (demo):**
- `__ext.grid` — `addCellRange`, `forEachRow`, `getFilterModel`, `setFilterModel`, `getAlertRules`, `getAlertHistory`, `getAlertUnreadCount`, `markAlertRead`, `getGridOption`, …
- `__edit` — `EditBridgeHandle`: `smartEdit.apply`, `bulkUpdate.apply`, `getSettings`, `updateSettings`, `getNudges`, `setNudges`, `getShortcuts`, `setShortcuts`, `journal`
- `__paintHarness.rows` — seed rows with `positionId`, `pnl`, `currency`, etc.

---

### Task 1: Edit-ops helpers

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/helpers/editOps.ts`
- Modify: `apps/cgrid-ext-demo/package.json` (script wiring can wait until Task 2 green, or land here)

**Interfaces:**
- Produces:
  - `harnessRow(page, index?): Promise<{ positionId, pnl, currency, ... }>`
  - `selectCells(page, { rowStart, rowEnd, colIds })`
  - `readField(page, rowId, field): Promise<unknown>`
  - `applyBulk(page, targets|viaSelection, value)`
  - `applySmart(page, targets, op, operand)`
  - `undoOnce(page)` — ribbon Undo or `journal.undo()`

- [ ] **Step 1: Add `editOps.ts`**

```ts
import { expect, type Page } from '@playwright/test';

export type HarnessRow = {
  positionId: string;
  pnl: number;
  currency?: string;
  [k: string]: unknown;
};

export async function harnessRow(page: Page, index = 0): Promise<HarnessRow> {
  const row = await page.evaluate((i) => {
    const rows = (window as unknown as { __paintHarness: { rows: HarnessRow[] } }).__paintHarness.rows;
    return rows[i] ?? null;
  }, index);
  if (!row) throw new Error(`harnessRow: no row at ${index}`);
  return row;
}

export async function selectCells(
  page: Page,
  opts: { rowStart: number; rowEnd: number; colIds: string[] },
): Promise<void> {
  await page.evaluate((o) => {
    const g = (window as unknown as { __ext: { grid: { addCellRange: (r: unknown) => void } } }).__ext.grid;
    g.addCellRange(o);
  }, opts);
}

export async function readField(page: Page, rowId: string, field: string): Promise<unknown> {
  return page.evaluate(({ rowId: id, field: f }) => {
    const g = (window as unknown as {
      __ext: { grid: { forEachRow: (cb: (id: string, row: Record<string, unknown>) => void) => void } };
    }).__ext.grid;
    let v: unknown;
    g.forEachRow((rid, row) => { if (rid === id) v = row[f]; });
    return v;
  }, { rowId, field });
}

export async function makeTarget(
  page: Page,
  index: number,
  colId: string,
  field = colId,
): Promise<Record<string, unknown>> {
  return page.evaluate(({ index: i, colId: c, field: f }) => {
    const row = (window as unknown as { __paintHarness: { rows: HarnessRow[] } }).__paintHarness.rows[i]!;
    return {
      rowId: row.positionId,
      colId: c,
      field: f,
      value: (row as Record<string, unknown>)[f],
      rowIndex: i,
      rowData: row,
      cellDataType: typeof (row as Record<string, unknown>)[f] === 'number' ? 'number' : 'text',
    };
  }, { index, colId, field });
}

export async function undoOnce(page: Page): Promise<void> {
  const btn = page.locator('.vgext-ribbon button[title="Undo"]');
  if (await btn.isEnabled().catch(() => false)) {
    await btn.click();
    return;
  }
  await page.evaluate(() => {
    (window as unknown as { __edit: { journal: { undo: () => void } } }).__edit.journal.undo();
  });
}
```

- [ ] **Step 2: Typecheck helpers path is importable from specs** (no separate unit test; first failing e2e proves wiring)

---

### Task 2: Bulk Update e2e

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/customizer-bulkUpdate.spec.ts`
- Consumes: `bootCustomizer`, `openCustomizer`, `saveCard`, `cockpit`, `editOps`

- [ ] **Step 1: Write spec**

Cases (Markets `v2-bulk-update`):
1. Settings panel opens; toggle Record history → Save → `getSettings().bulkUpdate.recordHistory`
2. Select 2 cells on `currency` via `addCellRange` → `bulkUpdate.apply` → both rows EUR → Undo restores

```ts
import { test, expect } from '@playwright/test';
import { bootCustomizer, openCustomizer, saveCard, cockpit, closeViaDone } from './helpers/customizer';
import { harnessRow, makeTarget, readField, selectCells, undoOnce } from './helpers/editOps';

test.beforeEach(async ({ page }) => { await bootCustomizer(page); });

test.describe('Bulk Update (Markets parity)', () => {
  test('settings Save toggles recordHistory', async ({ page }) => {
    // Markets: v2-bulk-update — settings sheet opens Bulk Update panel
    await openCustomizer(page, 'bulk-update');
    await expect(page.locator('.vgext-sheet-title')).toHaveText('Bulk Update');
    await cockpit(page).locator('.ckp-switch').last().click();
    await saveCard(page);
    await expect.poll(async () =>
      page.evaluate(() =>
        (window as any).__edit.getSettings().bulkUpdate.recordHistory),
    ).toBe(false);
  });

  test('apply sets currency on selection; undo restores', async ({ page }) => {
    // Markets: v2-bulk-update — bulk set after selection + undo
    const r0 = await harnessRow(page, 0);
    const r1 = await harnessRow(page, 1);
    const before0 = await readField(page, r0.positionId, 'currency');
    const before1 = await readField(page, r1.positionId, 'currency');
    await selectCells(page, { rowStart: 0, rowEnd: 1, colIds: ['currency'] });
    const applied = await page.evaluate(async () => {
      const edit = (window as any).__edit;
      const targets = await edit.bulkUpdate.collectTargets();
      return edit.bulkUpdate.apply(targets, 'EUR');
    });
    expect(applied.applied).toBeGreaterThanOrEqual(2);
    await expect.poll(() => readField(page, r0.positionId, 'currency')).toBe('EUR');
    await expect.poll(() => readField(page, r1.positionId, 'currency')).toBe('EUR');
    await undoOnce(page);
    await expect.poll(() => readField(page, r0.positionId, 'currency')).toBe(before0);
    await expect.poll(() => readField(page, r1.positionId, 'currency')).toBe(before1);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd apps/cgrid-ext-demo && npx playwright test e2e/customizer-bulkUpdate.spec.ts --project=chromium
```

Expected: PASS

- [ ] **Step 3: Commit** (only if user requested commits; otherwise leave working tree)

---

### Task 3: Plus / Minus e2e

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/customizer-plusMinus.spec.ts`

- [ ] **Step 1: Write spec**

Cases:
1. Panel opens; Enabled Save → `getSettings().plusMinus.enabled`
2. Ensure a nudge for `pnl` with step 1000 via UI or `setNudges`; focus/select pnl cell; dispatch `+` keydown on grid root OR call internal nudge path; value += 1000; Undo

Prefer API path if key routing needs focus:
```ts
await page.evaluate(() => {
  const edit = (window as any).__edit;
  edit.setNudges([{
    id: 'n1', name: 'pnl+1k', enabled: true,
    scope: { columnIds: ['pnl'] }, incrementStep: 1000,
  }]);
  edit.updateSettings({ plusMinus: { enabled: true, recordHistory: true } });
});
// Then select pnl cell + page.keyboard.press('+') on focused grid
```

If keyboard path fails hermetically, fall back to documenting key path as follow-up and assert via building patches only if bridge exposes apply — otherwise use keyboard with `page.locator('.vgext-grid canvas').click()` first.

- [ ] **Step 2: Run** `npx playwright test e2e/customizer-plusMinus.spec.ts --project=chromium` → PASS

---

### Task 4: Smart Edit e2e

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/customizer-smartEdit.spec.ts`

- [ ] **Step 1: Write spec**

Cases (Markets `v2-smart-edit`):
1. Settings: toggle `previewBeforeApply` or `recordHistory` → Save → `getSettings().smartEdit.*`
2. `smartEdit.apply([target], 'multiply', 2)` on pnl → value doubled → Undo
3. `smartEdit.apply([target], 'add', 100)` → Undo
4. If `enforceSingleColumn`: multi-col range → `collectTargets` empty or apply disabled (match product)

- [ ] **Step 2: Run** → PASS

---

### Task 5: Shortcuts e2e

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/customizer-shortcuts.spec.ts`

- [ ] **Step 1: Write spec**

Cases:
1. Customize: Add + Save → `getShortcuts().length > 0` (existing smoke, keep here)
2. `setShortcuts([{ key h, multiply, 100, scope pnl }])` + enabled; select pnl; press `h` → value * 100 → Undo
3. `updateSettings({ shortcuts: { enabled: false } })` → press `h` → value unchanged

- [ ] **Step 2: Run** → PASS

---

### Task 6: Alerts e2e (deeper)

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/customizer-alerts.spec.ts`

- [ ] **Step 1: Write spec**

Cases (beyond `customizer.spec.ts` smoke):
1. Create dataChange alert via UI; fire via smartEdit; badge visible; `markAlertRead()` → unread 0
2. Kill-switch: find Enabled/global toggle in alerts module → Save off → fire edit → history length unchanged (or no new unread)
3. If channels/frequency controls exist in DOM, toggle + Save + round-trip via `getAlertRules()`

- [ ] **Step 2: Run** → PASS

---

### Task 7: Wire npm scripts (Phase 1)

**Files:**
- Modify: `apps/cgrid-ext-demo/package.json`

```json
"test:e2e:customizer": "playwright test e2e/customizer.spec.ts e2e/spine.spec.ts e2e/customizer-*.spec.ts --project=chromium",
"test:e2e:parity": "playwright test e2e/customizer.spec.ts e2e/customizer-*.spec.ts e2e/savedFilters.spec.ts e2e/formattingToolbar.spec.ts e2e/formatPicker.spec.ts e2e/iconRibbon.spec.ts e2e/columnConfig.spec.ts e2e/layoutsToolbar.spec.ts --project=chromium"
```

(`savedFilters` / `formattingToolbar` may not exist until Phase 2 — either create stub `test.describe.skip` files or omit from script until Task 8.)

- [ ] **Step 1: Update scripts; run `npm run test:e2e:customizer`** → Phase 1 green

---

### Task 8: Phase 2 — Saved filters

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/savedFilters.spec.ts`
- Optional: `e2e/helpers/savedFilters.ts`

Cases from Markets `v2-filters-toolbar` + canvasgrid layout-tier contract:
1. Empty toolbar: `[data-testid="vgext-saved-filters"]` visible; add disabled without filter
2. `setFilterModel` on a column → add enabled → click add → `.vgext-sf-pill` count 1
3. Toggle pill off → `getFilterModel()` empty/cleared; toggle on → restored
4. Clear all → no active filters
5. Rename via hover pencil + popover
6. Delete pill
7. Inactive matching filter → add stays disabled (no duplicate)
8. Persist: capture pill → reload `/?paintHarness` with same storage OR switch layout → pills restored per layout design

- [ ] Run `npx playwright test e2e/savedFilters.spec.ts --project=chromium` → PASS

---

### Task 9: Phase 2 — Formatting toolbar

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/formattingToolbar.spec.ts` (or extend `formatPicker.spec.ts`)

Cases from `v2-formatting-toolbar` not already covered:
1. Selection enables Bold / align controls
2. Bold → style state on column (API or getColumnState / format bridge)
3. Clear styles
4. Narrow viewport → overflow `⋯` contains overflowed groups (ribbon overflow)

Reuse `formatPicker` selection helper pattern (`addCellRange`).

- [ ] Run → PASS; update `test:e2e:parity` to include new files

---

### Task 10: Phase 3 — Checklist + gap fill

**Files:**
- Create: `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md`
- Add specs only for rows marked `gap` that are in-scope

Checklist columns: `Markets file | Case | Canvasgrid spec | Status | Notes`

Statuses: `covered` | `gap` | `n/a`

Mark `n/a` for: AG `.ag-row` text asserts, Markets lab profile seeds (`pm-02-…`), OpenFin channel, relativeChange tick alerts, SSRM twin.

- [ ] Fill checklist from all `v2-*.spec.ts` customizer-related files
- [ ] Implement highest-value `gap` cases or leave explicitly listed
- [ ] Run `npm run test:e2e:parity` → green for covered set

---

## Spec coverage check

| Spec section | Task |
|--------------|------|
| Phase 1 Bulk/±/Smart/Shortcuts/Alerts | Tasks 2–6 |
| Helpers / paintHarness | Task 1 |
| npm scripts | Task 7 (+9) |
| Phase 2 saved filters + formatting | Tasks 8–9 |
| Phase 3 checklist | Task 10 |
| Non-goals (no Markets twin CI, no SSRM) | Documented; no tasks |

## Execution

Start Task 1 immediately after plan save. Prefer inline execution in this session through Phase 1 (Tasks 1–7), then Phase 2–3.
