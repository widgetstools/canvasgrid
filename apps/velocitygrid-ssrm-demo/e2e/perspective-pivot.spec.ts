import { test, expect, type Page } from '@playwright/test';

/**
 * Sparse-SSRM pivot end to end, against real Perspective WASM.
 *
 * The unit tests prove the mapper agrees with PivotPass and that the kernel
 * stamps a pushed matrix onto the chunk. This proves the whole chain runs:
 * grid pivot state → provider → Perspective `split_by` → mapper →
 * setServerSidePivotResult → worker → chunk → synthesized columns → painted
 * cells — and, critically, WITHOUT falling back to a full hydrate.
 */

/** Synthesized pivot result columns are prefixed `pivotcol`. */
const PIVOT_COL_PREFIX = 'pivotcol';

async function boot(page: Page): Promise<void> {
  await page.goto('/simple.html?feed=seed&worker=dedicated');
  await page.waitForFunction(() => (window as any).__simple !== undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    await (window as any).__simple.waitForRows(10, 30_000);
  });
}

/** Group by desk, then pivot region over the pnl measure. */
async function enterPivot(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { grid } = (window as any).__simple;
    grid.setRowGroupColumns(['desk']);
    await new Promise((r) => setTimeout(r, 1500));
    grid.setPivotColumns(['region']);
    grid.addValueColumn('pnl', 'sum');
    grid.setPivotMode(true);
    await new Promise((r) => setTimeout(r, 3000));
  });
}

async function pivotColumnIds(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate((p: string) => {
    const g = (window as any).__simple.grid as any;
    // Synthesized pivot leaves live in the rendered column order;
    // getColumnState() deliberately returns PRIMARY columns only.
    return (g.columnOrder ?? [])
      .map((c: any) => c.colId)
      .filter((id: string) => typeof id === 'string' && id.startsWith(p));
  }, prefix);
}

test.describe('sparse SSRM pivot via Perspective split_by', () => {
  test('dimensions are pivotable, so Column Labels accepts them', async ({ page }) => {
    // Regression guard. The other specs call setPivotColumns() directly,
    // which bypasses `enablePivot` — so they all passed while the Columns
    // panel's Column Labels zone silently rejected every drag (no column
    // declared enablePivot). Pivot mode then hid the primaries with no
    // pivot columns to replace them, and the grid showed only the group
    // column. Assert the gate the UI actually consults.
    await boot(page);
    const pivotable = await page.evaluate(() => {
      const g = (window as any).__simple.grid as any;
      return (g.getColumnState() ?? [])
        .map((c: any) => c.colId)
        .filter((id: string) => g.isColumnPivotEnabled?.(id) === true);
    });
    expect(pivotable).toEqual(
      expect.arrayContaining(['desk', 'region', 'ticker', 'instrumentType']),
    );
  });

  test('pivot engages WITHOUT falling back to a full hydrate', async ({ page }) => {
    await boot(page);
    await enterPivot(page);

    const state = await page.evaluate(() => {
      const g = (window as any).__simple.grid as any;
      return { pivotMode: g.isPivotMode(), clientPipeline: g.ssrmClientPipeline === true };
    });
    expect(state.pivotMode).toBe(true);
    // The whole point: Perspective computed the cross-tab, so the kernel
    // never downloaded the book to run its own PivotPass.
    expect(state.clientPipeline).toBe(false);
  });

  test('synthesizes pivot result columns and paints values in them', async ({ page }) => {
    await boot(page);
    await enterPivot(page);

    const cols = await pivotColumnIds(page, PIVOT_COL_PREFIX);
    // The seed book spans several regions — each becomes a pivot column.
    expect(cols.length).toBeGreaterThan(0);

    const painted = await page.evaluate((ids: string[]) => {
      const g = (window as any).__simple.grid as any;
      let found = 0;
      for (let row = 0; row < 12; row++) {
        for (const colId of ids) {
          const v = g.getCellValue?.(row, colId);
          if (typeof v === 'number' && Number.isFinite(v) && v !== 0) found++;
        }
      }
      return found;
    }, cols);
    // Values only paint on group rows, which is where a pivot shows them.
    expect(painted).toBeGreaterThan(0);
  });

  test('turning pivot off restores the primary columns', async ({ page }) => {
    await boot(page);
    await enterPivot(page);
    expect((await pivotColumnIds(page, PIVOT_COL_PREFIX)).length).toBeGreaterThan(0);

    await page.evaluate(async () => {
      const g = (window as any).__simple.grid as any;
      g.setPivotMode(false);
      await new Promise((r) => setTimeout(r, 2000));
    });

    expect(await pivotColumnIds(page, PIVOT_COL_PREFIX)).toEqual([]);
    const after = await page.evaluate(() => {
      const g = (window as any).__simple.grid as any;
      return { pivotMode: g.isPivotMode(), rows: g.getDisplayedRowCount?.() ?? 0 };
    });
    expect(after.pivotMode).toBe(false);
    expect(after.rows).toBeGreaterThan(0);
  });
});

test('sorting by a pivot column header does not kill the Perspective engine', async ({ page }) => {
  // A pivot result column id (pivotcol\x01EMEA\x01marketValue) exists only in
  // the kernel. Forwarding it into Perspective's view sort aborted WASM
  // ("Invalid column ... found in View sorts" → "null pointer passed to
  // rust") and the live feed died for the whole page: the grid froze
  // permanently on the first click of a pivot header.
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await boot(page);
  await enterPivot(page);

  const cols = await pivotColumnIds(page, PIVOT_COL_PREFIX);
  expect(cols.length).toBeGreaterThan(0);

  const box = await page.evaluate((colId: string) => {
    const g = (window as any).__simple.grid as any;
    const b = g.getHeaderBoundsAt?.(colId);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    return b ? { x: r.x + b.x + b.w / 2, y: r.y + b.y + b.h / 2 } : null;
  }, cols[0]!);
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x, box!.y);
  await page.waitForTimeout(5000);

  const health = await page.evaluate(() => {
    const t = (window as any).__simple.provider.book.getTelemetry();
    return { phase: t.phase, live: t.liveUpdatesPerSec };
  });
  expect(pageErrors).toEqual([]);
  expect(health.phase).toBe('live');
  expect(health.live).toBeGreaterThan(0);
});
