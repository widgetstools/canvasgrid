/**
 * Regression — a drag that auto-scrolls past the visible viewport MUST
 * extend the range to include the newly-revealed rows. Before the fix,
 * the auto-scroll moved the viewport but `setRanges` fired
 * `selection.onChange`, which triggered `ensureRowIndexVisible` on the
 * unchanged focused (anchor) row, scrolling the viewport right back. Net
 * scroll = 0, range frozen at the anchor row.
 *
 * Two assertions:
 * 1. After ~1.5 s of drag past the bottom edge, the viewport has
 *    scrolled at least 50 rows AND the range spans many more rows than
 *    the visible window (so Copy serialises rows that were never on
 *    screen).
 * 2. The worker's `clipboardSerialize` returns the same number of TSV
 *    lines as the range row span — proves Copy reads every row in the
 *    range, not just the visible subset.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  selection: { state: { ranges: SelectionRange[] } };
  viewport: { visibleRows: Array<{ subgrid: { isData: boolean }; localRowIndex: number }> };
  scrollTop: number;
  workerClient: {
    clipboardSerialize: (ranges: SelectionRange[], delimiter: string) => Promise<string>;
  };
  clearCellRanges: () => void;
  addCellRange: (range: SelectionRange) => void;
}

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

test.describe('range drag extends across viewports (auto-scroll cooperates with setRanges)', () => {
  test('drag past bottom edge for 1.5 s scrolls viewport AND extends range across rows that were never visible', async ({ page }) => {
    await gridReady(page);

    const result = await page.evaluate(async () => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      const canvas = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const r = canvas.getBoundingClientRect();
      const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

      // Anchor at row 2 (well inside the visible window).
      const a = g.getCellBoundsAt(2, 'currentPrice')!;
      const ax = r.left + a.x + a.w / 2;
      const ay = r.top + a.y + a.h / 2;

      const visibleBefore = g.viewport.visibleRows
        .filter((v) => v.subgrid.isData).map((v) => v.localRowIndex);
      const scrollBefore = g.scrollTop;

      // mousedown at anchor
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: ax, clientY: ay, button: 0,
      }));
      await sleep(20);

      // mousemove past bottom edge — triggers auto-scroll loop
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: ax, clientY: r.bottom + 50, button: 0,
      }));
      await sleep(1500);

      const visibleAfter = g.viewport.visibleRows
        .filter((v) => v.subgrid.isData).map((v) => v.localRowIndex);
      const scrollAfter = g.scrollTop;
      const range = JSON.parse(JSON.stringify(g.selection.state.ranges[0]));

      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, clientX: ax, clientY: r.bottom + 50, button: 0,
      }));

      return {
        scrollBefore,
        scrollAfter,
        topRowBefore: visibleBefore[0],
        topRowAfter: visibleAfter[0],
        bottomRowAfter: visibleAfter[visibleAfter.length - 1],
        range,
      };
    });

    // Auto-scroll moved the viewport significantly (at least 50 rows).
    expect(result.scrollAfter).toBeGreaterThan(result.scrollBefore + 50 * 16);
    expect(result.topRowAfter).toBeGreaterThan(result.topRowBefore + 50);
    // Range extended to a row beyond the original viewport bottom.
    expect(result.range.rowStart).toBe(2);
    expect(result.range.rowEnd).toBeGreaterThan(50);
    // And specifically the range covers MANY more rows than the visible window.
    const visibleSpan = result.bottomRowAfter - result.topRowAfter + 1;
    const rangeSpan = result.range.rowEnd - result.range.rowStart + 1;
    expect(rangeSpan).toBeGreaterThan(visibleSpan * 2);
  });

  test('worker clipboardSerialize over a multi-viewport range returns every row in the range', async ({ page }) => {
    await gridReady(page);
    // Seed a 30-row × 2-col range via the API (no drag flake).
    const out = await page.evaluate(async () => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.clearCellRanges();
      g.addCellRange({ rowStart: 5, rowEnd: 34, colIds: ['ticker', 'currentPrice'] });
      await new Promise((r) => setTimeout(r, 50));
      const tsv = await g.workerClient.clipboardSerialize(
        [{ rowStart: 5, rowEnd: 34, colIds: ['ticker', 'currentPrice'] }],
        '\t',
      );
      const lines = tsv.split('\n');
      return { numLines: lines.length, firstLine: lines[0], lastLine: lines[lines.length - 1] };
    });
    // 30 rows in the range → 30 lines in the TSV.
    expect(out.numLines).toBe(30);
    // Each line is `<ticker>\t<currentPrice>` — both non-empty.
    expect(out.firstLine).toMatch(/^\S+\t\S+$/);
    expect(out.lastLine).toMatch(/^\S+\t\S+$/);
  });
});
