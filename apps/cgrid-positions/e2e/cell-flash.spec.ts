/**
 * Cycle 4 / Task 11 (cell-flash patch) — cell-flash E2E.
 *
 * Drives the registry via the deterministic `api.flashCells` path
 * rather than waiting for STOMP live updates (STOMP cadence varies
 * with the broker's load + the live phase can take seconds to start;
 * not a reliable E2E signal). The chunk-driven path is covered by:
 *   - unit tests for `diffRowFields` + `ViewportSlicer.flashMask`
 *   - the visible smoke screenshot at
 *     `.playwright-mcp/cycle4-task11-01-live-flash.png` which shows
 *     yellow-tinted cells on STOMP-updated rows
 *   - sync `applyTransaction.update` was probed directly via Chrome
 *     DevTools and confirms `chunk.flashMask` carries the correct
 *     bits.
 *
 * Verifies in this spec:
 *   1. `api.flashCells({rowIds, colIds})` populates the FlashRegistry.
 *   2. `setGridOption('enableCellChangeFlash', false)` short-circuits
 *      programmatic flashes.
 *   3. `prefers-reduced-motion: reduce` suppresses every flash.
 *   4. `enableCellChangeFlash: false` (re-enabled) lets flashes
 *      resume.
 *
 * Probes the FlashRegistry directly via `window.__cgrid` (which IS
 * the CGrid instance, not just the API surface) — the painter draws
 * to canvas so per-pixel comparison in Playwright is fragile.
 */
import { test, expect } from '@playwright/test';

interface CGridInstance {
  flashRegistry: { size: () => number };
  flashCells: (params: { rowIds: string[]; colIds?: string[] }) => void;
  setGridOption: (k: string, v: unknown) => void;
  getCellValue: (rowIndex: number, colId: string) => unknown;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

async function rowIdAt(page: import('@playwright/test').Page, rowIndex: number): Promise<string> {
  const id = await page.evaluate(
    (idx) => {
      const api = (window as unknown as { __cgrid: CGridInstance }).__cgrid;
      const v = api.getCellValue(idx, 'positionId');
      return typeof v === 'string' ? v : null;
    },
    rowIndex,
  );
  expect(id, `expected positionId at row ${rowIndex} but got ${id}`).not.toBeNull();
  return id!;
}

test.describe('Cycle 4 / Task 11 — cell flash', () => {
  test('api.flashCells populates the FlashRegistry end-to-end', async ({ page }) => {
    await gridReady(page);
    const rowId = await rowIdAt(page, 0);
    const sizeBefore = await page.evaluate(
      () => (window as unknown as { __cgrid: CGridInstance }).__cgrid.flashRegistry.size(),
    );
    await page.evaluate((id) => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .flashCells({ rowIds: [id], colIds: ['ticker'] });
    }, rowId);
    // The flash actually lands on the next viewport chunk after the
    // worker round-trip — poll for the size to bump above the
    // baseline.
    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __cgrid: CGridInstance }).__cgrid.flashRegistry.size(),
      ),
      { timeout: 5000, intervals: [100, 250, 500] },
    ).toBeGreaterThan(sizeBefore);
  });

  test('setGridOption(enableCellChangeFlash=false) suppresses programmatic flashes', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .setGridOption('enableCellChangeFlash', false);
    });
    // Give the worker's `setEnableCellChangeFlash` round-trip a
    // moment + let any pre-existing entries fully fade (default
    // 500ms flash + 1000ms fade = 1500ms).
    await page.waitForTimeout(2000);
    const rowId = await rowIdAt(page, 0);
    await page.evaluate((id) => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .flashCells({ rowIds: [id], colIds: ['ticker'] });
    }, rowId);
    // Wait long enough for the chunk round-trip; size should stay 0.
    await page.waitForTimeout(500);
    const size = await page.evaluate(
      () => (window as unknown as { __cgrid: CGridInstance }).__cgrid.flashRegistry.size(),
    );
    expect(size).toBe(0);
  });

  test('re-enabling enableCellChangeFlash resumes flashes', async ({ page }) => {
    await gridReady(page);
    // Off, then back on.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .setGridOption('enableCellChangeFlash', false);
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .setGridOption('enableCellChangeFlash', true);
    });
    await page.waitForTimeout(200);
    const rowId = await rowIdAt(page, 0);
    await page.evaluate((id) => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .flashCells({ rowIds: [id], colIds: ['ticker'] });
    }, rowId);
    await expect.poll(
      async () => page.evaluate(
        () => (window as unknown as { __cgrid: CGridInstance }).__cgrid.flashRegistry.size(),
      ),
      { timeout: 5000, intervals: [100, 250] },
    ).toBeGreaterThan(0);
  });

  test('prefers-reduced-motion: reduce suppresses every flash', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gridReady(page);
    const rowId = await rowIdAt(page, 0);
    await page.evaluate((id) => {
      (window as unknown as { __cgrid: CGridInstance }).__cgrid
        .flashCells({ rowIds: [id], colIds: ['ticker'] });
    }, rowId);
    // Wait for the chunk round-trip — flashes would land within ~500ms
    // if not suppressed. Reduced-motion should keep size at 0.
    await page.waitForTimeout(1000);
    const size = await page.evaluate(
      () => (window as unknown as { __cgrid: CGridInstance }).__cgrid.flashRegistry.size(),
    );
    expect(size).toBe(0);
  });
});
