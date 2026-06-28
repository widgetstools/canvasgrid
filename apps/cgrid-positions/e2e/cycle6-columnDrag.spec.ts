/**
 * Cycle 6 / Task 1 — column drag-reorder.
 *
 * `ColumnDrag` mounts after `ColumnResizing` in the FeatureChain. Pressing
 * the body of a leaf header (not the right-edge resizer hot zone) starts a
 * drag; releasing past the threshold commits via `reorderColumn`. The demo
 * marks `positionId` as `suppressMovable: true` and `notionalAmount` as
 * `lockPosition: 'right'` so this spec has positive + negative cases.
 *
 * The unit suite (`cgrid/tests/columnDrag.test.ts`) covers the state
 * machine; this E2E asserts the end-to-end pointer-events → engine →
 * columnOrder pipeline lights up against a real worker round-trip.
 */
import { test, expect } from '@playwright/test';

interface HeaderBounds { x: number; y: number; w: number; h: number }

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => HeaderBounds | null;
  moveColumnByIndex: (fromIndex: number, toIndex: number) => void;
  on: (
    type: 'columnMoved',
    handler: (e: { type: 'columnMoved'; toIndex: number; colIds: string[]; source: string }) => void,
  ) => () => void;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  // Settle so the first viewport paints and getHeaderBoundsAt resolves.
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

async function colIdsByDeclarationOrder(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = (window as unknown as {
      __cgrid: { getGridOption: (k: 'columnDefs') => unknown };
    }).__cgrid;
    const defs = grid.getGridOption('columnDefs') as unknown[];
    const flat: string[] = [];
    const walk = (nodes: unknown[]): void => {
      for (const node of nodes) {
        const obj = node as { children?: unknown[]; colId?: string; field?: string };
        if (Array.isArray(obj.children)) walk(obj.children);
        else flat.push((obj.colId ?? obj.field) as string);
      }
    };
    walk(defs);
    return flat;
  });
}

