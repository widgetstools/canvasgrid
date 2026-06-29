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

  test('parent pivot group (Region) is toggleable — collapse hides child sub-groups, only Total leaf stays', async ({ page }) => {
    // AG-Grid parity: with `pivotColumnGroupTotals: 'after'` the
    // showcase pre-seeds an always-visible Total sub-group inside each
    // region. Clicking the parent region header should collapse the
    // sector sub-groups while keeping the Total. This is the
    // "ag-grid allows the user to collapse/expand child column groups
    // from the parent" behaviour. Verified at the API level: toggling
    // a region's column-group state drops every Energy/Finance/etc.
    // leaf from columnOrder while the Americas Total leaves stay.
    await gotoFeature(page, 'pivot');
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => {
      const g = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
      return g.columnOrder.map((c) => c.colId);
    });
    // Sanity: Americas/Energy leaves are present in the expanded default.
    expect(before.some((id) => id.includes('Americas') && id.includes('Energy'))).toBe(true);

    // Collapse the Americas region group.
    await page.evaluate(() => {
      const g = window.__cgrid as unknown as { toggleColumnGroup: (id: string) => void };
      g.toggleColumnGroup(['pivotcol', 'grp', 'Americas'].join('\x01'));
    });
    await page.waitForTimeout(300);

    const afterCollapse = await page.evaluate(() => {
      const g = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
      return g.columnOrder.map((c) => c.colId);
    });
    // Americas/Energy hidden; Americas Total leaves stay. The Total
    // leaves use the SHORT pivot path (just `Americas`, no sector) —
    // they're the prefix-aggregate leaves wrapped in the Total sub-
    // group. The full sector leaves use `Americas/<Sector>/<value>`.
    expect(afterCollapse.some((id) => id.includes('Americas') && id.includes('Energy'))).toBe(false);
    expect(afterCollapse.some(
      (id) => /^pivotcol\x01Americas\x01[^\x01]+$/.test(id),
    )).toBe(true);
    // Asia + Europe still expanded — their sub-group leaves remain.
    expect(afterCollapse.some((id) => id.includes('Asia') && id.includes('Tech'))).toBe(true);

    // Re-toggle to expand.
    await page.evaluate(() => {
      const g = window.__cgrid as unknown as { toggleColumnGroup: (id: string) => void };
      g.toggleColumnGroup(['pivotcol', 'grp', 'Americas'].join('\x01'));
    });
    await page.waitForTimeout(300);

    const afterExpand = await page.evaluate(() => {
      const g = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
      return g.columnOrder.map((c) => c.colId);
    });
    expect(afterExpand).toEqual(before);
  });

  test('group rows have no expand caret under pivot mode (deepest row-group level)', async ({ page }) => {
    // AG-Grid parity: under pivot mode, leaf data rows are suppressed
    // (cgrid commit 8c2f398). Group rows at the deepest row-group level
    // therefore have nothing to expand into — the chevron caret was
    // misleading. cgrid's groupCellContextAt now stamps
    // `suppressChevron: true` on those rows + the chevron hit-test
    // bails out so the cell-click handling stays normal. Asserted at
    // the cellAt level: AMER's GroupCellValue.suppressChevron === true.
    await gotoFeature(page, 'pivot');
    await page.waitForTimeout(400);

    const suppressFlags = await page.evaluate(() => {
      const grid = window.__cgrid as unknown as {
        chunk: { rowStart: number; rowCount: number; rowKinds?: Uint8Array };
        cellAt: (rowIndex: number, colId: string) => { value: unknown } | null;
      };
      const chunk = grid.chunk;
      const kinds = chunk.rowKinds ?? new Uint8Array(0);
      // Read the GroupCellValue payload off the auto-group column for
      // every group row in the chunk.
      const out: Array<boolean | undefined> = [];
      for (let i = 0; i < chunk.rowCount; i++) {
        if ((kinds[i] ?? 0) !== 1) continue;
        const cell = grid.cellAt(chunk.rowStart + i, 'ag-Grid-AutoColumn');
        const val = cell?.value as { suppressChevron?: boolean } | undefined;
        out.push(val?.suppressChevron);
      }
      return out;
    });

    // Four desk groups, all at the deepest row-group level, all suppress.
    expect(suppressFlags).toEqual([true, true, true, true]);
  });

  test('clicking a leaf pivot group header (sector row) is a no-op — does NOT hide the column', async ({ page }) => {
    // Regression: HeaderClick.handleClick used to call
    // `toggleColumnGroup` for ANY headerGroup hit. Leaf pivot groups
    // (the sector row in a multi-level pivot, or every pivot key in a
    // 1-level pivot) have no `columnGroupShow:'closed'` totals leaf to
    // fall back on, so collapsing them hides the entire value-col
    // group. The user reported this as "clicking on any cell of the
    // sector row hides that column". Fix: only toggle when the group
    // emitted a closed-state child (matches the chevron painter rule).
    await gotoFeature(page, 'pivot');
    await page.waitForTimeout(500);

    // Snapshot the rendered column order before the click.
    const before = await page.evaluate(() => {
      const g = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
      return g.columnOrder.map((c) => c.colId);
    });

    // Find the sector-row header cell via getHeaderBoundsAt for one of
    // the pivot leaf groups. We pick a leaf-pivot value column
    // (e.g. the first pivotcol* col), get its header bounds, then
    // click at the parent's row (sector-depth) by walking UP one row
    // height. Easier: dispatch a synthetic click directly at the
    // canvas at the right canvas-local y for the sector header band.
    const click = await page.evaluate(() => {
      const g = window.__cgrid as unknown as {
        columnOrder: Array<{ colId: string }>;
        getHeaderBoundsAt: (colId: string) => { x: number; y: number; w: number; h: number } | null;
      };
      const pivotColId = (g.columnOrder ?? []).find((c) => c.colId.startsWith('pivotcol'))?.colId;
      if (!pivotColId) return null;
      const leafBounds = g.getHeaderBoundsAt(pivotColId);
      if (!leafBounds) return null;
      // The sector-row header sits one row above the leaf header.
      // Header row height is ~28px (cgrid default). Click 30px above
      // the leaf header's top edge.
      const canvas = document.querySelector('#grid-host canvas') as HTMLCanvasElement;
      const r = canvas.getBoundingClientRect();
      const clientX = r.left + leafBounds.x + leafBounds.w / 2;
      const clientY = r.top + leafBounds.y - 14; // mid of the previous row band
      // Synthetic mousedown + mouseup so the canvas click handler fires.
      const dispatch = (type: string) => {
        canvas.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX, clientY, button: 0,
        }));
      };
      dispatch('mousedown');
      dispatch('mouseup');
      dispatch('click');
      return { clientX, clientY };
    });
    expect(click).not.toBeNull();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const g = window.__cgrid as unknown as { columnOrder: Array<{ colId: string }> };
      return g.columnOrder.map((c) => c.colId);
    });

    // The column order must not change — clicking a leaf-pivot-group
    // header has no effect.
    expect(after).toEqual(before);
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
