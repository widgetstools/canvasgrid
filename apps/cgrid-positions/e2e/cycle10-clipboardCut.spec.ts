/**
 * Cycle 10 / Task 5 — clipboard cut (Ctrl+X + copy + clear via applyTransaction).
 *
 * Cut = copy + clear. Two assertions per scenario:
 *  - the system clipboard now holds the TSV the matching Copy would emit, AND
 *  - the source cells under the range are now blank.
 *
 * Plus a callback assertion: when `processCellForClipboard` /
 * `processCellFromClipboard` are configured, the per-cell transforms
 * fire and shape the clipboard payload + paste write respectively.
 *
 * Same browser-permission story as Copy / Paste — the BrowserContext
 * needs `clipboard-read` AND `clipboard-write`, granted explicitly per
 * spec so headless Chromium doesn't fall through to the prompt API.
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
  ensureColumnVisible: (colId: string, position?: 'auto' | 'start' | 'middle' | 'end') => void;
  stopEditing: (cancel?: boolean) => void;
  copySelectedRangesToClipboard: () => Promise<void>;
  pasteFromClipboard: () => Promise<void>;
  cutSelectedRanges: () => Promise<void>;
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

/** Anchor the focused cell at (rowIndex, colId) via a real click. Mirrors
 *  `cycle10-clipboardPaste.spec.ts`'s helper — needed so the post-cut
 *  paste leg can re-paste through the focused cell. */
async function anchorFocus(page: Page, rowIndex: number, colId: string): Promise<void> {
  await page.evaluate(
    (id) => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.ensureColumnVisible(id, 'start'),
    colId,
  );
  await waitForFrames(page, 4);
  const bounds = await page.evaluate(
    ({ rowIndex, colId }) => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellBoundsAt(rowIndex, colId),
    { rowIndex, colId },
  );
  if (!bounds) throw new Error(`anchorFocus: no bounds for row=${rowIndex} col=${colId}`);
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  if (!canvas) throw new Error('anchorFocus: canvas not found');
  const cx = canvas.x + bounds.x + bounds.w / 2;
  const cy = canvas.y + bounds.y + bounds.h / 2;
  await page.mouse.click(cx, cy);
  await waitForFrames(page, 4);
  await page.evaluate(() => {
    const w = window as unknown as { __velocity-grid: GridSurface };
    w.__cgrid.stopEditing(true);
  });
  await waitForFrames(page, 2);
}

test.describe('Cycle 10 / Task 5 — clipboard cut', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('cutSelectedRanges writes the TSV to the clipboard AND blanks the source cells', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);

    // notes is a string-typed editable column in the demo. Picking a
    // 2×1 range over notes keeps the round-trip lossless (assigning ''
    // and reading back stays a string).
    await seedRange(page, { rowStart: 0, rowEnd: 1, colIds: ['notes'] });

    const beforeRow0 = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(0, 'notes'),
    );
    const beforeRow1 = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(1, 'notes'),
    );
    const expectedTsv = `${String(beforeRow0 ?? '')}\n${String(beforeRow1 ?? '')}`;

    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.cutSelectedRanges(),
    );
    // Clipboard leg lands first; assert that early so a clear-update
    // hiccup is diagnosable.
    await expect.poll(
      async () => page.evaluate(() => navigator.clipboard.readText()),
      { timeout: 5_000 },
    ).toBe(expectedTsv);

    // Clear leg — applyTransaction is async on the worker; poll until
    // the cells flip.
    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(0, 'notes'),
      ),
      { timeout: 5_000 },
    ).toBe('');
    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(1, 'notes'),
      ),
      { timeout: 5_000 },
    ).toBe('');
  });

  test('Ctrl+X keypath: pressing Control+X on the canvas cuts', async ({ page, browserName }) => {
    await gridReady(page);
    await focusCanvas(page);

    // Range of one cell over the notes column; the Ctrl+X keydown should
    // route through KeyboardShortcuts → cutSelectedRanges.
    await seedRange(page, { rowStart: 4, rowEnd: 4, colIds: ['notes'] });

    const before = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(4, 'notes'),
    );

    const mod = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.down(mod);
    await page.keyboard.press('KeyX');
    await page.keyboard.up(mod);

    // Clipboard write happens inside the keydown gesture; the clear-
    // applyTransaction follows. Poll for both.
    await expect.poll(
      async () => page.evaluate(() => navigator.clipboard.readText()),
      { timeout: 5_000 },
    ).toBe(String(before ?? ''));
    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(4, 'notes'),
      ),
      { timeout: 5_000 },
    ).toBe('');
  });

  test('processCellForClipboard transforms each copied cell value', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);

    // Install a synthetic transform that wraps each value in <…>.
    await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      g.setGridOption('processCellForClipboard', (params: { value: unknown }) => `<${String(params.value ?? '')}>`);
    });

    await seedRange(page, { rowStart: 7, rowEnd: 7, colIds: ['notes'] });
    const raw = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(7, 'notes'),
    );

    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.copySelectedRangesToClipboard(),
    );

    const tsv = await page.evaluate(() => navigator.clipboard.readText());
    expect(tsv).toBe(`<${String(raw ?? '')}>`);

    // Restore the default so subsequent tests share a clean baseline.
    await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      g.setGridOption('processCellForClipboard', undefined);
    });
  });

  test('processCellFromClipboard transforms each pasted string before write', async ({ page }) => {
    await gridReady(page);
    await anchorFocus(page, 9, 'notes');

    // Install a synthetic transform that prefixes each pasted value
    // with PARSED:. The clipboard payload is a single string; the
    // transform receives the parsed `value` per cell.
    await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      g.setGridOption(
        'processCellFromClipboard',
        (params: { value: string }) => `PARSED:${params.value}`,
      );
    });

    await page.evaluate(() => navigator.clipboard.writeText('raw-payload'));
    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.pasteFromClipboard(),
    );

    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(9, 'notes'),
      ),
      { timeout: 5_000 },
    ).toBe('PARSED:raw-payload');

    await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      g.setGridOption('processCellFromClipboard', undefined);
    });
  });

  test('no range selected → cutSelectedRanges rejects with no-ranges (silent on the menu surface)', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);
    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.clearCellRanges(),
    );

    const rejected = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.cutSelectedRanges()
        .then(() => null, (err: Error) => err.message),
    );
    expect(rejected).toBe('no-ranges');
  });
});
