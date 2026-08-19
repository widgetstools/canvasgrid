/**
 * Cycle 10 / Task 4 — clipboard paste (Ctrl+V + worker TSV parse + applyTransaction).
 *
 * Exercises the full paste round-trip:
 *  - seed the system clipboard via `navigator.clipboard.writeText`,
 *  - anchor focus at a target cell by firing a real click (CellSelection
 *    sets `focusedRowIndex` + `focusedColId` from the hit),
 *  - call `pasteFromClipboard()` (or dispatch Ctrl+V) on the canvas,
 *  - assert the cells under the anchor pick up the pasted values.
 *
 * The paste lands a 2D parsed grid at the focused cell, walking the
 * visible column order rightward. The demo's visible-leaf order at
 * the body section is:
 *   [tradeDate, expiryDate, notes, confirmed]
 * which are all string-typed editable columns — picking those keeps
 * the value round-trip lossless (numeric-typed columns would coerce
 * the pasted string to NaN and read back as `null`).
 *
 * Permissions: the BrowserContext needs `clipboard-read` AND
 * `clipboard-write`. `headless: true` ignores the prompt unless they're
 * granted explicitly per-spec via `context.grantPermissions`.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  clearCellRanges: () => void;
  addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
  setFocusedCell: (rowId: string, colId: string) => void;
  setGridOption: (key: string, value: unknown) => void;
  getCellValue: (rowIndex: number, colId: string) => unknown;
  getFocusedCell: () => { rowId: string; colId: string } | null;
  ensureColumnVisible: (colId: string, position?: 'auto' | 'start' | 'middle' | 'end') => void;
  stopEditing: (cancel?: boolean) => void;
  pasteFromClipboard: () => Promise<void>;
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

/** Anchor the focused cell at (rowIndex, colId) by firing a real
 *  mousedown at the cell's center via `getCellBoundsAt`. A click sets
 *  the focused row/col through the CellSelection feature — that's the
 *  same path real users take. The `setFocusedCell(rowId, colId)` public
 *  API needs a persistent rowId (worker round-trip to resolve), which
 *  isn't available without a real-data probe — clicking sidesteps that. */
async function anchorFocus(
  page: Page,
  rowIndex: number,
  colId: string,
): Promise<void> {
  // Scroll the column into view first — tradeDate / expiryDate sit
  // past the viewport's right edge at 1400 × 900; without a scroll
  // `getCellBoundsAt` returns null.
  await page.evaluate(
    (id) => (window as unknown as { __cgrid: GridSurface }).__cgrid.ensureColumnVisible(id, 'start'),
    colId,
  );
  await waitForFrames(page, 4);
  const bounds = await page.evaluate(
    ({ rowIndex, colId }) => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellBoundsAt(rowIndex, colId),
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
  // The demo enables `singleClickEdit: true` so a click on an editable
  // column (tradeDate / expiryDate / notes / cusip / ticker) opens its
  // cell editor — subsequent keyboard events would target the editor's
  // <textarea>/<input> instead of the canvas. Cancel any open editor so
  // Ctrl+V / `pasteFromClipboard` reaches the canvas-level handler.
  await page.evaluate(() => {
    const w = window as unknown as { __cgrid: GridSurface };
    w.__cgrid.stopEditing(true);
  });
  await waitForFrames(page, 2);
}

async function seedClipboard(page: Page, payload: string): Promise<void> {
  await page.evaluate((p) => navigator.clipboard.writeText(p), payload);
}

test.describe('Cycle 10 / Task 4 — clipboard paste', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('pasteFromClipboard with a 2×2 TSV writes into cells under the focused anchor', async ({ page }) => {
    await gridReady(page);
    await anchorFocus(page, 0, 'tradeDate');

    // tradeDate + expiryDate are both string-typed editable columns
    // adjacent in the demo's visible-leaf order; the 2×2 grid lands
    // at (0, tradeDate) → (1, expiryDate).
    await seedClipboard(page, 'TD_X\tEX_X\nTD_Y\tEX_Y');

    await page.evaluate(() => (window as unknown as { __cgrid: GridSurface }).__cgrid.pasteFromClipboard());
    await waitForFrames(page, 8);

    const after = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      return {
        a: g.getCellValue(0, 'tradeDate'),
        b: g.getCellValue(0, 'expiryDate'),
        c: g.getCellValue(1, 'tradeDate'),
        d: g.getCellValue(1, 'expiryDate'),
      };
    });
    expect(after.a).toBe('TD_X');
    expect(after.b).toBe('EX_X');
    expect(after.c).toBe('TD_Y');
    expect(after.d).toBe('EX_Y');
  });

  test('Ctrl+V keypath: pressing Control+V on the canvas pastes', async ({ page, browserName }) => {
    await gridReady(page);
    await anchorFocus(page, 3, 'tradeDate');
    await seedClipboard(page, 'TD_KEY');
    await focusCanvas(page);

    const mod = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.down(mod);
    await page.keyboard.press('KeyV');
    await page.keyboard.up(mod);

    // Poll until the cell flips — the keydown kicks off an async chain
    // (worker round-trip + applyTransaction) so the value isn't ready
    // synchronously.
    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellValue(3, 'tradeDate'),
      ),
      { timeout: 5_000 },
    ).toBe('TD_KEY');
  });

  test('round-trip: cells with embedded tab / newline / quote survive copy + paste', async ({ page }) => {
    await gridReady(page);
    await anchorFocus(page, 5, 'tradeDate');

    // Manually-seeded RFC-4180 quoted payload — emulates what a copy
    // out of Excel produces for cells containing the delimiter / quote
    // / newline. Verifies the worker's `deserializeTsv` unwraps each.
    await seedClipboard(page, '"line1\nline2"\t"a""b"\n"has\ttab"\tplain');
    await page.evaluate(() => (window as unknown as { __cgrid: GridSurface }).__cgrid.pasteFromClipboard());
    await waitForFrames(page, 8);

    const after = await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      return {
        a: g.getCellValue(5, 'tradeDate'),
        b: g.getCellValue(5, 'expiryDate'),
        c: g.getCellValue(6, 'tradeDate'),
        d: g.getCellValue(6, 'expiryDate'),
      };
    });
    expect(after.a).toBe('line1\nline2');
    expect(after.b).toBe('a"b');
    expect(after.c).toBe('has\ttab');
    expect(after.d).toBe('plain');
  });

  test('no focused cell → pasteFromClipboard is a silent no-op', async ({ page }) => {
    await gridReady(page);
    // Don't click — focus state stays null after a fresh load.
    await focusCanvas(page);
    await seedClipboard(page, 'SHOULD_NOT_LAND');
    const before = await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellValue(0, 'tradeDate'),
    );
    await page.evaluate(() => (window as unknown as { __cgrid: GridSurface }).__cgrid.pasteFromClipboard());
    await waitForFrames(page, 4);
    const after = await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellValue(0, 'tradeDate'),
    );
    expect(after).toBe(before);
  });
});
