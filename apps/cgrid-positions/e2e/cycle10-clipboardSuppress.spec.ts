/**
 * Cycle 10 / Task 6 — suppress flags E2E.
 *
 *   - `suppressContextMenu`  → right-click does NOT mount `.cg-context-menu`
 *     (and the native browser menu doesn't fire either — `preventDefault`
 *     still runs).
 *   - `suppressClipboardPaste` → Ctrl+V / `pasteFromClipboard` silently
 *     no-op; the default Paste item renders disabled.
 *   - `suppressClipboardApi`  → `copy / paste / cut` reject with
 *     `clipboard-suppressed`; Ctrl+C / Ctrl+V / Ctrl+X forward via the
 *     feature chain (no preventDefault) so a host listener can take over.
 *
 * Verifies the runtime-toggle property too — every flag is read at event /
 * call time, so a mid-session `setGridOption(...)` flip lights up on the
 * next interaction without a reload.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const MENU_SELECTOR = '.cg-context-menu';

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
  clearCellRanges: () => void;
  setFocusedCell: (rowId: string, colId: string) => void;
  setGridOption: (key: string, value: unknown) => void;
  getGridOption: (key: string) => unknown;
  getCellValue: (rowIndex: number, colId: string) => unknown;
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

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

async function cellBounds(page: Page, rowIndex: number, colId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.evaluate(
    ({ r, c }) => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellBoundsAt(r, c),
    { r: rowIndex, c: colId },
  );
  if (!b) throw new Error(`no cell bounds for (${rowIndex}, ${colId})`);
  return b;
}

async function seedRange(page: Page, range: { rowStart: number; rowEnd: number; colIds: string[] }): Promise<void> {
  await page.evaluate((r) => {
    const w = window as unknown as { __cgrid: GridSurface };
    w.__cgrid.clearCellRanges();
    w.__cgrid.addCellRange(r);
  }, range);
}

/** Re-seal the suppress flag back to its default at the end of each test
 *  so a downstream spec doesn't inherit the gated state via the shared
 *  dev-server / window context. Mirrors the restore-pattern Tasks 3-5
 *  use for clipboardDelimiter / processCell callbacks. */
async function restoreFlags(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
    g.setGridOption('suppressContextMenu', undefined);
    g.setGridOption('suppressClipboardPaste', undefined);
    g.setGridOption('suppressClipboardApi', undefined);
    g.setGridOption('getContextMenuItems', undefined);
  });
}

test.describe('Cycle 10 / Task 6 — suppressContextMenu', () => {
  test.afterEach(async ({ page }) => { await restoreFlags(page); });

  test('right-click is swallowed: no cgrid menu mounts, preventDefault still fires', async ({ page }) => {
    await gridReady(page);
    // Install a callback so we'd see a menu in the un-suppressed case.
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.setGridOption('getContextMenuItems', () => [{ name: 'X', action: () => {} }]);
      g.setGridOption('suppressContextMenu', true);
    });

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);

    // Use dispatchEvent so we can inspect `defaultPrevented` on the synthetic
    // contextmenu — Playwright's right-click does the same plumbing under
    // the hood but doesn't surface preventDefault to the test.
    const prevented = await page.evaluate(
      ({ cx, cy }) => {
        const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
        const ev = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2,
        });
        c.dispatchEvent(ev);
        return ev.defaultPrevented;
      },
      { cx: off.x + b.x + b.w / 2, cy: off.y + b.y + b.h / 2 },
    );

    expect(prevented).toBe(true);
    expect(await page.locator(MENU_SELECTOR).count()).toBe(0);
  });

  test('runtime flip: setGridOption("suppressContextMenu", false) restores the menu', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.setGridOption('getContextMenuItems', () => [{ name: 'X', action: () => {} }]);
      g.setGridOption('suppressContextMenu', true);
    });

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    expect(await page.locator(MENU_SELECTOR).count()).toBe(0);

    // Flip the gate OFF — the next right-click mounts the menu again.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridSurface }).__cgrid.setGridOption('suppressContextMenu', false);
    });
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });
    expect(await page.locator(MENU_SELECTOR).count()).toBe(1);
  });
});

