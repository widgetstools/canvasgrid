import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21e / Task 16 — Conditional styling feature.
//
// Cell paint is canvas-side, so rule assertions probe the engine that
// the painter consults (window.__cgridRules, the same instance the
// bridge registered) plus the resolved composite program — mirroring
// formatDSL.spec.ts's resolved-def strategy. Flash is proven by
// recording grid.flashCells params in-page.

test.describe('conditional styling (rules)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'conditional-styling');
  });

  test('mounts 6 rows, wires the rule engine, description mentions Cycle 21e', async ({ page }) => {
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBe(6);
    const wired = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      return { hasEngine: !!rules, ruleIds: rules?.getRules().map((r: any) => r.id) };
    });
    expect(wired.hasEngine).toBe(true);
    expect(wired.ruleIds).toEqual(['neg-pnl', 'big-qty', 'up-tick', 'stale-row']);
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21e');
  });

  test('theme-aware negative P&L rule resolves per-theme colors', async ({ page }) => {
    const res = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      return {
        dark: rules.evaluateCell({ row: { pnl: -500 }, rowId: 'probe', colId: 'pnl', theme: 'dark' }),
        light: rules.evaluateCell({ row: { pnl: -500 }, rowId: 'probe', colId: 'pnl', theme: 'light' }),
        positive: rules.evaluateCell({ row: { pnl: 500 }, rowId: 'probe', colId: 'pnl', theme: 'dark' }),
      };
    });
    expect(res.dark.matched).toContain('neg-pnl');
    expect(res.dark.style.color).toBe('#ef9a9a');
    expect(res.light.style.color).toBe('#c62828');
    expect(res.positive.matched).not.toContain('neg-pnl');
  });

  test('row-scope threshold rule styles every cell of matching rows', async ({ page }) => {
    const res = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      const row = { symbol: 'TSLA', qty: 900, pnl: 95 };
      return {
        symbolCell: rules.evaluateCell({ row, rowId: 'TSLA', colId: 'symbol', theme: 'dark' }),
        small: rules.evaluateCell({ row: { qty: 80 }, rowId: 'AMZN', colId: 'symbol', theme: 'dark' }),
      };
    });
    expect(res.symbolCell.matched).toContain('big-qty');
    expect(res.symbolCell.style.fontWeight).toBe('bold');
    expect(res.symbolCell.style.backgroundColor).toBe('#3a3320');
    expect(res.small.matched).not.toContain('big-qty');
  });

  test('[rule:neg-pnl] composite fragment resolves the live rule color (21c reserve)', async ({ page }) => {
    const info = await page.evaluate(() => {
      const def = (window.__cgrid as any).columnDefsMap.get('summary');
      const program = def?._compositeProgram;
      const rules = (window as any).__cgridRules;
      const resolve = (row: Record<string, unknown>, rowId: string) => {
        const ctx = {
          value: null, row, colId: 'summary',
          resolveRuleRef: (id: string) =>
            rules.resolveRuleRef(id, { row, rowId, colId: 'summary', theme: 'dark' }),
        };
        return program?.resolveFragments(ctx);
      };
      return {
        hasRuleRefs: program?.hasRuleRefs === true,
        negColor: resolve({ symbol: 'GOOG', pnl: -840 }, 'GOOG')?.[2]?.style?.color ?? null,
        posColor: resolve({ symbol: 'AAPL', pnl: 1250 }, 'AAPL')?.[2]?.style?.color ?? null,
      };
    });
    expect(info.hasRuleRefs).toBe(true);
    expect(info.negColor).toBe('#ef9a9a'); // dark-theme rule color, live
    expect(info.posColor).toBeNull();      // rule not matching → no color
  });

  test('tick once — flash directive reaches grid.flashCells with rule color + mode', async ({ page }) => {
    await page.evaluate(() => {
      const grid = window.__cgrid as any;
      (window as any).__flashCalls = [];
      const orig = grid.flashCells.bind(grid);
      grid.flashCells = (p: unknown) => { (window as any).__flashCalls.push(p); orig(p); };
    });
    await page.getByTestId('btn-cs-tick-once').click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__flashCalls.length))
      .toBeGreaterThan(0);
    const call = await page.evaluate(() => (window as any).__flashCalls[0]);
    expect(call).toEqual({
      rowIds: ['AAPL'], colIds: ['price'],
      color: '#16a34a', mode: 'pulse', flashDuration: 600,
    });
  });

  test('match-count readout updates after a tick', async ({ page }) => {
    // Seeded: GOOG (-840) + AMZN (-2150) → APP 2.
    await expect(page.getByTestId('match-count-neg-pnl')).toHaveText('Negative P&L · APP 2');
    // Deterministic tick flips GOOG's pnl sign → APP 1.
    await page.getByTestId('btn-cs-tick-once').click();
    await expect(page.getByTestId('match-count-neg-pnl')).toHaveText('Negative P&L · APP 1');
  });

  test('indicator rule resolves a badge for STALE rows', async ({ page }) => {
    const res = await page.evaluate(() => {
      const rules = (window as any).__cgridRules;
      return {
        stale: rules.evaluateCell({ row: { status: 'STALE' }, rowId: 'AMZN', colId: null, theme: 'dark' }),
        live: rules.evaluateCell({ row: { status: 'LIVE' }, rowId: 'AAPL', colId: null, theme: 'dark' }),
      };
    });
    expect(res.stale.indicator).toEqual({
      iconName: 'triangle-alert', color: '#f59e0b', target: 'row-start', position: 'before',
    });
    expect(res.live.indicator).toBeNull();
    // The Lucide bundle loads async via the format bridge (mirrors
    // formatDSL.spec.ts's icon-resolution poll) — it must be resolvable
    // by paint time so the painter strokes a real Path2D.
    await expect
      .poll(() => page.evaluate(() => (window.__cgrid as any).resolveIcon('triangle-alert') !== null))
      .toBe(true);
  });
});
