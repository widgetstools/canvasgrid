/**
 * Cycle 15 / Task 6 — drag a column header into the row group panel.
 *
 * The row group panel mounts ABOVE the column header row. When a
 * column with `enableRowGroup: true` is dragged from its header into
 * the panel, the drag feature delegates to
 * `grid.commitRowGroupPanelDrop(colId)` on mouseup; the host appends
 * the column to `rowGroupCols`, fires `setGroupModel`, and the worker
 * picks up the new grouping on the next viewport. The unit suite
 * (`cgrid/tests/rowGroupPanel.test.ts`) covers the drop-verdict
 * pathway against a recording context; this E2E pins the end-to-end
 * pointer-events → drag → host → grid → group pipeline against a
 * real worker round-trip.
 *
 * Demo wiring (`apps/cgrid-positions/src/positionsGrid.ts`):
 *   `?rowGroupPanel=empty` opts the demo into
 *   `rowGroupPanelShow: 'always'` with no chips, and marks the
 *   `ticker` column with `enableRowGroup: true` so the drag succeeds.
 */
import { test, expect } from '@playwright/test';

interface HeaderBounds { x: number; y: number; w: number; h: number }

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => HeaderBounds | null;
  getGroupModel?: () => { rowGroupCols: string[] };
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?rowGroupPanel=empty&totals=off');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = (): void => {
        if (++n >= 8) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  );
}

async function canvasOffset(page: import('@playwright/test').Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

test.describe('Cycle 15 / Task 6 — drag column to row group panel', () => {
  test('dragging ticker header into the panel appends it to rowGroupCols', async ({ page }) => {
    await gridReady(page);

    // Empty-state placeholder is visible before the drag — no chips,
    // dashed strip reading the canonical sidebar phrase.
    const beforeText = await page.evaluate(() => {
      const empty = document.querySelector('.vg-row-group-panel-empty');
      return empty?.textContent ?? null;
    });
    expect(beforeText).toBe('Drag here to set row groups');
    const chipCountBefore = await page.evaluate(
      () => document.querySelectorAll('.vg-row-group-panel-chip').length,
    );
    expect(chipCountBefore).toBe(0);

    const ticker = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return grid.getHeaderBoundsAt('ticker');
    });
    expect(ticker).not.toBeNull();

    // Panel rect — viewport coords. The drop target is anywhere
    // inside this rect; we aim for the middle horizontally and the
    // vertical center.
    const panelRect = await page.evaluate(() => {
      const panel = document.querySelector('.vg-row-group-panel') as HTMLElement | null;
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    expect(panelRect).not.toBeNull();

    const off = await canvasOffset(page);
    // Source: middle of the ticker header.
    const srcX = off.x + ticker!.x + ticker!.w / 2;
    const srcY = off.y + ticker!.y + ticker!.h / 2;
    // Target: middle of the row group panel.
    const dstX = panelRect!.x + panelRect!.w / 2;
    const dstY = panelRect!.y + panelRect!.h / 2;

    await page.mouse.move(srcX, srcY);
    await page.mouse.down();
    // Multiple steps to pass the 4 px threshold + drive multiple
    // dispatchRowGroupPanelHover ticks before the final drop.
    await page.mouse.move(dstX, dstY, { steps: 10 });
    await page.mouse.up();

    // Settle so the worker round-trip + the re-render lands.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = (): void => {
          if (++n >= 8) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    );

    // After the drop: one chip carrying the ticker header name.
    const afterChips = await page.evaluate(() => {
      const chips = Array.from(
        document.querySelectorAll('.vg-row-group-panel-chip'),
      ) as HTMLElement[];
      return chips.map((c) => ({
        colId: c.dataset.colId,
        label: c.querySelector('.vg-row-group-panel-chip-label')?.textContent ?? null,
      }));
    });
    expect(afterChips).toHaveLength(1);
    expect(afterChips[0]!.colId).toBe('ticker');
    expect(afterChips[0]!.label).toBe('Ticker');

    // Empty-state placeholder is gone — its slot is taken by the chip.
    const afterEmpty = await page.evaluate(
      () => document.querySelector('.vg-row-group-panel-empty'),
    );
    expect(afterEmpty).toBeNull();
  });
});
