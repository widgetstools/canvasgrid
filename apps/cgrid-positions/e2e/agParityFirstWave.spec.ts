/**
 * AG-parity first wave (2026-07-21) — real-browser E2E.
 *
 * 1. `grandTotalRow: 'pinnedBottom'` rides the pinned totals subgrid: the
 *    grand total is NOT a body row (displayed count excludes it), unlike
 *    `'bottom'` which appends an in-scroll footer row.
 * 2. `groupDefaultExpanded` follows AG levels-open semantics: `-1` opens
 *    everything, `0` opens nothing, `1` opens the first level.
 *
 * Seeds 10 rows into 2 ticker groups (5 AAPL + 5 MSFT) like the
 * cycle15.5-task8 spec, so the count arithmetic is directly comparable:
 *   groups(2) + leaves(10) + groupFooters(2) + inScrollGrand(0|1).
 */
import { test, expect, Page } from '@playwright/test';

interface GridApiSurface {
  setRowData: (rows: unknown[]) => void;
  getDisplayedRowCount: () => number;
}

async function waitForFrames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => {
        if (++i >= count) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function mountAndSeed(page: Page, urlSuffix: string): Promise<void> {
  await page.goto(`/?grouping=ticker${urlSuffix}`);
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);

  await page.evaluate(() => {
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    const rows: Array<Record<string, unknown>> = [];
    const TICKERS = ['AAPL', 'MSFT'];
    for (let i = 0; i < 10; i++) {
      const ticker = TICKERS[Math.floor(i / 5)]!;
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        ticker,
        cusip: `CUSIP${i}`,
        side: 'BUY',
        quantity: 100 + i,
        price: 10 + a,
        notionalAmount: 1000 * (i + 1),
        sector: 'Tech',
        region: 'AMER',
        currency: 'USD',
        trader: 'T1',
        desk: 'Delta One',
      });
    }
    g.setRowData(rows);
  });
  await waitForFrames(page, 8);
}

async function displayedCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getDisplayedRowCount());
}

test.describe('grandTotalRow pinned variants', () => {
  test("'bottom' appends an in-scroll grand-total body row", async ({ page }) => {
    await mountAndSeed(page, '&groupTotalRow=bottom&grandTotalRow=bottom&groupDefaultExpanded=-1');
    // 2 groups + 10 leaves + 2 group footers + 1 in-scroll grand total.
    await expect.poll(() => displayedCount(page)).toBe(15);
  });

  test("'pinnedBottom' pins the grand total OUTSIDE the body (no extra body row)", async ({ page }) => {
    await mountAndSeed(page, '&groupTotalRow=bottom&grandTotalRow=pinnedBottom&groupDefaultExpanded=-1');
    // Same as above minus the in-scroll grand-total row.
    await expect.poll(() => displayedCount(page)).toBe(14);
  });

  test("'pinnedTop' behaves the same (count-wise) as pinnedBottom", async ({ page }) => {
    await mountAndSeed(page, '&groupTotalRow=bottom&grandTotalRow=pinnedTop&groupDefaultExpanded=-1');
    await expect.poll(() => displayedCount(page)).toBe(14);
  });
});

test.describe('groupDefaultExpanded AG levels-open semantics', () => {
  test('-1 opens everything', async ({ page }) => {
    await mountAndSeed(page, '&groupDefaultExpanded=-1');
    // 2 groups + 10 leaves.
    await expect.poll(() => displayedCount(page)).toBe(12);
  });

  test('0 opens nothing', async ({ page }) => {
    await mountAndSeed(page, '&groupDefaultExpanded=0');
    await expect.poll(() => displayedCount(page)).toBe(2);
  });

  test('1 opens the first level (single-level grouping → all leaves visible)', async ({ page }) => {
    await mountAndSeed(page, '&groupDefaultExpanded=1');
    await expect.poll(() => displayedCount(page)).toBe(12);
  });
});
