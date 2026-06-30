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

  test('pivot-mode checkbox stays checked for visible OR role-bearing columns', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="desk"]').waitFor();

    const result = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      const state = g.getColumnState() as Array<{ colId: string; hide?: boolean }>;
      const rowGroups = new Set<string>(g.getRowGroupColumns());
      const pivots = new Set<string>(g.getPivotColumns());
      const values = new Set<string>(
        (g.getValueColumns() as Array<{ colId: string }>).map((v) => v.colId),
      );
      const rows = Array.from(document.querySelectorAll('.cg-columns-panel-row'));
      const checks: Record<string, boolean | undefined> = {};
      const expected: Record<string, boolean> = {};
      for (const r of rows) {
        const colId = (r as HTMLElement).getAttribute('data-col-id') ?? '';
        checks[colId] = (r.querySelector('input[type=checkbox]') as HTMLInputElement | null)?.checked;
        const hide = state.find((s) => s.colId === colId)?.hide === true;
        const hasRole = rowGroups.has(colId) || pivots.has(colId) || values.has(colId);
        expected[colId] = !hide || hasRole;
      }
      return { checks, expected };
    });

    for (const colId of Object.keys(result.checks)) {
      expect(result.checks[colId]).toBe(result.expected[colId]);
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
    // No stale synthesised pivot result columns survive the
    // role teardown. Source columns ARE expected to reappear —
    // the hide flag is the sole authority for visibility (cardinal
    // principle), and the role-driven auto-hide on `desk` is
    // restored when the rowGroup is removed.
    const staleSynthesised = (after.columnOrder as string[]).filter((id) => id.startsWith('pivotcol'));
    expect(staleSynthesised).toEqual([]);
    // The worker shouldn't have errored on the way out (the
    // mid-swap race in PivotPass.apply is the regression this test
    // guards).
    const fieldErrors = consoleErrors.filter((m) => m.includes("reading 'field'"));
    expect(fieldErrors).toEqual([]);
  });

  test('AG parity — row group panel + pivot panel share one 32 px strip in pivot mode', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    await page.waitForTimeout(300);

    const split = await page.evaluate(() => {
      const rg = document.querySelector('.cg-row-group-panel') as HTMLElement;
      const pp = document.querySelector('.cg-pivot-panel') as HTMLElement;
      return {
        rgClasses: rg.className,
        ppClasses: pp.className,
        rgRect: rg.getBoundingClientRect().toJSON(),
        ppRect: pp.getBoundingClientRect().toJSON(),
      };
    });

    // Split modifier classes applied on both panels.
    expect(split.rgClasses).toContain('cg-row-group-panel--split-left');
    expect(split.ppClasses).toContain('cg-pivot-panel--split-right');
    // Same vertical strip — same top, same height, single 32 px row.
    expect(split.rgRect.top).toBe(split.ppRect.top);
    expect(split.rgRect.bottom).toBe(split.ppRect.bottom);
    expect(split.rgRect.height).toBe(32);
    // Row groups on the LEFT, column labels on the RIGHT, no overlap.
    expect(split.rgRect.right).toBeLessThanOrEqual(split.ppRect.left + 1);
    // Roughly equal half-widths (within 4 px tolerance for rounding).
    expect(Math.abs(split.rgRect.width - split.ppRect.width)).toBeLessThan(4);

    // Toggling pivot mode OFF unstacks the panels — split classes
    // come off and the row group panel goes full-width again.
    await page.locator('[data-testid="btn-pivot-toggle"]').click();
    await page.waitForTimeout(300);
    const unsplit = await page.evaluate(() => {
      const rg = document.querySelector('.cg-row-group-panel') as HTMLElement;
      return {
        rgClasses: rg.className,
        rgWidth: rg.getBoundingClientRect().width,
      };
    });
    expect(unsplit.rgClasses).not.toContain('cg-row-group-panel--split-left');
    expect(unsplit.rgWidth).toBeGreaterThan(800);
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

    // Direction 1: code-driven hide on NON-role columns flips
    // the checkbox to unchecked. Role-bearing columns (pnl, region)
    // would stay checked because their role is the second source
    // of truth — exercise the visibility-only path with `ticker`.
    const afterCodeHide = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      g.setColumnsVisible(['ticker'], false);
      return new Promise<Record<string, boolean | undefined>>((resolve) => {
        setTimeout(() => {
          const getCheck = (colId: string) => {
            const r = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
              .find((el) => el.getAttribute('data-col-id') === colId);
            return (r?.querySelector('input[type=checkbox]') as HTMLInputElement | null)?.checked;
          };
          resolve({ ticker: getCheck('ticker') });
        }, 200);
      });
    });
    expect(afterCodeHide).toEqual({ ticker: false });

    // Direction 2: code-driven show propagates back.
    const afterCodeShow = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      g.setColumnsVisible(['ticker'], true);
      return new Promise<Record<string, boolean | undefined>>((resolve) => {
        setTimeout(() => {
          const getCheck = (colId: string) => {
            const r = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
              .find((el) => el.getAttribute('data-col-id') === colId);
            return (r?.querySelector('input[type=checkbox]') as HTMLInputElement | null)?.checked;
          };
          resolve({ ticker: getCheck('ticker') });
        }, 200);
      });
    });
    expect(afterCodeShow).toEqual({ ticker: true });

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

    // Direction 4: assigning a role to a hidden column flips its
    // checkbox to checked even though the column is still hidden
    // — role membership and visibility are BOTH valid reasons to
    // be "in the panel". Auto-hidden grouped columns (like desk
    // in this showcase) are the canonical case.
    const roleBearingHidden = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      const state = g.getColumnState() as Array<{ colId: string; hide?: boolean }>;
      const desk = state.find((s) => s.colId === 'desk');
      const row = Array.from(document.querySelectorAll('.cg-columns-panel-row'))
        .find((el) => el.getAttribute('data-col-id') === 'desk') as HTMLElement;
      return {
        hide: desk?.hide === true,
        rowGrouped: g.getRowGroupColumns().includes('desk'),
        checked: (row.querySelector('input[type=checkbox]') as HTMLInputElement).checked,
      };
    });
    expect(roleBearingHidden.hide).toBe(true);
    expect(roleBearingHidden.rowGrouped).toBe(true);
    expect(roleBearingHidden.checked).toBe(true);
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

  // Dragging a pill within its source zone reorders the role in place
  // (within-zone reorder). The drop slot is computed off the cursor's
  // Y position vs the midpoint of sibling pills. We use the value zone
  // (pnl, notional in the showcase) and verify the pair swaps.
  test('dragging a pill within its zone reorders the role in place (values)', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    // Open the columns side bar so the pill zones are mounted.
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="desk"]').waitFor();

    const before = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return (g.getValueColumns() as Array<{ colId: string }>).map((v) => v.colId);
    });
    expect(before).toEqual(['pnl', 'notional']);

    // Drag pnl past the bottom of notional → pnl should land after
    // notional. The mousedown is on the pill; mousemove/mouseup go to
    // the window. Pass DRAG_THRESHOLD_PX (default 4) on the first move.
    await page.evaluate(() => {
      const valuesContent = document.querySelector('.cg-columns-panel-valz-content') as HTMLElement;
      const pills = Array.from(valuesContent.querySelectorAll('.cg-columns-panel-valz-pill')) as HTMLElement[];
      const pnlPill = pills.find((p) => p.getAttribute('data-col-id') === 'pnl')!;
      const notionalPill = pills.find((p) => p.getAttribute('data-col-id') === 'notional')!;
      const srcRect = pnlPill.getBoundingClientRect();
      const dstRect = notionalPill.getBoundingClientRect();
      const startX = srcRect.left + srcRect.width / 2;
      const startY = srcRect.top + srcRect.height / 2;
      // Land BELOW notional's midpoint → slot index = pills.length (end).
      const endX = dstRect.left + dstRect.width / 2;
      const endY = dstRect.bottom - 2;
      pnlPill.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY,
      }));
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const x = startX + (endX - startX) * (i / steps);
        const y = startY + (endY - startY) * (i / steps);
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, buttons: 1,
          clientX: x, clientY: y,
        }));
      }
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0,
        clientX: endX, clientY: endY,
      }));
    });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return (g.getValueColumns() as Array<{ colId: string }>).map((v) => v.colId);
    });
    expect(after).toEqual(['notional', 'pnl']);
  });

  // Dragging a row from the columns side panel onto an external
  // destination — the row-group HEADER STRIP, the pivot HEADER STRIP
  // (Column Labels), or the column header band itself. All three
  // routes commit the drop on mouseup; the column lands in the right
  // role / position with no extra click.
  test('side-panel row drag → row-group panel strip adds the column to rowGroupColumns', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="ticker"]').waitFor();

    const before = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return g.getRowGroupColumns() as string[];
    });
    expect(before).toEqual(['desk']);

    await page.evaluate(() => {
      const handle = document.querySelector(
        '.cg-columns-panel-row[data-col-id="ticker"] .cg-columns-panel-row-handle',
      ) as HTMLElement;
      const strip = document.querySelector('.cg-row-group-panel') as HTMLElement;
      const sr = handle.getBoundingClientRect();
      const tr = strip.getBoundingClientRect();
      const startX = sr.left + sr.width / 2;
      const startY = sr.top + sr.height / 2;
      const endX = tr.right - 60;
      const endY = tr.top + tr.height / 2;
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY,
      }));
      for (let i = 1; i <= 10; i++) {
        const x = startX + (endX - startX) * (i / 10);
        const y = startY + (endY - startY) * (i / 10);
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, buttons: 1,
          clientX: x, clientY: y,
        }));
      }
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0,
        clientX: endX, clientY: endY,
      }));
    });
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return g.getRowGroupColumns() as string[];
    });
    expect(after).toContain('ticker');
  });

  test('side-panel row drag → pivot panel strip (Column Labels) adds the column to pivotColumns', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="ticker"]').waitFor();

    const before = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return g.getPivotColumns() as string[];
    });
    expect(before).toEqual(['region', 'sector']);

    await page.evaluate(() => {
      const handle = document.querySelector(
        '.cg-columns-panel-row[data-col-id="ticker"] .cg-columns-panel-row-handle',
      ) as HTMLElement;
      const strip = document.querySelector('.cg-pivot-panel') as HTMLElement;
      const sr = handle.getBoundingClientRect();
      const tr = strip.getBoundingClientRect();
      const startX = sr.left + sr.width / 2;
      const startY = sr.top + sr.height / 2;
      const endX = tr.right - 60;
      const endY = tr.top + tr.height / 2;
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY,
      }));
      for (let i = 1; i <= 10; i++) {
        const x = startX + (endX - startX) * (i / 10);
        const y = startY + (endY - startY) * (i / 10);
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, buttons: 1,
          clientX: x, clientY: y,
        }));
      }
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0,
        clientX: endX, clientY: endY,
      }));
    });
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return g.getPivotColumns() as string[];
    });
    expect(after).toContain('ticker');
  });

  test('side-panel row drag → column header band un-hides the column and lands it at the drop position', async ({ page }) => {
    await gotoFeature(page, 'pivot');
    // Toggle pivot OFF so we exercise the plain column header band
    // (in pivot mode the band paints synthesised result columns and
    // the source columns are out of the band's index space).
    await page.locator('[data-testid="btn-pivot-toggle"]').click();
    await page.waitForTimeout(300);

    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="ticker"]').waitFor();

    // Hide ticker via the public API so the drag has a hidden column
    // to re-introduce. Confirm the hide landed.
    await page.evaluate(() => {
      const g = (window as any).__cgrid;
      g.setColumnsVisible(['ticker'], false);
    });
    await page.waitForTimeout(200);
    const hiddenBefore = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return (g.getColumnState() as Array<{ colId: string; hide?: boolean }>)
        .find((s) => s.colId === 'ticker')?.hide === true;
    });
    expect(hiddenBefore).toBe(true);

    // Drag ticker from the side panel onto the column header band.
    await page.evaluate(() => {
      const handle = document.querySelector(
        '.cg-columns-panel-row[data-col-id="ticker"] .cg-columns-panel-row-handle',
      ) as HTMLElement;
      const canvas = document.querySelector('.cg-grid-canvas, canvas') as HTMLElement;
      const sr = handle.getBoundingClientRect();
      const tr = canvas.getBoundingClientRect();
      const startX = sr.left + sr.width / 2;
      const startY = sr.top + sr.height / 2;
      // Aim at the top band of the canvas where headers paint.
      const endX = tr.left + 200;
      const endY = tr.top + 12;
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY,
      }));
      for (let i = 1; i <= 10; i++) {
        const x = startX + (endX - startX) * (i / 10);
        const y = startY + (endY - startY) * (i / 10);
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, buttons: 1,
          clientX: x, clientY: y,
        }));
      }
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0,
        clientX: endX, clientY: endY,
      }));
    });
    await page.waitForTimeout(400);

    const hiddenAfter = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return (g.getColumnState() as Array<{ colId: string; hide?: boolean }>)
        .find((s) => s.colId === 'ticker')?.hide === true;
    });
    expect(hiddenAfter).toBe(false);
  });

  test('dragging a pill within its zone reorders the role in place (pivots)', async ({ page }) => {
    await gotoFeature(page, 'pivot');

    const opened = await page.evaluate(
      () => document.querySelector('.cg-columns-panel-row[data-col-id="desk"]') !== null,
    );
    if (!opened) await page.locator('button.cg-side-bar-tab:has-text("Columns")').click();
    await page.locator('.cg-columns-panel-row[data-col-id="desk"]').waitFor();

    const before = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return g.getPivotColumns() as string[];
    });
    expect(before).toEqual(['region', 'sector']);

    // Drag sector ABOVE region's midpoint → slot 0.
    await page.evaluate(() => {
      const labelsContent = document.querySelector('.cg-columns-panel-plz-content') as HTMLElement;
      const pills = Array.from(labelsContent.querySelectorAll('.cg-columns-panel-plz-pill')) as HTMLElement[];
      const regionPill = pills.find((p) => p.getAttribute('data-col-id') === 'region')!;
      const sectorPill = pills.find((p) => p.getAttribute('data-col-id') === 'sector')!;
      const srcRect = sectorPill.getBoundingClientRect();
      const dstRect = regionPill.getBoundingClientRect();
      const startX = srcRect.left + srcRect.width / 2;
      const startY = srcRect.top + srcRect.height / 2;
      const endX = dstRect.left + dstRect.width / 2;
      const endY = dstRect.top + 2;
      sectorPill.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY,
      }));
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const x = startX + (endX - startX) * (i / steps);
        const y = startY + (endY - startY) * (i / steps);
        window.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, buttons: 1,
          clientX: x, clientY: y,
        }));
      }
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, buttons: 0,
        clientX: endX, clientY: endY,
      }));
    });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      return g.getPivotColumns() as string[];
    });
    expect(after).toEqual(['sector', 'region']);
  });
});
