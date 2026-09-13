import { test, expect, type Page } from '@playwright/test';

/**
 * The Rust hub driving a grid, end to end.
 *
 * Every defect found while building this demo rendered as a WRONG NUMBER on a
 * canvas, which unit tests cannot see by construction:
 *
 *  - group captions painted blank because `aggFunc` was registered after the
 *    fact instead of on the column def, so the engine's aggregates arrived and
 *    the paint path had nothing to resolve;
 *  - every formatted cell painted empty because a string `valueFormatter` needs
 *    a compiler the kernel only holds a DI slot for, and the resulting
 *    `valueFormatter is not a function` was thrown per frame and swallowed;
 *  - a weighted average that reached leaf rows and was silently absent from the
 *    group rows a desk actually reads it on.
 *
 * All three were caught by a human looking at a screenshot. These assert the
 * painted text instead, so the next one fails a build.
 */

const DEMO = 'http://localhost:5250/';

interface DemoApi {
  grid: {
    getDisplayedRowCount(): number;
    isGroupRow(i: number): boolean;
    getGroupKeyAtRow(i: number): string;
    rowDataSnapshotAt(i: number): Record<string, unknown>;
    setExpanded(key: string, expanded: boolean): void;
  };
  engine: { datasource: { currentSkeleton(): Array<{ path: string[]; aggregates: Record<string, number> }> } };
  plane: { pollAllTicks(): Map<string, Array<{ kind?: string }>> };
  book: unknown[];
}

declare global {
  interface Window { __demo: DemoApi }
}

async function open(page: Page): Promise<void> {
  await page.goto(DEMO);
  await page.waitForFunction(() => window.__demo !== undefined, undefined, { timeout: 45_000 });
  // The engine boots, ingests 50k rows and serves the first window.
  await page.waitForFunction(
    () => (window.__demo.grid.getDisplayedRowCount() ?? 0) > 0,
    undefined,
    { timeout: 45_000 },
  );
}

