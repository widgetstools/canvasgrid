import { test, expect } from '@playwright/test';
import {
  bootSeed,
  cellValue,
  probe,
  expectHealthyPaint,
  waitSettled,
  visibleCell,
} from './helpers';

/**
 * Feature surface on StompPerspectiveProvider SSRM:
 * - ExprTK calculated columns (server-side via Perspective View)
 * - Conditional styling rules (client, hydrated leaves)
 * - Alerts (client change feed via simulateLiveTick)
 * - Formatting (wireFormat + editColumn / overrides)
 */

test.describe('Perspective SSRM — calculated columns (ExprTK)', () => {
  test('setExpressions projects totalPnl = pnl + dailyPnl', async ({ page }) => {
    await bootSeed(page, 1_500);

    const res = await page.evaluate(async () =>
      (window as any).__simple.addPerspectiveCalc({
        colId: 'totalPnl',
        expression: '"pnl" + "dailyPnl"',
        headerName: 'Total PnL',
      }),
    );
    expect(res.ok, res.error).toBe(true);

    await expect.poll(async () => {
      const v = await cellValue(page, 0, 'totalPnl');
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }, { timeout: 30_000 }).not.toBeNull();

    const check = await page.evaluate(() => {
      const g = (window as any).__simple.grid;
      const pnl = Number(g.getCellValue(0, 'pnl'));
      const daily = Number(g.getCellValue(0, 'dailyPnl'));
      const total = Number(g.getCellValue(0, 'totalPnl'));
      return {
        exprs: Object.keys((window as any).__simple.provider.getExpressions()),
        approx: Math.abs(total - (pnl + daily)) < 1e-6,
        total,
      };
    });
    expect(check.exprs).toContain('totalPnl');
    expect(check.approx).toBe(true);
    expectHealthyPaint(await probe(page), 'ExprTK totalPnl');
  });
});

test.describe('Perspective SSRM — conditional styling rules', () => {
  test('addRule paints negative pnl cells (hydrated SSRM rows)', async ({ page }) => {
    await bootSeed(page, 800);

    // Force a known negative pnl on a visible row so paint is deterministic.
    const id = String(await cellValue(page, 0, 'positionId'));
    await page.evaluate((rowId) => {
      const s = (window as any).__simple;
      s.grid.applyServerSideTransaction({
        update: [{ positionId: rowId, pnl: -1_250 }],
      });
      s.grid.addRule({
        kind: 'style',
        id: 'psp-neg-pnl',
        name: 'Negative P&L',
        enabled: true,
        priority: 10,
        condition: '[pnl] < 0',
        scope: { kind: 'cell', columnIds: ['pnl'] },
        style: {
          light: { color: '#c62828', backgroundColor: 'rgba(198,40,40,0.18)' },
          dark: { color: '#ef9a9a', backgroundColor: 'rgba(160,40,40,0.22)' },
        },
      });
    }, id);

    await waitSettled(page);

    const painted = await page.evaluate(() => {
      const g = (window as any).__simple.grid;
      const pnl = g.getCellValue(0, 'pnl');
      const bg = g.getCellPaintedBg(0, 'pnl');
      const evaled = (window as any).__simple.rules.evaluateCell({
        row: { pnl },
        rowId: String(g.getCellValue(0, 'positionId')),
        colId: 'pnl',
        theme: 'dark',
      });
      return { bg, pnl, matched: evaled.matched };
    });

    expect(painted.pnl).toBeLessThan(0);
    expect(painted.matched).toContain('psp-neg-pnl');
    expect(painted.bg).toBe('rgba(160,40,40,0.22)');
  });

  test('diff flash rule fires on simulateLiveTick via rowsChanged', async ({ page }) => {
    await bootSeed(page, 800);
    const id = String(await cellValue(page, 0, 'positionId'));

    await page.evaluate((rowId) => {
      const s = (window as any).__simple;
      s.grid.addRule({
        kind: 'style',
        id: 'psp-diff-up',
        name: 'PnL up',
        enabled: true,
        priority: 6,
        condition: '[pnl.old] != null && [pnl.new] > [pnl.old]',
        scope: { kind: 'cell', columnIds: ['pnl'] },
        style: { base: { color: '#7fdf9b' } },
        flash: {
          enabled: true,
          target: 'cell',
          mode: 'pulse',
          color: '#16a34a',
          durationMs: 600,
        },
      });
      (window as any).__flashCalls = [];
      const orig = s.grid.flashCells.bind(s.grid);
      s.grid.flashCells = (p: unknown) => {
        (window as any).__flashCalls.push(p);
        orig(p);
      };
      const cur = Number(s.grid.getCellValue(0, 'pnl')) || 0;
      s.simulateLiveTick({ positionId: rowId, pnl: cur + 2_500 });
    }, id);

    await expect.poll(async () =>
      page.evaluate(() => (window as any).__flashCalls?.length ?? 0),
    ).toBeGreaterThan(0);

    const call = await page.evaluate(() => (window as any).__flashCalls[0]);
    expect(call.rowIds).toContain(id);
    expect(call.color).toBe('#16a34a');
  });
});

