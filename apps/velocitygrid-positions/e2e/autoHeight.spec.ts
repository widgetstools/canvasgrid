/**
 * Cycle 5 / Task 8 — autoHeight per column.
 *
 * Demo wires the `notes` column with `autoHeight: true`; `main.ts` seeds
 * ~1 in 3 rows (positionIds whose trailing char code is divisible by 3)
 * with a long synthetic description. The worker measures wrapped-text
 * height for those cells via `OffscreenCanvas.measureText` (or the
 * main-thread fallback on Safari 15.4–16.3 / Firefox 100–104), posts
 * `heightsChanged`, main updates the Fenwick index and the affected rows
 * paint taller than the grid baseline.
 *
 * NOTE: `notes` is off-screen at default viewport widths (column
 * virtualisation drops it from the chunk), so we cannot reliably read its
 * value via `getCellValue` — predicted-long rows are derived from the same
 * positionId rule the demo uses to seed them.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getRowBoundsAt: (rowIndex: number) => { y: number; h: number } | null;
  getCellValue: (rowIndex: number, colId: string) => unknown;
}

const TASK6_OVERRIDE = 56; // explicit getRowHeight override from Cycle 5 / Task 6

/** Read the resolved grid rowHeight straight from the CSS variable the
 *  CssReader feeds back into the engine, so the test is theme-agnostic. */
async function readBaselineRowHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.getElementById('grid');
    if (!host) return 30;
    const v = parseFloat(getComputedStyle(host).getPropertyValue('--vg-row-height'));
    return Number.isFinite(v) ? v : 30;
  });
}

test.describe('autoHeight column (Cycle 5 / Task 8)', () => {
  test.beforeEach(async ({ page }) => {
    // Demo opts into autoHeight + wrapText on the notes column via
    // `?autoHeight=1` so the default demo can render uniform rows.
    // This spec MUST set the flag to exercise the worker measure pass.
    await page.goto('/?stress=light&autoHeight=1');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
    // autoHeight runs out-of-band: the first chunk lands at fallback height,
    // then `heightsChanged` settles the row tops one rAF later. Wait a few
    // animation frames so the measurement + Fenwick update + repaint have
    // landed before we sample row heights.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 12 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
  });

  test('rows that the demo seeded with long notes paint taller than baseline', async ({ page }) => {
    const baseline = await readBaselineRowHeight(page);
    const rows = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const out: { rowIndex: number; positionId: string; height: number }[] = [];
      for (let i = 0; i < 40; i++) {
        const b = grid.getRowBoundsAt(i);
        const id = grid.getCellValue(i, 'positionId');
        if (b && typeof id === 'string') {
          out.push({ rowIndex: i, positionId: id, height: b.h });
        }
      }
      return out;
    });
    // Predicted-long rows via the same rule the demo uses in main.ts —
    // `positionId.charCodeAt(last) % 3 === 0` seeds the long description.
    const predictedLong = rows.filter((r) => {
      const code = r.positionId.charCodeAt(r.positionId.length - 1);
      return code % 3 === 0 && code % 4 !== 0; // matches main.ts's disjoint rule
    });
    expect(predictedLong.length, 'demo rule should hit at least one visible row').toBeGreaterThanOrEqual(1);
    for (const r of predictedLong) {
      expect(
        r.height,
        `row ${r.rowIndex} (${r.positionId}) is autoHeight-seeded and must paint taller than baseline (${baseline})`,
      ).toBeGreaterThan(baseline);
    }
  });

  test('rows the demo did NOT seed remain at baseline or the Task 6 override', async ({ page }) => {
    const baseline = await readBaselineRowHeight(page);
    const rows = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const out: { rowIndex: number; positionId: string; height: number }[] = [];
      for (let i = 0; i < 40; i++) {
        const b = grid.getRowBoundsAt(i);
        const id = grid.getCellValue(i, 'positionId');
        if (b && typeof id === 'string') {
          out.push({ rowIndex: i, positionId: id, height: b.h });
        }
      }
      return out;
    });
    const predictedShort = rows.filter((r) => {
      const code = r.positionId.charCodeAt(r.positionId.length - 1);
      return code % 3 !== 0;
    });
    expect(predictedShort.length).toBeGreaterThanOrEqual(1);
    for (const r of predictedShort) {
      const ok = r.height === baseline || r.height === TASK6_OVERRIDE;
      expect(
        ok,
        `row ${r.rowIndex} (${r.positionId}) without an autoHeight seed should be ${baseline} or ${TASK6_OVERRIDE}, got ${r.height}`,
      ).toBe(true);
    }
  });

  test('row tops accumulate variable heights with no gap or overlap', async ({ page }) => {
    // Same invariant as the Task 6 spec, re-asserted under the autoHeight
    // load: per-row accumulator positions tall + short rows without seams.
    const bounds = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const out: { y: number; h: number }[] = [];
      for (let i = 0; i < 20; i++) {
        const b = grid.getRowBoundsAt(i);
        if (b) out.push(b);
      }
      return out;
    });
    expect(bounds.length).toBeGreaterThan(3);
    for (let i = 0; i < bounds.length - 1; i++) {
      const here = bounds[i]!;
      const next = bounds[i + 1]!;
      expect(Math.abs(here.y + here.h - next.y)).toBeLessThan(0.5);
    }
  });
});