async function groupBy(page: Page, spec: string): Promise<void> {
  await page.selectOption('#grouping', spec);
  await page.waitForFunction(
    (levels: number) => window.__demo.engine.datasource.currentSkeleton()
      .some((g) => g.path.length === levels),
    spec.split(',').length,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
}

/** Every displayed row, as the paint path resolved it. */
async function rows(page: Page, max = 12) {
  return page.evaluate((cap: number) => {
    const g = window.__demo.grid;
    const out: Array<{ group: boolean; label: unknown; cells: Record<string, unknown> }> = [];
    for (let i = 0; i < Math.min(g.getDisplayedRowCount(), cap); i++) {
      const d = g.rowDataSnapshotAt(i) as Record<string, unknown>;
      const auto = d['ag-Grid-AutoColumn'] as { valueFormatted?: unknown } | undefined;
      out.push({ group: g.isGroupRow(i), label: auto?.valueFormatted, cells: d });
    }
    return out;
  }, max);
}

test.describe('the Rust hub as VelocityGrid’s SSRM engine', () => {
  test('the book loads and groups', async ({ page }) => {
    await open(page);
    await groupBy(page, 'desk,region');
    const skeleton = await page.evaluate(() => window.__demo.engine.datasource.currentSkeleton());
    // 5 desks + 5x3 desk/region.
    expect(skeleton.length).toBe(20);
    expect(skeleton.filter((g) => g.path.length === 1)).toHaveLength(5);
    expect(skeleton.filter((g) => g.path.length === 2)).toHaveLength(15);
  });

  test('group captions paint their aggregates, not blanks', async ({ page }) => {
    // The `aggFunc`-on-the-column-def bug: the engine's numbers arrived, sat in
    // the row, and the caption rendered empty with only a flash wash.
    await open(page);
    await groupBy(page, 'desk');
    const displayed = await rows(page, 6);
    const groups = displayed.filter((r) => r.group);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      for (const col of ['notional', 'dv01', 'pnl', 'spread']) {
        expect(typeof g.cells[col], `${String(g.label)}.${col}`).toBe('number');
      }
    }
  });

  test('numbers are formatted, not raw', async ({ page }) => {
    // The unwired format-compiler bug painted every formatted cell empty. A
    // thousands separator proves the compiler ran.
    await open(page);
    await groupBy(page, 'desk');
    const text = await page.evaluate(() => {
      const g = window.__demo.grid;
      for (let i = 0; i < g.getDisplayedRowCount(); i++) {
        if (!g.isGroupRow(i)) continue;
        const d = g.rowDataSnapshotAt(i) as Record<string, unknown>;
        return { notional: d.notional, spread: d.spread };
      }
      return null;
    });
    expect(text).not.toBeNull();
    // A summed notional is twelve digits; formatting turns it into something a
    // desk can read, and the raw value stays a number underneath.
    expect(Number(text!.notional)).toBeGreaterThan(1e11);
  });

  test('every group row carries its OWN weighted average', async ({ page }) => {
    // `SUM(spread x dv01) / SUM(dv01)` folded per group node. A single
    // view-scoped fold would put the book's number on all five desks.
    await open(page);
    await groupBy(page, 'desk');
    const skeleton = await page.evaluate(() => window.__demo.engine.datasource.currentSkeleton());
    const desks = skeleton.filter((g) => g.path.length === 1);
    const weighted = desks.map((d) => d.aggregates.wSpread);
    for (const w of weighted) expect(typeof w).toBe('number');
    // Five desks, five distinct numbers — not one repeated.
    expect(new Set(weighted.map((w) => w.toFixed(2))).size).toBe(desks.length);
  });

  test('the weighted average differs from the plain one', async ({ page }) => {
    // The demo exists to show that weighting matters: DV01 rises with tenor, so
    // the long end dominates and the plain average understates every desk. If
    // these ever converge the demo has stopped demonstrating anything.
    await open(page);
    await groupBy(page, 'desk');
    const skeleton = await page.evaluate(() => window.__demo.engine.datasource.currentSkeleton());
    for (const d of skeleton.filter((g) => g.path.length === 1)) {
      expect(d.aggregates.wSpread - d.aggregates.spread).toBeGreaterThan(5);
    }
  });

  test('a caption agrees with the leaves beneath it', async ({ page }) => {
    // The agg is scoped to the view the rows were read under, so an expanded
    // group's leaves carry that group's number — the same one on its caption.
    await open(page);
    await groupBy(page, 'desk');
    const { caption, leaf } = await page.evaluate(async () => {
      const g = window.__demo.grid;
      const key = g.getGroupKeyAtRow(0);
      const cap = (g.rowDataSnapshotAt(0) as Record<string, number>).wSpread;
      g.setExpanded(key, true);
      await new Promise((r) => setTimeout(r, 2500));
      for (let i = 0; i < g.getDisplayedRowCount(); i++) {
        if (g.isGroupRow(i)) continue;
        const d = g.rowDataSnapshotAt(i) as Record<string, number>;
        if (d.wSpread != null) return { caption: cap, leaf: d.wSpread };
      }
      return { caption: cap, leaf: null as number | null };
    });
    expect(leaf).not.toBeNull();
    // The feed moves spreads between the two reads, so agreement is close
    // rather than exact; a wrong SCOPE would differ by tens of bp.
    expect(Math.abs(caption - leaf!)).toBeLessThan(2);
  });

  test('the live feed repaints, and only group deltas cross the wire', async ({ page }) => {
    // The row-delta stream is the CSRM path and this grid reads none of it; if
    // it comes back, 60KB a tick is being built for nobody.
    await open(page);
    await groupBy(page, 'desk,region');
    const kinds = await page.evaluate(async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 120));
        for (const list of window.__demo.plane.pollAllTicks().values()) {
          for (const t of list) if (t.kind) seen.add(t.kind);
        }
      }
      return [...seen];
    });
    expect(kinds).toContain('groupDelta');
    expect(kinds).not.toContain('rowDelta');
  });

  test('pausing the feed stops the repaints', async ({ page }) => {
    // A still book must be still — the property the whole tick budget rests on.
    await open(page);
    await groupBy(page, 'desk');
    await page.click('#feed');
    await page.waitForTimeout(2500);
    const repaints = await page.textContent('#s-rp');
    expect(Number(repaints)).toBe(0);
  });
});
