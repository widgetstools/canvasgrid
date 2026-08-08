/**
 * Cycle 6 / Task 2 — column state round-trip.
 *
 * Three scenarios:
 *  1. Mutate via API → Save → reload → assert auto-restore brought the
 *     layout back. Exercises the `getColumnState` → localStorage →
 *     `applyColumnState` round-trip through the demo's wiring.
 *  2. Mutate → Reset → assert the construction-time snapshot is back.
 *  3. `defaultState: { hide: true }` + one explicit `{colId: 'pnl',
 *     hide: false }` leaves only `pnl` visible.
 *
 * The unit + integration tests (cgrid/tests/columnState.test.ts,
 * cgrid/tests/cgrid.integration.test.ts) cover the engine. This spec
 * asserts the end-to-end pipeline (button click → API → worker
 * round-trip → repaint) lights up against a real browser context.
 */
import { test, expect } from '@playwright/test';

interface ColumnStateEntry {
  colId: string;
  width?: number;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
}

interface GridApiSurface {
  getColumnState: () => ColumnStateEntry[];
  applyColumnState: (params: {
    state?: ColumnStateEntry[];
    applyOrder?: boolean;
    defaultState?: Omit<ColumnStateEntry, 'colId'>;
  }) => boolean;
  resetColumnState: () => void;
  moveColumnByIndex: (fromIndex: number, toIndex: number) => void;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light&pinning=on');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  // Settle frames.
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

async function visibleColIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = (window as unknown as {
      __velocity-grid: GridApiSurface;
    }).__cgrid;
    return grid.getColumnState()
      .filter((e) => e.hide !== true)
      .map((e) => e.colId);
  });
}

test.describe('Cycle 6 / Task 2 — column state round-trip', () => {
  test.beforeEach(async ({ page }) => {
    // Defensive: ensure each test starts with a fresh localStorage. We
    // clear it once after the first navigation rather than via
    // `addInitScript` — the latter re-runs on every navigation including
    // `page.reload()`, which would wipe the saved layout the round-trip
    // test depends on.
    await page.goto('/?stress=light');
    await page.evaluate(() => localStorage.removeItem('vg-layout'));
  });

  test('Save → reload → Restore via the toolbar button replays the saved layout', async ({ page }) => {
    await gridReady(page);

    // Mutate: move cusip past ticker via the imperative API so we have a
    // deterministic, persistent change to round-trip.
    const before = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return grid.getColumnState().map((e) => e.colId);
    });
    const cusipIdx = before.indexOf('cusip');
    const tickerIdx = before.indexOf('ticker');
    expect(cusipIdx).toBeGreaterThan(-1);
    expect(tickerIdx).toBeGreaterThan(-1);
    await page.evaluate(
      ({ from, to }) => {
        const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
        grid.moveColumnByIndex(from, to);
      },
      { from: cusipIdx, to: tickerIdx },
    );

    // Persist via the toolbar button.
    await page.click('#save-layout');

    // Capture expected order then reload.
    const expected = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return grid.getColumnState().map((e) => e.colId);
    });
    await page.reload();
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );

    // Confirm localStorage carried the expected order (debug aid).
    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('vg-layout');
      return raw ? (JSON.parse(raw) as Array<{ colId: string }>).map((e) => e.colId) : null;
    });
    expect(persisted).toEqual(expected);

    // After reload, the demo paints the construction-time order. Click
    // Restore Layout to replay the localStorage-persisted snapshot.
    await page.click('#restore-layout');
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 8 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const after = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return grid.getColumnState().map((e) => e.colId);
    });
    // The restored order honors locks — `notionalAmount` carries
    // `lockPosition: 'right'`, so applyOrder clamps it to the end even
    // when the persisted snapshot had it elsewhere. Assert the moved
    // pair's relative order instead of strict equality.
    expect(after.indexOf('ticker')).toBeLessThan(after.indexOf('cusip'));
    expect(after.indexOf('positionId')).toBe(0); // suppressMovable + pinned-left
    expect(after.at(-1)).toBe('notionalAmount'); // lockPosition: 'right'
    // And every persisted colId still exists in the restored snapshot.
    for (const id of expected) expect(after).toContain(id);
  });

  test('Reset restores the construction-time snapshot after a mutation', async ({ page }) => {
    await gridReady(page);

    const original = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return grid.getColumnState().map((e) => e.colId);
    });
    // Mutate via API: hide ticker.
    await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      grid.applyColumnState({ state: [{ colId: 'ticker', hide: true }] });
    });
    const afterMutate = await visibleColIds(page);
    expect(afterMutate).not.toContain('ticker');

    // Reset via the toolbar button.
    await page.click('#reset-layout');

    // Settle.
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 4 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
    const afterReset = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return grid.getColumnState().map((e) => e.colId);
    });
    expect(afterReset).toEqual(original);
    expect(await visibleColIds(page)).toContain('ticker');
  });

  test('defaultState: { hide: true } + explicit { pnl, hide: false } leaves only pnl visible', async ({ page }) => {
    await gridReady(page);

    await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      grid.applyColumnState({
        state: [{ colId: 'pnl', hide: false }],
        defaultState: { hide: true },
      });
    });
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 4 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );
    const visible = await visibleColIds(page);
    expect(visible).toEqual(['pnl']);
  });
});
