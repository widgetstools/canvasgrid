import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('groupSelects feature', () => {
  test('loads with desk grouping', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('rowSelection is multiple', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const mode: string = await page.evaluate(() => {
      return (window.__cgrid as any)?.options?.rowSelection ?? '';
    });
    expect(mode).toBe('multiple');
  });

  test('groupSelectsChildren is enabled', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const enabled: boolean = await page.evaluate(() => {
      const g = window.__cgrid as any;
      return g?.options?.groupSelectsChildren === true || g?.options?.groupSelects === 'descendants';
    });
    expect(enabled).toBe(true);
  });

  test('description mentions cascade selection', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('cascade');
  });

  test('behaviour: leaf selection rolls the group checkbox up through all → partial → none', async ({ page }) => {
    await gotoFeature(page, 'groupSelects');

    // Populate the group→descendants membership cache (it's filled from a
    // worker model update; resetRowGroupExpansion forces a setGroupModel
    // round-trip that seeds it — mirrors the cgrid-positions task5 setup).
    await page.evaluate(() => (window.__cgrid as unknown as { resetRowGroupExpansion(): void }).resetRowGroupExpansion());
    await settle(page);

    // Default data-insertion order (DESKS = APAC, EMEA, AMER, LATAM
    // in seedData) → APAC is the first desk group. Its leaves are the
    // seed rows where i % 4 === 0 (R0, R4, … R96) = 25 ids.
    const amerIds = await page.evaluate(() => {
      const a: string[] = [];
      for (let i = 0; i < 100; i += 4) a.push('R' + i);
      return a;
    });

    const groupSelectionState = async (): Promise<string | undefined> => {
      return page.evaluate(() => {
        const cell = (window.__cgrid as unknown as {
          getCellValue(r: number, c: string): { selectionState?: string } | null;
        }).getCellValue(0, 'ag-Grid-AutoColumn');
        return cell?.selectionState;
      });
    };

    // Select every AMER leaf → the group checkbox rolls up to 'all'.
    await page.evaluate((ids) => (window.__cgrid as unknown as { setSelectedRowIds(ids: string[]): void }).setSelectedRowIds(ids), amerIds);
    await settle(page);
    expect(await groupSelectionState()).toBe('all');

    // Select a subset → 'partial'.
    await page.evaluate(() => (window.__cgrid as unknown as { setSelectedRowIds(ids: string[]): void }).setSelectedRowIds(['R0', 'R4']));
    await settle(page);
    expect(await groupSelectionState()).toBe('partial');

    // Clear → 'none'.
    await page.evaluate(() => (window.__cgrid as unknown as { setSelectedRowIds(ids: string[]): void }).setSelectedRowIds([]));
    await settle(page);
    expect(await groupSelectionState()).toBe('none');
  });
});

async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((res) => {
    let n = 0;
    const tick = (): void => { if (++n >= 8) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
}
