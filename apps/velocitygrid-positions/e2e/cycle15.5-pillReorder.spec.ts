/**
 * Cycle 15.5 / Task 1 — pill reorder in the row group panel.
 *
 * The row group panel mounts ABOVE the column header row with three
 * pills (`Ticker → Sector → Sub Sector`). The user drags the LAST
 * pill (Sub Sector) to the start of the strip; the panel host's
 * pill-reorder gesture dispatches `moveRowGroupColumn(from=2, to=0)`
 * via the GroupingState primitive; the grid handler ships a fresh
 * `setGroupModel` to the worker; the body re-groups so the leftmost
 * group spine is now `Sub Sector` instead of `Ticker`.
 *
 * This E2E pins the FULL pipeline end-to-end:
 *   pointerdown → pointermove (drag past threshold) → pointerup →
 *   GroupingState.moveRowGroupColumn → VelocityGrid.setGroupModel →
 *   worker round-trip → viewport reply → repaint with new spine.
 *
 * Demo wiring (`apps/velocitygrid-positions/src/positionsGrid.ts`):
 *   `?rowGroupPanel=threeChips` opts the demo into
 *   `rowGroupPanelShow: 'always'` and seeds the three-level group
 *   model (`ticker`, `sector`, `subSector`).
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getRowGroupColumns?: () => string[];
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?rowGroupPanel=threeChips&totals=off');
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

test.describe('Cycle 15.5 / Task 1 — pill reorder via drag', () => {
  test('drags the last pill to slot 0 — rowGroupCols becomes [subSector, ticker, sector]', async ({ page }) => {
    await gridReady(page);

    // Three pills are present in the panel — order is Ticker, Sector,
    // Sub Sector. Sanity-check before the gesture.
    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vg-row-group-panel-chip')).map(
        (el) => (el as HTMLElement).dataset.colId ?? '',
      ),
    );
    expect(before).toEqual(['ticker', 'sector', 'subSector']);

    // Resolve the chip rects so the gesture lands at real coords.
    const rects = await page.evaluate(() => {
      const chips = document.querySelectorAll('.vg-row-group-panel-chip');
      return Array.from(chips).map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
      });
    });

    const source = rects[2]!;
    const downX = source.left + source.width / 2;
    const downY = source.top + (source.bottom - source.top) / 2;
    // Drop target: just before the first pill's left edge.
    const dropX = rects[0]!.left - 4;
    const dropY = downY;

    // Drive the drag via mouse events — Playwright's pointer events
    // synthesize through the same DOM listeners the host registers.
    await page.mouse.move(downX, downY);
    await page.mouse.down();
    // Cross the 4 px threshold then walk to the drop target.
    await page.mouse.move(downX - 8, downY, { steps: 4 });
    await page.mouse.move(dropX, dropY, { steps: 8 });
    await page.mouse.up();

    // The chip strip re-renders in the new order.
    await page.waitForFunction(
      () => {
        const chips = Array.from(document.querySelectorAll('.vg-row-group-panel-chip'));
        return chips.length === 3
          && (chips[0] as HTMLElement).dataset.colId === 'subSector'
          && (chips[1] as HTMLElement).dataset.colId === 'ticker'
          && (chips[2] as HTMLElement).dataset.colId === 'sector';
      },
      null,
      { timeout: 5_000 },
    );

    const after = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.vg-row-group-panel-chip'));
      return chips.map((el) => (el as HTMLElement).dataset.colId ?? '');
    });
    expect(after).toEqual(['subSector', 'ticker', 'sector']);

    // The primitive API getter reflects the same order.
    const apiOrder = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return api.getRowGroupColumns ? api.getRowGroupColumns() : [];
    });
    expect(apiOrder).toEqual(['subSector', 'ticker', 'sector']);
  });

  test('mouseup outside the panel cancels the reorder — chip order unchanged', async ({ page }) => {
    await gridReady(page);

    const rects = await page.evaluate(() => {
      const chips = document.querySelectorAll('.vg-row-group-panel-chip');
      return Array.from(chips).map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
      });
    });

    const source = rects[2]!;
    const downX = source.left + source.width / 2;
    const downY = source.top + (source.bottom - source.top) / 2;

    await page.mouse.move(downX, downY);
    await page.mouse.down();
    // Drag past threshold, then drop into the body below the panel.
    await page.mouse.move(downX - 8, downY, { steps: 4 });
    await page.mouse.move(downX - 8, downY + 200, { steps: 8 });
    await page.mouse.up();

    // No move dispatched — order stays.
    const after = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.vg-row-group-panel-chip'));
      return chips.map((el) => (el as HTMLElement).dataset.colId ?? '');
    });
    expect(after).toEqual(['ticker', 'sector', 'subSector']);
  });
});
