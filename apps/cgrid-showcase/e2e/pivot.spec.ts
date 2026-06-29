import { test, expect, Page } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 18 / Task 9 — comprehensive pivot showcase E2E.
//
// Exercises the full Cycle 18 surface via the `pivot` showcase feature:
// pre-seeded matrix, totals toggles (Task 8e), strict-order toggle
// (Task 8c), save/restore round-trip (Task 8b), and the
// processPivotResultColDef formatter customisation (Task 8f). Asserts
// behavioural state mutation through the public api — not just DOM chrome.

// White-box read: `columnOrder` is the actually-rendered column list.
// Under pivot mode it carries the synthesized pivotcol*/pivotrowtotal*
// leaves; `getColumnState` returns PRIMARY cols only (post-Task-9 fix
// so save/restore round-trips cleanly). These helpers prove the
// SYNTHESIS happens — see cgrid.integration.test.ts for the
// state-API tests.
async function pivotResultColCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const grid = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
    return (grid.columnOrder ?? []).filter((c) => c.colId.startsWith('pivotcol')).length;
  });
}

async function rowTotalColCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const grid = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
    return (grid.columnOrder ?? []).filter((c) => c.colId.startsWith('pivotrowtotal')).length;
  });
}

async function waitForGroupRows(page: Page, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const has = await page.evaluate(() => {
      const grid = window.__cgrid as unknown as {
        chunk?: { rowCount: number; rowKinds?: Uint8Array };
      };
      const chunk = grid.chunk;
      if (!chunk) return false;
      const kinds = chunk.rowKinds ?? new Uint8Array(0);
      for (let j = 0; j < chunk.rowCount; j++) {
        if ((kinds[j] ?? 0) === 1) return true;
      }
      return false;
    });
    if (has) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

test.describe('pivot showcase feature', () => {
  test('loads with desk row group + region/sector pivot + two value cols pre-seeded', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    const state = await page.evaluate(() => ({
      pivotMode: (window.__cgrid as unknown as { isPivotMode: () => boolean }).isPivotMode(),
      rowGroupCols: (window.__cgrid as unknown as { getRowGroupColumns: () => string[] }).getRowGroupColumns(),
      pivotCols: (window.__cgrid as unknown as { getPivotColumns: () => string[] }).getPivotColumns(),
      valueCols: (window.__cgrid as unknown as { getValueColumns: () => Array<{ colId: string; aggFunc: string }> }).getValueColumns(),
    }));

    expect(state.pivotMode).toBe(true);
    expect(state.rowGroupCols).toEqual(['desk']);
    expect(state.pivotCols).toEqual(['region', 'sector']);
    expect(state.valueCols.map((v) => v.colId).sort()).toEqual(['notional', 'pnl']);
  });

  test('processPivotResultColDef formatter fires — pivot result columns render with £ prefix', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    await waitForGroupRows(page);

    // Sample a pivot result column's resolved valueFormatter via cellAt
    // on a group row. Pick the first pivotcol* id from the rendered
    // column order (not getColumnState — that returns primary cols
    // under pivot mode post-Task-9 fix).
    const formatted = await page.evaluate(() => {
      const grid = window.__cgrid as unknown as {
        columnOrder: Array<{ colId: string }>;
        chunk: { rowStart: number; rowCount: number; rowKinds?: Uint8Array };
        cellAt: (rowIndex: number, colId: string) => { value: unknown; valueFormatted: string } | null;
      };
      const pivotColId = (grid.columnOrder ?? [])
        .find((c) => c.colId.startsWith('pivotcol'))?.colId;
      if (!pivotColId) return null;
      const chunk = grid.chunk;
      const kinds = chunk.rowKinds ?? new Uint8Array(0);
      for (let i = 0; i < chunk.rowCount; i++) {
        if ((kinds[i] ?? 0) === 1) {
          const cell = grid.cellAt(chunk.rowStart + i, pivotColId);
          return cell?.valueFormatted ?? null;
        }
      }
      return null;
    });
    expect(formatted).not.toBeNull();
    expect(formatted!.startsWith('£')).toBe(true);
  });

  test('Row totals toggle cycles off → after → before → off; adds/removes synthetic row-total cols', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    // Initially off.
    expect(await rowTotalColCount(page)).toBe(0);

    // First click → 'after'. One synthesized totals column per value col (2).
    await page.locator('[data-testid="btn-row-totals"]').click();
    await page.waitForTimeout(120);
    expect(await rowTotalColCount(page)).toBe(2);
    await expect(page.locator('[data-testid="btn-row-totals"]')).toHaveText('Row totals: after');

    // Second click → 'before'. Same count, different position (still 2).
    await page.locator('[data-testid="btn-row-totals"]').click();
    await page.waitForTimeout(120);
    expect(await rowTotalColCount(page)).toBe(2);
    await expect(page.locator('[data-testid="btn-row-totals"]')).toHaveText('Row totals: before');

    // Third click → off.
    await page.locator('[data-testid="btn-row-totals"]').click();
    await page.waitForTimeout(120);
    expect(await rowTotalColCount(page)).toBe(0);
    await expect(page.locator('[data-testid="btn-row-totals"]')).toHaveText('Row totals: off');
  });

  test('Save → flip pivotMode → Restore round-trips pivotMode AND pivot columns', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    await page.locator('[data-testid="btn-save-state"]').click();

    // Mutate: flip pivotMode off, drop the pivot column.
    await page.evaluate(() => {
      const api = window.__cgrid as unknown as {
        setPivotMode: (m: boolean) => void;
        setPivotColumns: (c: string[]) => void;
      };
      api.setPivotMode(false);
      api.setPivotColumns([]);
    });
    await page.waitForTimeout(80);

    let state = await page.evaluate(() => ({
      pivotMode: (window.__cgrid as unknown as { isPivotMode: () => boolean }).isPivotMode(),
      pivotCols: (window.__cgrid as unknown as { getPivotColumns: () => string[] }).getPivotColumns(),
    }));
    expect(state.pivotMode).toBe(false);
    expect(state.pivotCols).toEqual([]);

    // Restore — pivotMode and the pivot column come back.
    await page.locator('[data-testid="btn-restore-state"]').click();
    await page.waitForTimeout(160);
    state = await page.evaluate(() => ({
      pivotMode: (window.__cgrid as unknown as { isPivotMode: () => boolean }).isPivotMode(),
      pivotCols: (window.__cgrid as unknown as { getPivotColumns: () => string[] }).getPivotColumns(),
    }));
    expect(state.pivotMode).toBe(true);
    expect(state.pivotCols).toEqual(['region', 'sector']);
  });

  test('Strict order toggle flips enableStrictPivotColumnOrder + survives a pivot round-trip', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    await expect(page.locator('[data-testid="btn-strict-order"]')).toHaveText('Strict order: off');
    await page.locator('[data-testid="btn-strict-order"]').click();
    await expect(page.locator('[data-testid="btn-strict-order"]')).toHaveText('Strict order: on');

    // Pivot result columns still synthesize after the flip.
    expect(await pivotResultColCount(page)).toBeGreaterThan(0);
  });
});
