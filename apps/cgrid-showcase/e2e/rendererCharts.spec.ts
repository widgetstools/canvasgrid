import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('renderer charts feature', () => {
  test('loads with canvas grid and Cycle 21f description', async ({ page }) => {
    await gotoFeature(page, 'renderer-charts');
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21f');
    await expect(page.locator('#grid-host canvas').first()).toBeVisible();
  });

  test('wires renderers bridge with stats and history helpers', async ({ page }) => {
    await gotoFeature(page, 'renderer-charts');
    const info = await page.evaluate(() => {
      const h = window.__cgridRenderers;
      const stats = h?.stats.for('pnl');
      return {
        maxPnl: stats?.max ?? null,
        historyLen: h?.history.get('c1', 'spread')?.length ?? 0,
      };
    });
    expect(info.maxPnl).toBeGreaterThan(0);
    expect(info.historyLen).toBeGreaterThan(0);
  });

  test('mounts five chart rows', async ({ page }) => {
    await gotoFeature(page, 'renderer-charts');
    const rowCount: number = await page.evaluate(() => (window.__cgrid as { rowCount?: number })?.rowCount ?? 0);
    expect(rowCount).toBe(5);
  });

  test('resolves bar, chart, and composite renderer names', async ({ page }) => {
    await gotoFeature(page, 'renderer-charts');
    const names = await page.evaluate((ids) => {
      const g = window.__cgrid as { columnDefsMap?: Map<string, { cellRenderer?: string }> } | null;
      const out: Record<string, string | undefined> = {};
      for (const id of ids) {
        out[id] = g?.columnDefsMap?.get(id)?.cellRenderer;
      }
      return out;
    }, ['pnl', 'qty', 'fillPct', 'history', 'dailyPnl', 'mid', 'bps', 'price', 'spread']);
    expect(names.pnl).toBe('heat');
    expect(names.qty).toBe('volume-bar');
    expect(names.fillPct).toBe('progress-bar');
    expect(names.history).toBe('line-sparkline');
    expect(names.dailyPnl).toBe('win-loss-sparkline');
    expect(names.mid).toBe('price-quote');
    expect(names.bps).toBe('benchmark-spread');
    expect(names.price).toBe('stacked-value');
    expect(names.spread).toBe('spread-bar');
  });

  test('tick once widens c1 spread', async ({ page }) => {
    await gotoFeature(page, 'renderer-charts');
    const before: number = await page.evaluate(() => {
      const g = window.__cgrid as { getCellValue?: (i: number, c: string) => unknown };
      return Number(g.getCellValue?.(0, 'spread'));
    });
    await page.getByTestId('btn-renderer-charts-tick-once').click();
    await expect.poll(async () => page.evaluate(() => {
      const g = window.__cgrid as { getCellValue?: (i: number, c: string) => unknown };
      return Number(g.getCellValue?.(0, 'spread'));
    })).toBeGreaterThan(before);
  });

  test('chart toolbar controls are visible', async ({ page }) => {
    await gotoFeature(page, 'renderer-charts');
    await expect(page.getByTestId('btn-renderer-charts-tick')).toBeVisible();
    await expect(page.getByTestId('btn-renderer-charts-tick-once')).toBeVisible();
  });
});
