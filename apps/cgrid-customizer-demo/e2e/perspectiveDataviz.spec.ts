import { test, expect, type Page } from '@playwright/test';

/**
 * Perspective look & feel — surface #3 (inline data-viz) smoke.
 *
 * The curated numeric columns carry @cgrid/renderers cell renderers: P&L +
 * Unrealized → 'pnl' (sign-colored blue/salmon from the theme tokens), Daily
 * P&L → 'bidirectional-bar', Notional → 'heat'. The canvas can't be pixel-
 * asserted here, so the wiring is verified via the live columnDefs
 * (`__cgapi.getGridOption('columnDefs')`); pixel/color parity is browser-verified
 * by the controller.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    { timeout: 10_000 },
  );
}

/** cellRenderer for a colId, walking the (possibly nested) columnDefs tree. */
function rendererFor(page: Page, colId: string) {
  return page.evaluate((id) => {
    const api = (window as unknown as { __cgapi: any }).__cgapi;
    const defs = api.getGridOption('columnDefs') as any[];
    const find = (nodes: any[]): any => {
      for (const n of nodes) {
        if ((n.colId ?? n.field) === id) return n;
        if (Array.isArray(n.children)) { const f = find(n.children); if (f) return f; }
      }
      return null;
    };
    const def = find(defs);
    return def ? { cellRenderer: def.cellRenderer ?? null, valueFormatter: def.valueFormatter ?? null } : null;
  }, colId);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => { localStorage.removeItem(key); localStorage.setItem('custdemo:theme', 'dark'); }, STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('the P&L family uses the pnl renderer with no [Red] formatter', async ({ page }) => {
  for (const colId of ['pnl', 'unrealizedPnl']) {
    const def = await rendererFor(page, colId);
    expect(def?.cellRenderer).toBe('pnl');
    expect(String(def?.valueFormatter ?? '')).not.toContain('[Red]'); // color owned by the renderer now
  }
});

test('Daily P&L uses the bidirectional-bar renderer', async ({ page }) => {
  expect((await rendererFor(page, 'dailyPnl'))?.cellRenderer).toBe('bidirectional-bar');
});

test('Notional uses the heat renderer', async ({ page }) => {
  expect((await rendererFor(page, 'notionalAmount'))?.cellRenderer).toBe('heat');
});
