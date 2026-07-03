import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';
import { RENDERER_NAMES } from '@cgrid/renderers';

test.describe('renderer catalog feature', () => {
  test('loads with canvas grid and Cycle 21f description', async ({ page }) => {
    await gotoFeature(page, 'renderer-catalog');
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21f');
    await expect(page.locator('#grid-host canvas').first()).toBeVisible();
  });

  test('mounts one catalog row with 51 renderer columns', async ({ page }) => {
    await gotoFeature(page, 'renderer-catalog');
    const info = await page.evaluate(() => ({
      rowCount: (window.__cgrid as { rowCount?: number })?.rowCount ?? 0,
      catalogCount: (window as unknown as { __cgridRendererCatalogCount?: number }).__cgridRendererCatalogCount ?? 0,
    }));
    expect(info.rowCount).toBe(1);
    expect(info.catalogCount).toBe(51);
  });

  test('resolves every canonical renderer name on columnDefsMap', async ({ page }) => {
    await gotoFeature(page, 'renderer-catalog');
    const resolved = await page.evaluate((names) => {
      const g = window.__cgrid as { columnDefsMap?: Map<string, { cellRenderer?: string }> } | null;
      const missing: string[] = [];
      for (const name of names) {
        const got = g?.columnDefsMap?.get(name)?.cellRenderer;
        if (got !== name) missing.push(`${name}:${String(got)}`);
      }
      return missing;
    }, [...RENDERER_NAMES]);
    expect(resolved).toEqual([]);
  });

  test('wires window.__cgridRenderers bridge handle', async ({ page }) => {
    await gotoFeature(page, 'renderer-catalog');
    const wired = await page.evaluate(() => {
      const h = window.__cgridRenderers;
      return typeof h?.colDef?.renderer === 'function';
    });
    expect(wired).toBe(true);
  });

  test('catalog count control is visible', async ({ page }) => {
    await gotoFeature(page, 'renderer-catalog');
    await expect(page.getByTestId('btn-renderer-catalog-count')).toHaveText('51 renderers');
  });
});
