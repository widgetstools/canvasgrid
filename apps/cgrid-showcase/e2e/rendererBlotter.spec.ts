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

  // Final-review F5 — end-to-end click routing (canvas click → kernel
  // `cellClicked` → bridge hit-region resolve → RowMenuCellParams.onOpen)
  // was previously only exercised at the unit level (wireRenderersIntoKernel
  // bridge tests with a fake grid). This drives the REAL kernel: locate the
  // row-menu kebab cell via CGrid's public `getCellBoundsAt(rowIndex, colId)`
  // geometry API, click its canvas-local pixel, and assert the demo's
  // onOpen callback (wired at rendererBlotter.ts:118-125) actually fired.
  //
  // This used to be a documented `test.fail()` tripwire: the kernel's
  // `cellClicked` payload carried a synthetic `row-0` rowId instead of the
  // real string rowId ('r1') that the paint path (and therefore the
  // renderer's hit-region registration) used, so `onOpen`/`onAction`
  // callbacks could never resolve. Fixed in `packages/kernel/src/cgrid.ts`
  // — `rowIdAt()` now delegates to the real chunk-backed string id
  // (`stringRowIdAt()`), falling back to the synthetic id only outside the
  // loaded viewport window. This test now asserts the real, working
  // behavior.
  test('clicking the row-menu kebab routes cellClicked to onOpen (F5)', async ({ page }) => {
    await gotoFeature(page, 'renderer-blotter');

    type Bounds = { x: number; y: number; w: number; h: number };
    const getRowMenuBounds = (): Promise<Bounds | null> => page.evaluate(() => {
      const g = window.__cgrid as unknown as {
        getCellBoundsAt: (rowIndex: number, colId: string) => Bounds | null;
      };
      return g.getCellBoundsAt(0, 'rowMenu');
    });

    // The blotter's 13 columns (100px each) overflow the grid's ~1179px
    // body width at this viewport, so `rowMenu` (the last column) isn't
    // scrolled into view by default — `getCellBoundsAt` correctly returns
    // null for an off-screen column. Scroll it into view first; the
    // kernel's viewport recompute after a programmatic scroll completes
    // via an async worker round-trip (not synchronous with
    // `ensureColumnVisible`), so poll rather than reading bounds immediately.
    await page.evaluate(() => {
      (window.__cgrid as unknown as {
        ensureColumnVisible: (colId: string, position?: string) => void;
      }).ensureColumnVisible('rowMenu', 'end');
    });
    await expect.poll(getRowMenuBounds).not.toBeNull();
    const bounds = (await getRowMenuBounds())!;

    // The kebab is a 20×20 hit region right-aligned in the cell with the
    // renderer's default 6px right padding (actions.ts KEBAB_SIZE/padding) —
    // click well inside that region regardless of exact padding.
    const canvas = page.locator('#grid-host canvas').first();
    await canvas.click({
      position: { x: bounds.x + bounds.w - 16, y: bounds.y + bounds.h / 2 },
    });

    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __cgridRendererActionLog?: string[] }
    ).__cgridRendererActionLog ?? [])).toContainEqual('menu:r1');
  });
});
