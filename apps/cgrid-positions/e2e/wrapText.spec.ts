/**
 * Cycle 5 / Task 9 — wrapText per column.
 *
 * Demo wires the `notes` column with `wrapText: true` paired with the Task 8
 * `autoHeight: true`. `propertyChain` auto-selects the `'text-wrap'`
 * painter when no explicit `cellRenderer` is set; the painter performs
 * greedy word-wrap against the cell's inner width (with last-line ellipsis
 * when the row height clips). The unit suite (`cgrid/tests/wrapText.test.ts`)
 * covers paint correctness; this E2E asserts the col-def → renderer wiring
 * lights up end-to-end by scrolling notes into view and observing that
 * paint resolved against the wrap painter — if it hadn't, the per-cell
 * `cellRenderers.get('text-wrap')` would have thrown
 * `[velocity-grid] unknown cellRenderer 'text-wrap'` and `firstDataRendered` would
 * never fire.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  ensureColumnVisible: (colId: string, position?: 'auto' | 'start' | 'middle' | 'end') => void;
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  getRowBoundsAt: (rowIndex: number) => { y: number; h: number } | null;
  getCellValue: (rowIndex: number, colId: string) => unknown;
}

async function readBaselineRowHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.getElementById('grid');
    if (!host) return 30;
    const v = parseFloat(getComputedStyle(host).getPropertyValue('--vg-row-height'));
    return Number.isFinite(v) ? v : 30;
  });
}

test.describe('wrapText column (Cycle 5 / Task 9)', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    // Demo opts into autoHeight + wrapText on the notes column via
    // `?autoHeight=1` so the default demo can render uniform rows.
    // This spec MUST set the flag to exercise the wrapText paint pass.
    await page.goto('/?stress=light&autoHeight=1');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
    // Same rAF settle as the autoHeight spec — measurement + Fenwick rebuild
    // + repaint must land before sampling.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 12 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
  });

  test('notes column paints without an unknown-renderer error', async ({ page }) => {
    // Reaching __cgridReady proves paint succeeded for every initial-visible
    // cell. If `'text-wrap'` weren't registered, the first paint of a
    // wrapText column would throw `[velocity-grid] unknown cellRenderer 'text-wrap'`
    // and the readiness flag would never flip. Belt-and-braces: also check
    // we captured no such error on the console bus.
    const wrapErrors = consoleErrors.filter((e) => e.includes('text-wrap'));
    expect(wrapErrors, JSON.stringify(wrapErrors)).toEqual([]);
  });

  test('scrolling notes into view exposes wrap-painted cells with autoHeight bounds', async ({ page }) => {
    const baseline = await readBaselineRowHeight(page);

    // Scroll the notes column into view so its cells enter the visible-cols
    // window and the wrap painter actually runs for them.
    await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      grid.ensureColumnVisible('notes', 'end');
    });
    // One repaint settle after the scroll.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const sample = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      const out: { rowIndex: number; positionId: string; hasBounds: boolean; rowH: number }[] = [];
      for (let i = 0; i < 30; i++) {
        const id = grid.getCellValue(i, 'positionId');
        const cell = grid.getCellBoundsAt(i, 'notes');
        const row = grid.getRowBoundsAt(i);
        if (typeof id === 'string' && row) {
          out.push({ rowIndex: i, positionId: id, hasBounds: cell !== null, rowH: row.h });
        }
      }
      return out;
    });

    // After ensureColumnVisible('notes'), at least one row's notes cell
    // resolves bounds — the wrap painter has run for it.
    const visibleNotes = sample.filter((r) => r.hasBounds);
    expect(visibleNotes.length, 'notes column should be in view after ensureColumnVisible').toBeGreaterThan(0);

    // Among those rows, ones the demo seeded with a long synthetic note —
    // disjoint with the Task 6 override rule, so we filter the same way the
    // demo's `autoHeightDescription` does in main.ts.
    const longRows = visibleNotes.filter((r) => {
      const code = r.positionId.charCodeAt(r.positionId.length - 1);
      return code % 3 === 0 && code % 4 !== 0;
    });
    if (longRows.length > 0) {
      // For at least one such row, the autoHeight + wrap pipeline produced a
      // taller-than-baseline row — proof the worker measured the same wrap
      // result the painter is drawing.
      const someTaller = longRows.some((r) => r.rowH > baseline);
      expect(someTaller,
        `at least one long-notes row should be taller than baseline (${baseline}); got ${JSON.stringify(longRows)}`)
        .toBe(true);
    }
  });
});
