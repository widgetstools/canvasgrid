/**
 * Cycle 8 / Task 1 — multi-column sort + header sort-order badge.
 *
 * Verifies that:
 * 1. A plain click on a header REPLACES the sort model with a single entry.
 * 2. A Shift+click on a second header APPENDS to the model (multi-sort).
 * 3. The header painter draws a visible order badge to the LEFT of the
 *    chevron once `sortTotal > 1`. We confirm this by hashing the pixel
 *    strip just left of the chevron BEFORE and AFTER the multi-sort and
 *    asserting the hash changes.
 * 4. The `sortChanged` event fires once per click with the new model.
 */
import { test, expect, Page, Locator } from '@playwright/test';

interface HeaderBounds { x: number; y: number; w: number; h: number }
type SortEntry = { colId: string; direction: 'asc' | 'desc' };

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => HeaderBounds | null;
  on: (
    type: 'sortChanged',
    handler: (e: { type: 'sortChanged'; sortModel: SortEntry[] }) => void,
  ) => () => void;
}

const GRID_SELECTOR = '#grid canvas';

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

async function sortModel(page: Page): Promise<SortEntry[]> {
  return page.evaluate(
    () => (window as unknown as { __velocity-grid: { sortModel: SortEntry[] } }).__cgrid.sortModel,
  );
}

async function headerBounds(page: Page, colId: string): Promise<HeaderBounds> {
  const b = await page.evaluate(
    (id) =>
      (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getHeaderBoundsAt(id),
    colId,
  );
  if (!b) throw new Error(`no header bounds for ${colId}`);
  return b;
}

/** FNV-1a 32-bit pixel signature of the canvas region. Used to confirm
 *  that a region's painted bytes change between two states without
 *  caring about the exact pixel values. */
async function regionSignature(
  canvas: Locator,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<string> {
  return canvas.evaluate(
    (el: HTMLCanvasElement, args: { x: number; y: number; w: number; h: number }) => {
      const ctx = el.getContext('2d');
      if (!ctx) return '0';
      const dpr = el.width / Math.max(1, parseInt(el.style.width || '0', 10));
      const sx = Math.max(0, Math.floor(args.x * dpr));
      const sy = Math.max(0, Math.floor(args.y * dpr));
      const sw = Math.min(Math.floor(args.w * dpr), el.width - sx);
      const sh = Math.min(Math.floor(args.h * dpr), el.height - sy);
      if (sw <= 0 || sh <= 0) return '0';
      const img = ctx.getImageData(sx, sy, sw, sh).data;
      let h32 = 0x811c9dc5 >>> 0;
      for (let i = 0; i < img.length; i++) {
        h32 = Math.imul(h32 ^ (img[i] ?? 0), 0x01000193) >>> 0;
      }
      return h32.toString(16);
    },
    { x, y, w, h },
  );
}

test.describe('Cycle 8 / Task 1 — multi-column sort + badge', () => {
  test('plain click on cusip header replaces the sort model with a single entry', async ({ page }) => {
    await gridReady(page);
    const cusip = await headerBounds(page, 'cusip');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + cusip.x + cusip.w / 2, off.y + cusip.y + cusip.h / 2);
    await waitForFrames(page, 6);
    const model = await sortModel(page);
    expect(model).toEqual([{ colId: 'cusip', direction: 'asc' }]);
  });

  test('Shift+click on a second header APPENDS to the sort model', async ({ page }) => {
    await gridReady(page);
    const cusip = await headerBounds(page, 'cusip');
    const ticker = await headerBounds(page, 'ticker');
    const off = await canvasOffset(page);

    // Plain click on cusip → asc.
    await page.mouse.click(off.x + cusip.x + cusip.w / 2, off.y + cusip.y + cusip.h / 2);
    await waitForFrames(page, 6);
    expect((await sortModel(page)).length).toBe(1);

    // Shift+click on ticker → APPEND.
    await page.locator(GRID_SELECTOR).click({
      position: { x: ticker.x + ticker.w / 2, y: ticker.y + ticker.h / 2 },
      modifiers: ['Shift'],
    });
    await waitForFrames(page, 6);

    const model = await sortModel(page);
    expect(model).toEqual([
      { colId: 'cusip', direction: 'asc' },
      { colId: 'ticker', direction: 'asc' },
    ]);
  });

  test('sort-order badge paints when sortTotal > 1', async ({ page }) => {
    await gridReady(page);
    const canvas = page.locator(GRID_SELECTOR);
    const cusip = await headerBounds(page, 'cusip');
    const off = await canvasOffset(page);

    // Strip to the LEFT of the chevron — that's where the badge lives.
    // Chevron sits ~8 px from the right edge with a 14 px box; the badge
    // is drawn ~24 px from the right edge.
    const stripX = cusip.x + cusip.w - 30;
    const stripY = cusip.y + 2;
    const stripW = 12;
    const stripH = cusip.h - 4;

    // Single-column sort first — paint the chevron without a badge.
    await page.mouse.click(off.x + cusip.x + cusip.w / 2, off.y + cusip.y + cusip.h / 2);
    await waitForFrames(page, 8);
    const sigSingle = await regionSignature(canvas, stripX, stripY, stripW, stripH);

    // Shift+click on ticker → multi-sort. cusip is now sortIndex=1 of 2;
    // the badge should appear in the same strip.
    const ticker = await headerBounds(page, 'ticker');
    await page.locator(GRID_SELECTOR).click({
      position: { x: ticker.x + ticker.w / 2, y: ticker.y + ticker.h / 2 },
      modifiers: ['Shift'],
    });
    await waitForFrames(page, 8);
    const sigMulti = await regionSignature(canvas, stripX, stripY, stripW, stripH);

    expect(sigSingle).not.toEqual(sigMulti);

    // Final assertion to confirm the sortModel landed as expected so
    // we know the painter ran with sortTotal=2.
    expect(await sortModel(page)).toEqual([
      { colId: 'cusip', direction: 'asc' },
      { colId: 'ticker', direction: 'asc' },
    ]);
  });

  test('sortChanged event fires with the multi-column model', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      const w = window as unknown as {
        __velocity-grid: GridApiSurface;
        __sortEvents: Array<SortEntry[]>;
      };
      w.__sortEvents = [];
      w.__cgrid.on('sortChanged', (e) => w.__sortEvents.push(e.sortModel));
    });

    const cusip = await headerBounds(page, 'cusip');
    const ticker = await headerBounds(page, 'ticker');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + cusip.x + cusip.w / 2, off.y + cusip.y + cusip.h / 2);
    await waitForFrames(page, 6);
    await page.locator(GRID_SELECTOR).click({
      position: { x: ticker.x + ticker.w / 2, y: ticker.y + ticker.h / 2 },
      modifiers: ['Shift'],
    });
    await waitForFrames(page, 8);

    const events = await page.evaluate(
      () => (window as unknown as { __sortEvents: Array<SortEntry[]> }).__sortEvents,
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toEqual([
      { colId: 'cusip', direction: 'asc' },
      { colId: 'ticker', direction: 'asc' },
    ]);
  });
});