test.describe('Cycle 10 / Task 6 — suppressClipboardPaste', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });
  test.afterEach(async ({ page }) => { await restoreFlags(page); });

  test('pasteFromClipboard resolves silently and does not mutate the focused cell', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);
    await page.evaluate(() => navigator.clipboard.writeText('PAYLOAD-THAT-SHOULD-NOT-LAND'));

    // Anchor focus on (0, notes) directly via the API so the cell wouldn't
    // be a no-op-by-default-anchor scenario.
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.setFocusedCell('p-0', 'notes');
    });

    const before = await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellValue(0, 'notes'),
    );

    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridSurface }).__cgrid.setGridOption('suppressClipboardPaste', true);
    });
    // Resolves silently — no rejection, no clipboard read effect.
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.pasteFromClipboard(),
    );

    const after = await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.getCellValue(0, 'notes'),
    );
    expect(after).toBe(before);
  });

  test('Paste default-menu item renders disabled when suppressClipboardPaste is true', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.setGridOption('suppressClipboardPaste', true);
      // Use the default registry — it already wires `disabled` from
      // `isClipboardPasteSuppressed()`. We pass through `defaultItems`.
      g.setGridOption('getContextMenuItems', (params: { defaultItems: unknown[] }) => params.defaultItems);
    });

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });

    const pasteItem = page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({ hasText: 'Paste' }).first();
    await expect(pasteItem).toHaveAttribute('aria-disabled', 'true');
  });

  test('Ctrl+V does NOT preventDefault when suppressClipboardPaste is true', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.setFocusedCell('p-0', 'notes');
      g.setGridOption('suppressClipboardPaste', true);
    });

    // Listen for a `paste` event AND inspect `defaultPrevented` on the
    // synthetic keydown. When paste is suppressed, the KeyboardShortcuts
    // feature forwards via super and does NOT preventDefault.
    const prevented = await page.evaluate(() => {
      const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const ev = new KeyboardEvent('keydown', {
        key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true,
      });
      c.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });
});

test.describe('Cycle 10 / Task 6 — suppressClipboardApi', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });
  test.afterEach(async ({ page }) => { await restoreFlags(page); });

  test('copy / paste / cut reject with clipboard-suppressed', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);
    // Seed something the un-suppressed copy / cut would touch — confirms
    // the suppressed reject wins over `no-ranges`.
    await seedRange(page, { rowStart: 0, rowEnd: 0, colIds: ['notes'] });
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridSurface }).__cgrid.setGridOption('suppressClipboardApi', true);
    });

    const errors = await page.evaluate(async () => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      const copyErr = await g.copySelectedRangesToClipboard().then(() => null, (e: Error) => e.message);
      const pasteErr = await g.pasteFromClipboard().then(() => null, (e: Error) => e.message);
      const cutErr = await g.cutSelectedRanges().then(() => null, (e: Error) => e.message);
      return { copyErr, pasteErr, cutErr };
    });
    expect(errors.copyErr).toBe('clipboard-suppressed');
    expect(errors.pasteErr).toBe('clipboard-suppressed');
    expect(errors.cutErr).toBe('clipboard-suppressed');
  });

  test('Ctrl+C / Ctrl+V / Ctrl+X do NOT preventDefault when suppressClipboardApi is true', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.setFocusedCell('p-0', 'notes');
      g.setGridOption('suppressClipboardApi', true);
    });
    await seedRange(page, { rowStart: 0, rowEnd: 0, colIds: ['notes'] });

    const prevented = await page.evaluate(() => {
      const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const fire = (key: string, code: string) => {
        const ev = new KeyboardEvent('keydown', {
          key, code, ctrlKey: true, bubbles: true, cancelable: true,
        });
        c.dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      return {
        copy: fire('c', 'KeyC'),
        paste: fire('v', 'KeyV'),
        cut: fire('x', 'KeyX'),
      };
    });
    expect(prevented.copy).toBe(false);
    expect(prevented.paste).toBe(false);
    expect(prevented.cut).toBe(false);
  });

  test('runtime flip restores normal behavior (copy round-trips again after un-suppress)', async ({ page }) => {
    await gridReady(page);
    await focusCanvas(page);
    await seedRange(page, { rowStart: 0, rowEnd: 0, colIds: ['notes'] });

    // Suppress; assert reject.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridSurface }).__cgrid.setGridOption('suppressClipboardApi', true);
    });
    const errFirst = await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.copySelectedRangesToClipboard()
        .then(() => null, (e: Error) => e.message),
    );
    expect(errFirst).toBe('clipboard-suppressed');

    // Un-suppress; same call should now succeed and the clipboard should
    // contain the cell value.
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridSurface }).__cgrid.setGridOption('suppressClipboardApi', false);
    });
    await page.evaluate(
      () => (window as unknown as { __cgrid: GridSurface }).__cgrid.copySelectedRangesToClipboard(),
    );
    const expected = await page.evaluate(
      () => String((window as unknown as { __cgrid: GridSurface }).__cgrid.getCellValue(0, 'notes') ?? ''),
    );
    await expect.poll(
      async () => page.evaluate(() => navigator.clipboard.readText()),
      { timeout: 5_000 },
    ).toBe(expected);
  });
});
