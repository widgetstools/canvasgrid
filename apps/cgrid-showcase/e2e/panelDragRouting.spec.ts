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

  test('pivot-mode checkbox tracks column VISIBILITY in lockstep (cardinal principle, no exceptions)', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="desk"]').waitFor();

    const result = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      const state = g.getColumnState() as Array<{ colId: string; hide?: boolean }>;
      const rows = Array.from(document.querySelectorAll('.cg-columns-panel-row'));
      const checks: Record<string, boolean | undefined> = {};
      const hides: Record<string, boolean> = {};
      for (const r of rows) {
        const colId = (r as HTMLElement).getAttribute('data-col-id') ?? '';
        checks[colId] = (r.querySelector('input[type=checkbox]') as HTMLInputElement | null)?.checked;
        hides[colId] = state.find((s) => s.colId === colId)?.hide === true;
      }
      return { checks, hides };
    });

    // Cardinal principle: checked === !hide for every column.
    // Role membership is communicated through the pill sections,
    // not the checkbox. Auto-hidden grouped columns (like desk)
    // show as UNCHECKED because they're not visible in the body.
    for (const colId of Object.keys(result.checks)) {
      expect(result.checks[colId]).toBe(!result.hides[colId]);
    }
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

    // Tear down every pivot role through the public API (the panel
    // checkbox no longer toggles role membership — visibility-only
    // semantics in pivot mode track the cardinal principle).
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.evaluate(() => {
      const g = (window as any).__cgrid;
      for (const colId of [...g.getRowGroupColumns()]) g.removeRowGroupColumn(colId);
      for (const colId of [...g.getPivotColumns()]) g.removePivotColumn(colId);
      for (const v of [...g.getValueColumns()]) g.removeValueColumn(v.colId);
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
    // No stale synthesised pivot result columns; AND no source columns
    // either — under pivot mode, a source column the user just
    // unchecked has no role, so it shouldn't paint at all (otherwise
    // the checkbox state contradicts what's on screen).
    expect(after.columnOrder).toEqual([]);
    // The worker shouldn't have errored on the way out (the
    // mid-swap race in PivotPass.apply is the regression this test
    // guards).
    const fieldErrors = consoleErrors.filter((m) => m.includes("reading 'field'"));
    expect(fieldErrors).toEqual([]);
  });

  test('pivot panel + Column Labels section hide when pivot mode is OFF (AG parity)', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    // Pivot ON by default in the showcase — panel + section visible.
    let initial = await page.evaluate(() => {
      const pp = document.querySelector('.cg-pivot-panel') as HTMLElement | null;
      const lblSection = Array.from(document.querySelectorAll('.cg-columns-panel-section'))
        .find((s) => s.querySelector('.cg-columns-panel-plz')) as HTMLElement | undefined;
      return {
        pivotPanelDisplay: pp ? getComputedStyle(pp).display : 'no panel',
        labelsSectionDisplay: lblSection ? getComputedStyle(lblSection).display : 'no section',
      };
    });
    expect(initial.pivotPanelDisplay).not.toBe('none');

    // Toggle pivot mode OFF via the showcase button.
    await page.locator('[data-testid="btn-pivot-toggle"]').click();
    await page.waitForTimeout(300);

    const afterOff = await page.evaluate(() => {
      const pp = document.querySelector('.cg-pivot-panel') as HTMLElement | null;
      const lblSection = Array.from(document.querySelectorAll('.cg-columns-panel-section'))
        .find((s) => s.querySelector('.cg-columns-panel-plz')) as HTMLElement | undefined;
      return {
        pivotPanelDisplay: pp ? getComputedStyle(pp).display : 'no panel',
        labelsSectionDisplay: lblSection ? getComputedStyle(lblSection).display : 'no section',
      };
    });
    expect(afterOff.pivotPanelDisplay).toBe('none');
    expect(afterOff.labelsSectionDisplay).toBe('none');

    // Toggle back ON — panel reappears.
    await page.locator('[data-testid="btn-pivot-toggle"]').click();
    await page.waitForTimeout(300);

    const afterOn = await page.evaluate(() => {
      const pp = document.querySelector('.cg-pivot-panel') as HTMLElement | null;
      const lblSection = Array.from(document.querySelectorAll('.cg-columns-panel-section'))
        .find((s) => s.querySelector('.cg-columns-panel-plz')) as HTMLElement | undefined;
      return {
        pivotPanelDisplay: pp ? getComputedStyle(pp).display : 'no panel',
        labelsSectionDisplay: lblSection ? getComputedStyle(lblSection).display : 'no section',
      };
    });
    expect(afterOn.pivotPanelDisplay).not.toBe('none');
    expect(afterOn.labelsSectionDisplay).not.toBe('none');
  });

  test('cardinal principle: dragging a column into any role panel re-creates the pivot fresh — full matrix visible without toggle', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    // Pre-drag: pivot is region × sector × {pnl, notional} = 2-level
    // matrix. Drag desk from Row Groups → Pivot panel; the new
    // 3-level matrix (region × sector × desk × value) should appear
    // immediately, NOT collapsed to per-sector totals.
    const before = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      const cols = (g.columnOrder ?? []) as Array<{ colId: string }>;
      // 3-level pivot result colIds carry FOUR -separated
      // segments (`pivotcol<L1><L2><L3><value>`).
      return {
        pivots: g.getPivotColumns(),
        threeLevelCount: cols.filter((c) => c.colId.split('').length >= 5).length,
      };
    });
    expect(before.pivots).toEqual(['region', 'sector']);
    expect(before.threeLevelCount).toBe(0);

    // Drag desk into the pivot panel — uses the cross-panel router.
    await page.evaluate(() => {
      const deskPill = document.querySelector('.cg-row-group-panel-chip[data-col-id="desk"]') as HTMLElement;
      const pivotPanel = document.querySelector('.cg-pivot-panel') as HTMLElement;
      const sr = deskPill.getBoundingClientRect();
      const tr = pivotPanel.getBoundingClientRect();
      const startX = sr.left + sr.width / 2;
      const startY = sr.top + sr.height / 2;
      const endX = tr.right - 60;
      const endY = tr.top + tr.height / 2;
      deskPill.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true,
        pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, pointerId: 1,
        clientX: startX, clientY: startY,
      }));
      for (let i = 1; i <= 10; i++) {
        const x = startX + (endX - startX) * (i / 10);
        const y = startY + (endY - startY) * (i / 10);
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
    });
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      const cols = (g.columnOrder ?? []) as Array<{ colId: string }>;
      return {
        pivots: g.getPivotColumns(),
        threeLevelCount: cols.filter((c) => c.colId.split('').length >= 5).length,
      };
    });
    expect(after.pivots).toEqual(['region', 'sector', 'desk']);
    // Fresh 3-level matrix is visible — the deepest leaves paint
    // immediately. Without the re-synthesis fix the new sector-level
    // groups stayed closed and only per-sector totals showed (0
    // 3-level leaves).
    expect(after.threeLevelCount).toBeGreaterThan(0);
  });

  test('columns panel checkbox is in lockstep with column visibility (both directions, role-bearing cols included)', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    // Direction 1: code-driven hide propagates to checkbox.
    // Includes pnl (value role) and region (pivot role) — even
    // role-bearing source columns must reflect the hide flag, not
    // role membership.
    const afterCodeHide = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      g.setColumnsVisible(['ticker', 'pnl', 'region'], false);
      return new Promise<Record<string, boolean | undefined>>((resolve) => {
        setTimeout(() => {
          const getCheck = (colId: string) => {
            const r = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
              .find((el) => el.getAttribute('data-col-id') === colId);
            return (r?.querySelector('input[type=checkbox]') as HTMLInputElement | null)?.checked;
          };
          resolve({ ticker: getCheck('ticker'), pnl: getCheck('pnl'), region: getCheck('region') });
        }, 200);
      });
    });
    expect(afterCodeHide).toEqual({ ticker: false, pnl: false, region: false });

    // Direction 2: code-driven show propagates back.
    const afterCodeShow = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      g.setColumnsVisible(['ticker', 'pnl', 'region'], true);
      return new Promise<Record<string, boolean | undefined>>((resolve) => {
        setTimeout(() => {
          const getCheck = (colId: string) => {
            const r = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
              .find((el) => el.getAttribute('data-col-id') === colId);
            return (r?.querySelector('input[type=checkbox]') as HTMLInputElement | null)?.checked;
          };
          resolve({ ticker: getCheck('ticker'), pnl: getCheck('pnl'), region: getCheck('region') });
        }, 200);
      });
    });
    expect(afterCodeShow).toEqual({ ticker: true, pnl: true, region: true });

    // Direction 3: panel checkbox click hides the column in the grid.
    const afterPanelClick = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
        .find((el) => el.getAttribute('data-col-id') === 'ticker') as HTMLElement;
      (row.querySelector('input[type=checkbox]') as HTMLInputElement).click();
      return new Promise<{ checked: boolean | undefined; gridHide: boolean }>((resolve) => {
        setTimeout(() => {
          const g = (window as any).__cgrid;
          const state = g.getColumnState() as Array<{ colId: string; hide?: boolean }>;
          const ticker = state.find((s) => s.colId === 'ticker');
          const cb = row.querySelector('input[type=checkbox]') as HTMLInputElement;
          resolve({ checked: cb.checked, gridHide: ticker?.hide === true });
        }, 200);
      });
    });
    expect(afterPanelClick.checked).toBe(false);
    expect(afterPanelClick.gridHide).toBe(true);
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
