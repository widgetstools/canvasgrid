import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('events + state feature', () => {
  // Each test that doesn't deliberately exercise auto-restore clears
  // localStorage AFTER mounting (not via addInitScript — that would
  // also clear it after `page.reload()`, defeating the restore test).
  const STORAGE_KEY = 'velocity-grid:showcase:events-state:snapshot';

  test('save layout writes the snapshot to localStorage', async ({ page }) => {
    await gotoFeature(page, 'eventsState');
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    await page.getByTestId('btn-save-state').click();
    const stored: string | null = await page.evaluate(() =>
      localStorage.getItem('velocity-grid:showcase:events-state:snapshot'));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(1);
    expect(parsed.columnState).toBeDefined();
  });

  test('save → reload restores the layout via initialState', async ({ page }) => {
    await gotoFeature(page, 'eventsState');
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    // Mutate sort state, save, then reload.
    await page.evaluate(() => {
      const g = (window as any).__cgrid;
      g.cycleSort('pnl');
    });
    await page.getByTestId('btn-save-state').click();
    await page.reload();
    await page.waitForFunction(() => (window as any).__cgridReady === true, { timeout: 10_000 });
    await page.waitForTimeout(300); // initialState applies after gridReady
    const sortModel = await page.evaluate(() => (window as any).__cgrid.getSortModel());
    expect(sortModel.length).toBeGreaterThanOrEqual(1);
    expect(sortModel[0].colId).toBe('pnl');
  });

  test('reset state clears the snapshot from localStorage AND wipes the model', async ({ page }) => {
    await gotoFeature(page, 'eventsState');
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    await page.evaluate(() => { (window as any).__cgrid.cycleSort('ticker'); });
    await page.getByTestId('btn-save-state').click();
    await page.getByTestId('btn-reset-state').click();
    const stored: string | null = await page.evaluate(() =>
      localStorage.getItem('velocity-grid:showcase:events-state:snapshot'));
    expect(stored).toBeNull();
    const sortModel = await page.evaluate(() => (window as any).__cgrid.getSortModel());
    expect(sortModel.length).toBe(0);
  });

  test('event log appears and the clear button empties it', async ({ page }) => {
    await gotoFeature(page, 'eventsState');
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    // Hover over the canvas to fire some hover events.
    const canvas = page.locator('#grid-host canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 200, box!.y + 100);
    await page.mouse.move(box!.x + 200, box!.y + 150);
    await page.mouse.move(box!.x + 400, box!.y + 200);
    // Log gets populated.
    const logBefore = await page.getByTestId('event-log').textContent();
    expect(logBefore?.length ?? 0).toBeGreaterThan(0);
    await page.getByTestId('btn-clear-log').click();
    const logAfter = await page.getByTestId('event-log').textContent();
    expect(logAfter ?? '').toBe('');
  });

  test('stateUpdated fires after cycleSort with the sortModel changedKey', async ({ page }) => {
    await gotoFeature(page, 'eventsState');
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    const updates: any[] = await page.evaluate(() => {
      return new Promise((resolve) => {
        const collected: any[] = [];
        (window as any).__cgrid.on('stateUpdated', (e: any) => {
          collected.push({ keys: e.changedKeys, source: e.source });
          if (collected.length === 1) resolve(collected);
        });
        (window as any).__cgrid.cycleSort('region');
        // Safety timeout — flush via bus and resolve whatever came.
        setTimeout(() => resolve(collected), 500);
      });
    });
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].keys).toContain('sortModel');
  });
});