test.describe('Perspective SSRM — alerts', () => {
  test('dataChange alert fires via simulateLiveTick', async ({ page }) => {
    await bootSeed(page, 600);
    const id = String(await cellValue(page, 0, 'positionId'));

    await page.evaluate((rowId) => {
      const s = (window as any).__simple;
      s.grid.addAlertRule({
        id: 'psp-alert-loss',
        name: 'Daily loss',
        enabled: true,
        priority: 10,
        severity: 'critical',
        trigger: {
          kind: 'dataChange',
          expression: '[dailyPnl] < -50000',
          columnIds: ['dailyPnl'],
        },
        message: 'Perspective loss on {rowId}: {value}',
        channels: ['badge'],
        debounceMs: 50,
      });
      (window as any).__alertEvents = [];
      s.grid.onAlert((ev: unknown) => (window as any).__alertEvents.push(ev));
      s.simulateLiveTick({ positionId: rowId, dailyPnl: -60_000 });
    }, id);

    await expect.poll(async () =>
      page.evaluate(() => (window as any).__alertEvents.length),
    ).toBeGreaterThan(0);

    const ev = await page.evaluate(() => (window as any).__alertEvents[0]);
    expect(ev.ruleId).toBe('psp-alert-loss');
    expect(ev.severity).toBe('critical');
    expect(String(ev.message)).toContain(id);
  });

  test('relativeChange alert on marketValue move', async ({ page }) => {
    await bootSeed(page, 600);
    const id = String(await cellValue(page, 0, 'positionId'));

    await page.evaluate((rowId) => {
      const s = (window as any).__simple;
      s.grid.addAlertRule({
        id: 'psp-alert-mv',
        name: 'MV move',
        enabled: true,
        priority: 20,
        severity: 'warning',
        trigger: {
          kind: 'relativeChange',
          colId: 'marketValue',
          mode: 'ABSOLUTE_CHANGE',
          threshold: 100,
          direction: 'both',
        },
        message: '{rule}: {rowId} {prev} → {value}',
        channels: ['badge'],
        debounceMs: 50,
      });
      (window as any).__alertEvents = [];
      s.grid.onAlert((e: unknown) => (window as any).__alertEvents.push(e));
      const cur = Number(s.grid.getCellValue(0, 'marketValue')) || 1_000_000;
      s.simulateLiveTick({ positionId: rowId, marketValue: cur + 5_000 });
    }, id);

    await expect.poll(async () =>
      page.evaluate(() => (window as any).__alertEvents.length),
    ).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => (window as any).__alertEvents[0].ruleId),
    ).toBe('psp-alert-mv');
  });
});

test.describe('Perspective SSRM — formatting', () => {
  test('editColumn format DSL compiles for pnl', async ({ page }) => {
    await bootSeed(page, 500);
    await page.evaluate(() => {
      (window as any).__simple.grid.editColumn('pnl', {
        format: '$#,##0.00;[Red]($#,##0.00)',
      });
    });
    await waitSettled(page);

    const text = await page.evaluate(() => {
      const def = (window as any).__simple.grid.columnDefsMap.get('pnl');
      const fn = def?.valueFormatter;
      if (typeof fn !== 'function') return { __missing: true };
      return fn({ value: -12.75, data: { pnl: -12.75 }, colId: 'pnl' });
    });
    expect(text).not.toEqual({ __missing: true });
    expect(String(text)).toMatch(/12\.75/);
  });

  test('calc.applyOverrides formats notionalAmount', async ({ page }) => {
    await bootSeed(page, 500);
    await page.evaluate(() => {
      (window as any).__simple.calc.applyOverrides([
        { colId: 'notionalAmount', format: '#,##0' },
      ]);
    });
    await waitSettled(page);
    const text = await page.evaluate(() => {
      const def = (window as any).__simple.grid.columnDefsMap.get('notionalAmount');
      const fn = def?.valueFormatter;
      if (typeof fn !== 'function') return { __missing: true };
      return fn({
        value: 1_000_000,
        data: { notionalAmount: 1_000_000 },
        colId: 'notionalAmount',
      });
    });
    expect(String(text)).toMatch(/1,000,000/);
    expect(await visibleCell(page, 'notionalAmount')).not.toBeNull();
    expectHealthyPaint(await probe(page), 'formatted notional');
  });
});
