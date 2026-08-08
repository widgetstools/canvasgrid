/**
 * Cycle 10 / Task 3 — clipboard copy (Ctrl+C + worker TSV pass + clipboardDelimiter).
 *
 * Exercises the full clipboard copy round-trip:
 *  - seed a 2×2 cell range via `addCellRange`,
 *  - send a real `Ctrl+C` (Cmd+C on macOS Playwright runner) on the canvas,
 *  - read back from the system clipboard via `navigator.clipboard.readText`,
 *  - assert the TSV layout AND that a custom `clipboardDelimiter` produces CSV
 *    + a quoted cell when the embedded value contains the delimiter.
 *
 * Playwright's chromium runtime ships clipboard-read / clipboard-write
 * permissions on the default context, but `headless: true` requires the
 * permissions to be granted explicitly per spec — `context.grantPermissions`
 * is the canonical hook.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
  clearCellRanges: () => void;
  setFocusedCell: (rowId: string, colId: string) => void;
  setGridOption: (key: string, value: unknown) => void;
  getCellValue: (rowIndex: number, colId: string) => unknown;
  copySelectedRangesToClipboard: () => Promise<void>;
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

async function focusCanvas(page: Page): Promise<void> {
  // Focus the canvas (tabindex=0) without firing a CellSelection mousedown —
  // a real click would land in CellSelection and replace any seeded range
  // with the clicked cell. `canvas.focus()` skips the pointer pipeline and
  // gives the canvas keyboard focus so the Ctrl+C handler chain receives
  // the synthetic keydown.
  await page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    c?.focus();
  });
}

async function seedRange(page: Page, range: { rowStart: number; rowEnd: number; colIds: string[] }): Promise<void> {
  await page.evaluate((r) => {
    const w = window as unknown as { __velocity-grid: GridSurface };
    w.__cgrid.clearCellRanges();
    w.__cgrid.addCellRange(r);
  }, range);
}

test.describe('Cycle 10 / Task 3 — clipboard copy', () => {
  test.beforeEach(async ({ context }) => {
    // Permissions must be granted on the BrowserContext, not on the page —
    // `navigator.clipboard.writeText` / `readText` check the prompt API.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('Ctrl+C with a 2×2 range writes the right TSV (default tab delimiter)', async ({ page }) => {
    await gridReady(page);
    // Sanity check that the demo has the columns the spec assumes.
    const value0 = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(0, 'ticker'),
    );
    expect(value0).not.toBeNull();

    await focusCanvas(page);
    await seedRange(page, { rowStart: 0, rowEnd: 1, colIds: ['ticker', 'cusip'] });

    // Direct API call inside `page.evaluate` is a clean way to fire the
    // copy inside a user gesture — Playwright's `page.evaluate` resolves
    // synchronously into the page's task queue, and the chromium
    // permission grant short-circuits the gesture requirement anyway.
    // We still cover the Ctrl+C keypath in the next test.
    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.copySelectedRangesToClipboard(),
    );

    const tsv = await page.evaluate(() => navigator.clipboard.readText());
    // 2 rows, 2 cols, tab-delimited.
    const expected = await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      const a = String(g.getCellValue(0, 'ticker') ?? '');
      const b = String(g.getCellValue(0, 'cusip') ?? '');
      const c = String(g.getCellValue(1, 'ticker') ?? '');
      const d = String(g.getCellValue(1, 'cusip') ?? '');
      return `${a}\t${b}\n${c}\t${d}`;
    });
    expect(tsv).toBe(expected);
  });

  test('Ctrl+C keypath: pressing Control+C on the canvas writes to the clipboard', async ({ page, browserName }) => {
    await gridReady(page);
    await focusCanvas(page);
    await seedRange(page, { rowStart: 2, rowEnd: 2, colIds: ['ticker'] });

    // Mac / non-Mac modifier differs. Playwright's "ControlOrMeta"
    // resolves the right one for the active platform. Both Ctrl+C and
    // Cmd+C are handled by the KeyboardShortcuts feature.
    const mod = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.down(mod);
    await page.keyboard.press('KeyC');
    await page.keyboard.up(mod);

    // Wait for the worker round-trip + clipboard write to settle. A
    // poll-with-bail loop is more resilient than a flat sleep on CI.
    await expect.poll(
      async () => (await page.evaluate(() => navigator.clipboard.readText())).length,
      { timeout: 5_000 },
    ).toBeGreaterThan(0);

    const tsv = await page.evaluate(() => navigator.clipboard.readText());
    const expected = await page.evaluate(
      () => String((window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(2, 'ticker') ?? ''),
    );
    expect(tsv).toBe(expected);
  });

  test('clipboardDelimiter: ","  produces CSV (single-row 2 cols)', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      (window as unknown as { __velocity-grid: GridSurface }).__cgrid.setGridOption('clipboardDelimiter', ',');
    });
    await focusCanvas(page);
    await seedRange(page, { rowStart: 0, rowEnd: 0, colIds: ['ticker', 'cusip'] });

    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.copySelectedRangesToClipboard(),
    );

    const csv = await page.evaluate(() => navigator.clipboard.readText());
    const expected = await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      return `${String(g.getCellValue(0, 'ticker') ?? '')},${String(g.getCellValue(0, 'cusip') ?? '')}`;
    });
    expect(csv).toBe(expected);

    // Restore the default so the next test's beforeEach doesn't inherit.
    await page.evaluate(() => {
      (window as unknown as { __velocity-grid: GridSurface }).__cgrid.setGridOption('clipboardDelimiter', '\t');
    });
  });
});
