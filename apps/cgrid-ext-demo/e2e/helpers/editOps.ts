import { expect, type Page } from '@playwright/test';

/** Paint-harness row shape used by customizer edit-ops e2e. */
export type HarnessRow = {
  positionId: string;
  pnl: number;
  currency?: string;
  [k: string]: unknown;
};

type EditWindow = {
  __paintHarness: { rows: HarnessRow[] };
  __ext: {
    grid: {
      addCellRange: (r: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
      clearCellRanges: () => void;
      setFocusedCell: (rowId: string, colId: string) => void;
      forEachRow: (cb: (id: string, row: Record<string, unknown>) => void) => void;
      markAlertRead?: () => void;
      getAlertUnreadCount?: () => number;
      getAlertHistory?: () => unknown[];
      getAlertsSettings?: () => { enabled: boolean };
      setAlertsSettings?: (p: { enabled?: boolean }) => void;
    };
  };
  __edit: {
    journal: { undo: () => unknown; canUndo: () => boolean; entries: () => unknown[] };
    getSettings: () => Record<string, unknown>;
    updateSettings: (p: Record<string, unknown>) => void;
    setNudges: (n: unknown[]) => void;
    getNudges: () => unknown[];
    setShortcuts: (s: unknown[]) => void;
    getShortcuts: () => unknown[];
    smartEdit: {
      apply: (
        targets: unknown[],
        op: string,
        n: number,
      ) => Promise<{ applied: number; entry: unknown }>;
      collectTargets: () => Promise<unknown[]>;
    };
    bulkUpdate: {
      apply: (targets: unknown[], value: unknown) => Promise<{ applied: number; entry: unknown }>;
      collectTargets: () => Promise<unknown[]>;
    };
  };
};

function win(page: Page) {
  return page.evaluateHandle(() => window as unknown as EditWindow);
}

export async function harnessRow(page: Page, index = 0): Promise<HarnessRow> {
  const row = await page.evaluate((i) => {
    const rows = (window as unknown as EditWindow).__paintHarness.rows;
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
    const g = (window as unknown as EditWindow).__ext.grid;
    g.clearCellRanges();
    g.addCellRange(o);
  }, opts);
}

/**
 * Focus a single cell for ± / shortcut key routing.
 * Edit bridge synthesizes focus from a 1×1 cell range — `setFocusedCell`
 * alone is not enough for `buildFocusedTarget`. Keydown is bound on the
 * grid canvas (featureChain), so the canvas must hold DOM focus.
 */
export async function focusCell(
  page: Page,
  rowId: string,
  colId: string,
  rowIndex = 0,
): Promise<void> {
  const canvas = page.locator('.cgext-grid canvas, .cg-grid canvas').first();
  await canvas.click({ position: { x: 200, y: 80 } });
  await page.evaluate(({ rowId: id, colId: c, rowIndex: ri }) => {
    const g = (window as unknown as EditWindow).__ext.grid;
    g.clearCellRanges();
    g.addCellRange({ rowStart: ri, rowEnd: ri, colIds: [c] });
    g.setFocusedCell(id, c);
  }, { rowId, colId, rowIndex });
  await canvas.focus();
}

/** Click the switch in a cockpit settings row whose label matches `label`. */
export async function toggleSettingsRow(page: Page, label: RegExp | string): Promise<void> {
  const byLabel = page.locator('.ckp-row').filter({ hasText: label }).first();
  await expect(byLabel).toBeVisible();
  await byLabel.locator('.ckp-switch').click();
}

/** Press a key against the grid canvas (required for cellKeyDown). */
export async function pressGridKey(page: Page, key: string): Promise<void> {
  const canvas = page.locator('.cgext-grid canvas, .cg-grid canvas').first();
  await canvas.focus();
  await page.keyboard.press(key);
}

export async function readField(page: Page, rowId: string, field: string): Promise<unknown> {
  return page.evaluate(({ rowId: id, field: f }) => {
    const g = (window as unknown as EditWindow).__ext.grid;
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
    const row = (window as unknown as EditWindow).__paintHarness.rows[i]!;
    const value = (row as Record<string, unknown>)[f];
    return {
      rowId: row.positionId,
      colId: c,
      field: f,
      value,
      rowIndex: i,
      rowData: row,
      cellDataType: typeof value === 'number' ? 'number' : 'text',
    };
  }, { index, colId, field });
}

export async function undoOnce(page: Page): Promise<void> {
  const btn = page.locator('.cgext-ribbon button[title="Undo"]');
  if (await btn.isEnabled().catch(() => false)) {
    await btn.click();
    return;
  }
  await page.evaluate(() => {
    (window as unknown as EditWindow).__edit.journal.undo();
  });
}

export async function editSettings<T = unknown>(page: Page, path: string): Promise<T> {
  return page.evaluate((p) => {
    const settings = (window as unknown as EditWindow).__edit.getSettings() as Record<string, unknown>;
    const parts = p.split('.');
    let cur: unknown = settings;
    for (const part of parts) {
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur as T;
  }, path);
}

// Keep evaluateHandle import path honest for unused helper lint.
void win;
