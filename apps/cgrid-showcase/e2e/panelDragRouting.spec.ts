import { test, expect, type Page } from '@playwright/test';
import { gotoFeature } from './helpers';

/**
 * Cross-section pill drag routing — the user can drag a pill from any
 * one of the five pill containers (top-strip Row Group panel, top-strip
 * Pivot panel, columns-panel Row Groups zone, Column Labels zone,
 * Values zone) onto any OTHER container, and the column moves to the
 * new role. Before this cycle, drag-out either silently no-op'd
 * (top-strip Row Group panel) or just removed the column from its
 * current role — there was no path to MOVE a column across sections.
 *
 * Also verifies the pivot-mode checkbox parity fix: every column with
 * ANY pivot role (rowGroup OR value OR pivot) now appears checked in
 * the columns panel under pivot mode. Before, pivot columns
 * (region/sector) appeared unchecked while actively pivoting the grid.
 */

async function simulatePointerDrag(
  page: Page,
  startSelector: string,
  endX: number,
  endY: number,
): Promise<void> {
  await page.evaluate(({ startSelector, endX, endY }) => {
    const src = document.querySelector(startSelector) as HTMLElement | null;
    if (!src) throw new Error(`source not found: ${startSelector}`);
    const sr = src.getBoundingClientRect();
    const startX = sr.left + sr.width / 2;
    const startY = sr.top + sr.height / 2;
    src.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, pointerId: 1,
      clientX: startX, clientY: startY,
    }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = startX + (endX - startX) * (i / steps);
      const y = startY + (endY - startY) * (i / steps);
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, composed: true,
        pointerType: 'mouse', isPrimary: true, buttons: 1, pointerId: 1,
        clientX: x, clientY: y,
      }));
    }
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, composed: true,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, pointerId: 1,
      clientX: endX, clientY: endY,
    }));
  }, { startSelector, endX, endY });
}

test.describe('cross-section pill drag routing', () => {
  test('row group pill dragged onto the pivot panel moves the column to pivotColumns', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    // Confirm pre-seeded state — desk is in rowGroups; region/sector in pivots.
    const before = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return { rgs: g.getRowGroupColumns(), pivots: g.getPivotColumns() };
    });
    expect(before.rgs).toEqual(['desk']);
    expect(before.pivots).toEqual(['region', 'sector']);

    // Target a point on the right side of the pivot panel (past the existing chips).
    const targetXY = await page.evaluate(() => {
      const panel = document.querySelector('.cg-pivot-panel') as HTMLElement;
      const r = panel.getBoundingClientRect();
      return { x: r.right - 80, y: r.top + r.height / 2 };
    });

    await simulatePointerDrag(
      page,
      '.cg-row-group-panel-chip[data-col-id="desk"]',
      targetXY.x, targetXY.y,
    );

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return { rgs: g.getRowGroupColumns(), pivots: g.getPivotColumns() };
    });
    expect(after.rgs).toEqual([]);
    expect(after.pivots).toContain('desk');
  });

  test('pivot-mode checkbox tracks ALL three pivot roles — region/sector appear checked', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    // Open the columns side panel only when not already open.
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="desk"]').waitFor();

    const checked = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cg-columns-panel-row'));
      const out: Record<string, boolean> = {};
      for (const r of rows) {
        const colId = (r as HTMLElement).getAttribute('data-col-id') ?? '';
        const cb = r.querySelector('input[type=checkbox]') as HTMLInputElement | null;
        out[colId] = cb?.checked === true;
      }
      return out;
    });

    expect(checked['desk']).toBe(true);        // rowGroup role
    expect(checked['pnl']).toBe(true);         // value role
    expect(checked['notional']).toBe(true);    // value role
    expect(checked['region']).toBe(true);      // pivot role — was UNCHECKED before
    expect(checked['sector']).toBe(true);      // pivot role — was UNCHECKED before
  });

  test('unchecking region in pivot mode removes its pivot role', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="region"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="region"]').waitFor();

    // Locate region's checkbox and click it (uncheck).
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
        .find((r) => (r as HTMLElement).getAttribute('data-col-id') === 'region');
      (row?.querySelector('input[type=checkbox]') as HTMLInputElement | undefined)?.click();
    });

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return { pivots: g.getPivotColumns() };
    });
    expect(after.pivots).not.toContain('region');
  });

  test('unchecking ALL roles in pivot mode tears down synthesised pivot columns (no stale matrix)', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="desk"]').waitFor();

    // Uncheck every checked row (desk + region + sector + pnl + notional).
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cg-columns-panel-row'));
      for (const r of rows) {
        const cb = r.querySelector('input[type=checkbox]') as HTMLInputElement | null;
        if (cb?.checked) cb.click();
      }
    });
    // Let the role-change pipeline settle.
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return {
        rowGroups: g.getRowGroupColumns(),
        pivots: g.getPivotColumns(),
        values: g.getValueColumns(),
        columnOrder: (g.columnOrder ?? []).map((c: any) => c.colId),
      };
    });
    expect(after.rowGroups).toEqual([]);
    expect(after.pivots).toEqual([]);
    expect(after.values).toEqual([]);
    // No stale synthesised pivot result columns; the grid is back to
    // source columns.
    const stale = after.columnOrder.filter((id: string) => id.startsWith('pivotcol'));
    expect(stale).toEqual([]);
    // The worker shouldn't have errored on the way out (the
    // mid-swap race in PivotPass.apply is the regression this test
    // guards).
    const fieldErrors = consoleErrors.filter((m) => m.includes("reading 'field'"));
    expect(fieldErrors).toEqual([]);
  });

  test('enable-flag predicates fall through to primaryColumnTree under pivot mode', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    // In pivot mode the source colDefs are swapped out of columnDefsMap.
    // The predicates must still see the source columns' enableX flags via
    // the preserved primaryColumnTree.
    const eligibility = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return {
        deskPivot: g.isColumnPivotEnabled('desk'),
        regionRowGroup: g.isColumnRowGroupEnabled('region'),
        pnlValue: g.isColumnValueEnabled('pnl'),
      };
    });
    expect(eligibility.deskPivot).toBe(true);
    expect(eligibility.regionRowGroup).toBe(true);
    expect(eligibility.pnlValue).toBe(true);
  });
});
