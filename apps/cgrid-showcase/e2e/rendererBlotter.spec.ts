import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

async function rendererNames(page: import('@playwright/test').Page, colIds: string[]): Promise<Record<string, string | undefined>> {
  return page.evaluate((ids) => {
    const g = window.__cgrid as { columnDefsMap?: Map<string, { cellRenderer?: string }> } | null;
    const out: Record<string, string | undefined> = {};
    for (const id of ids) {
      out[id] = g?.columnDefsMap?.get(id)?.cellRenderer;
    }
    return out;
  }, colIds);
}

test.describe('renderer blotter feature', () => {
  test('loads with canvas grid and Cycle 21f description', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21f');
    await expect(page.locator('#grid-host canvas').first()).toBeVisible();
  });

  test('wires window.__cgridRenderers bridge handle', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');
    const wired = await page.evaluate(() => {
      const h = window.__cgridRenderers;
      return {
        hasColDef: typeof h?.colDef?.price === 'function',
        hasStats: typeof h?.stats?.for === 'function',
      };
    });
    expect(wired.hasColDef).toBe(true);
    expect(wired.hasStats).toBe(true);
  });

  test('mounts five blotter rows', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');
    const rowCount: number = await page.evaluate(() => (window.__cgrid as { rowCount?: number })?.rowCount ?? 0);
    expect(rowCount).toBe(5);
  });

  test('resolves numeric, badge, and action renderer names', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');
    const names = await rendererNames(page, [
      'price', 'pnl', 'delta', 'status', 'venue', 'side', 'rating', 'actions', 'rowMenu',
    ]);
    expect(names.price).toBe('price');
    expect(names.pnl).toBe('pnl');
    expect(names.delta).toBe('delta');
    expect(names.status).toBe('status-pill');
    expect(names.venue).toBe('venue-chip');
    expect(names.side).toBe('side-chip');
    expect(names.rating).toBe('rating-badge');
    expect(names.actions).toBe('icon-action-cluster');
    expect(names.rowMenu).toBe('row-menu');
  });

  test('tick once mutates AAPL price', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');
    const before: number = await page.evaluate(() => {
      const g = window.__cgrid as { getCellValue?: (i: number, c: string) => unknown };
      return Number(g.getCellValue?.(0, 'price'));
    });
    await page.getByTestId('btn-renderer-blotter-tick-once').click();
    await expect.poll(async () => page.evaluate(() => {
      const g = window.__cgrid as { getCellValue?: (i: number, c: string) => unknown };
      return Number(g.getCellValue?.(0, 'price'));
    })).toBeGreaterThan(before);
  });

  test('ticker toolbar controls are visible', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');
    await expect(page.getByTestId('btn-renderer-blotter-tick')).toBeVisible();
    await expect(page.getByTestId('btn-renderer-blotter-tick-once')).toBeVisible();
  });
});