async function canvasOffset(page: import('@playwright/test').Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

test.describe('Cycle 6 / Task 1 — column drag-reorder', () => {
  test('dragging the cusip header past ticker swaps their declaration order', async ({ page }) => {
    await gridReady(page);
    const before = await colIdsByDeclarationOrder(page);
    // Sanity — initial demo declaration places cusip before ticker.
    expect(before.indexOf('cusip')).toBeLessThan(before.indexOf('ticker'));

    const cusip = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('cusip');
    });
    const ticker = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('ticker');
    });
    expect(cusip).not.toBeNull();
    expect(ticker).not.toBeNull();

    const off = await canvasOffset(page);
    const srcX = off.x + cusip!.x + cusip!.w / 2;
    const srcY = off.y + cusip!.y + cusip!.h / 2;
    // Drop past ticker's center so the drop-target index lands on ticker.
    const dstX = off.x + ticker!.x + ticker!.w * 0.75;
    const dstY = off.y + ticker!.y + ticker!.h / 2;

    await page.mouse.move(srcX, srcY);
    await page.mouse.down();
    // Steps > 1 so handleMouseDrag fires multiple times — drives the
    // pressed → dragging promotion above the 4 px threshold.
    await page.mouse.move(dstX, dstY, { steps: 10 });
    await page.mouse.up();

    // Repaint settle.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 4 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const after = await colIdsByDeclarationOrder(page);
    expect(after.indexOf('ticker')).toBeLessThan(after.indexOf('cusip'));
  });

  test('suppressMovable column (positionId) refuses to swap with cusip', async ({ page }) => {
    await gridReady(page);
    const before = await colIdsByDeclarationOrder(page);
    expect(before[0]).toBe('positionId');

    const pos = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('positionId');
    });
    const cusip = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('cusip');
    });
    expect(pos).not.toBeNull();
    expect(cusip).not.toBeNull();

    const off = await canvasOffset(page);
    await page.mouse.move(off.x + pos!.x + pos!.w / 2, off.y + pos!.y + pos!.h / 2);
    await page.mouse.down();
    await page.mouse.move(off.x + cusip!.x + cusip!.w * 0.75, off.y + cusip!.y + cusip!.h / 2, { steps: 10 });
    await page.mouse.up();

    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 4 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const after = await colIdsByDeclarationOrder(page);
    expect(after[0]).toBe('positionId');
  });

  test.skip('drag shows a ghost header + insertion line while in flight', async ({ page }) => {
    // TODO: .cg-column-drag-ghost DOM element is not yet implemented in cgrid.ts.
    // Only .cg-column-drag-insertion-line exists. Unskip when the ghost card is built.
    await gridReady(page);

    const cusip = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('cusip');
    });
    expect(cusip).not.toBeNull();

    const off = await canvasOffset(page);
    const srcX = off.x + cusip!.x + cusip!.w / 2;
    const srcY = off.y + cusip!.y + cusip!.h / 2;

    await page.mouse.move(srcX, srcY);
    await page.mouse.down();
    // Mid-drag — past 4 px threshold; ghost + line should be mounted.
    await page.mouse.move(srcX + 80, srcY, { steps: 6 });

    const overlay = await page.evaluate(() => {
      const ghost = document.querySelector('.cg-column-drag-ghost');
      const line = document.querySelector('.cg-column-drag-insertion-line');
      return {
        ghostText: ghost ? (ghost.textContent ?? '') : null,
        ghostHasTransform: ghost ? !!(ghost as HTMLElement).style.transform : false,
        lineHasTransform: line ? !!(line as HTMLElement).style.transform : false,
      };
    });
    expect(overlay.ghostText, 'ghost text matches the dragged column headerName').toBe('CUSIP');
    expect(overlay.ghostHasTransform).toBe(true);
    expect(overlay.lineHasTransform).toBe(true);

    await page.mouse.up();

    const afterDrop = await page.evaluate(() => ({
      ghost: document.querySelector('.cg-column-drag-ghost'),
      line: document.querySelector('.cg-column-drag-insertion-line'),
    }));
    expect(afterDrop.ghost).toBeNull();
    expect(afterDrop.line).toBeNull();
  });

  test('a drag does NOT fire sortChanged on the dragged column (click after drag is swallowed)', async ({ page }) => {
    await gridReady(page);
    const cusip = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('cusip');
    });
    const ticker = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('ticker');
    });
    expect(cusip).not.toBeNull();
    expect(ticker).not.toBeNull();

    // Subscribe BEFORE the drag so we catch any sortChanged the drag may fire.
    await page.evaluate(() => {
      const grid = (window as unknown as {
        __cgrid: GridApiSurface & {
          on: (
            type: 'sortChanged',
            handler: (e: { type: 'sortChanged'; sortModel: unknown }) => void,
          ) => () => void;
        };
      }).__cgrid;
      (window as unknown as { __sortEvents: unknown[] }).__sortEvents = [];
      grid.on('sortChanged', (e) => {
        (window as unknown as { __sortEvents: unknown[] }).__sortEvents.push(e.sortModel);
      });
    });

    const off = await canvasOffset(page);
    await page.mouse.move(off.x + cusip!.x + cusip!.w / 2, off.y + cusip!.y + cusip!.h / 2);
    await page.mouse.down();
    await page.mouse.move(off.x + ticker!.x + ticker!.w * 0.75, off.y + ticker!.y + ticker!.h / 2, { steps: 10 });
    await page.mouse.up();
    // Settle so any spurious click → sort would fire.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 4 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const events = await page.evaluate(
      () => (window as unknown as { __sortEvents: unknown[] }).__sortEvents,
    );
    expect(events).toEqual([]);
  });

  test('moveColumnByIndex API moves columns and fires columnMoved with source: "api"', async ({ page }) => {
    await gridReady(page);
    const before = await colIdsByDeclarationOrder(page);
    const cusipIdx = before.indexOf('cusip');
    const tickerIdx = before.indexOf('ticker');
    expect(cusipIdx).toBeGreaterThanOrEqual(0);
    expect(tickerIdx).toBeGreaterThanOrEqual(0);

    // Subscribe BEFORE invoking; the listener receives the synchronous emit.
    const result = await page.evaluate((args) => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const events: { toIndex: number; colIds: string[]; source: string }[] = [];
      const off = grid.on('columnMoved', (e) => {
        events.push({ toIndex: e.toIndex, colIds: e.colIds, source: e.source });
      });
      grid.moveColumnByIndex(args.from, args.to);
      off();
      return events;
    }, { from: cusipIdx, to: tickerIdx });

    expect(result.length).toBe(1);
    expect(result[0]!.source).toBe('api');
    expect(result[0]!.colIds).toEqual(['cusip']);
  });
});
