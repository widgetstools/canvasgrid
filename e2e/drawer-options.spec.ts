import { test, expect, type Page } from '@playwright/test';

/**
 * Do the customize drawer's settings actually reach the grid?
 *
 * The drawer is a thin UI over `setGridOption` — its schema declares an
 * accessor of exactly `{ getGridOption, setGridOption }` — so driving that
 * accessor drives what the drawer drives. The drawer's own controls render in
 * a CLOSED shadow root and cannot be reached by script, which is why this
 * tests the layer beneath them rather than the widgets themselves.
 *
 * The gap this exists to close: `animateRows` shipped in the panel as a switch
 * that stores a value no line of code reads. A unit test round-tripped it and
 * passed. `deadSwitches.test.ts` now catches that class statically; this
 * catches the runtime half — an option that IS read, and still changes nothing.
 *
 * Every probe is DISCRIMINATING: it compares against the state before the
 * change, so an option that is accepted and ignored fails rather than passing
 * for the wrong reason.
 */

const DEMO = 'http://localhost:5230/';

interface TreeApi {
  csrm: {
    setGridOption(key: string, value: unknown): void;
    getGridOption(key: string): unknown;
    getDisplayedRowCount(): number;
    getRowBoundsAt(i: number): { y: number; h: number } | null;
  };
}
declare global { interface Window { __tree: TreeApi } }

async function open(page: Page): Promise<void> {
  await page.goto(DEMO);
  await page.waitForFunction(() => window.__tree !== undefined, undefined, { timeout: 45_000 });
  await page.waitForFunction(
    () => (window.__tree.csrm.getDisplayedRowCount() ?? 0) > 0,
    undefined, { timeout: 45_000 },
  );
  await page.waitForTimeout(1200);
}

/** The CSRM grid's painted pixels. The one probe that needs no per-option
 *  knowledge: if a visual option changes nothing here, it changed nothing. */
async function canvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelectorAll('canvas')[0] as HTMLCanvasElement;
    return c.toDataURL().slice(-2000);
  });
}

async function setOption(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(([k, v]) => { window.__tree.csrm.setGridOption(k as string, v); },
    [key, value] as [string, unknown]);
  await page.waitForTimeout(700);
}

test.describe('grid options reach the grid', () => {
  /**
   * Options whose whole job is to change what is painted. Setting one and
   * getting identical pixels back means it did nothing.
   */
  const VISUAL: Array<[key: string, value: unknown]> = [
    ['rowHeight', 44],
    ['headerHeight', 52],
    ['suppressCount', true],
    ['density', 'compact'],
  ];

  for (const [key, value] of VISUAL) {
    test(`${key} repaints the grid`, async ({ page }) => {
      await open(page);
      const before = await canvasHash(page);
      await setOption(page, key, value);
      const after = await canvasHash(page);
      expect(after, `setGridOption('${key}', ${JSON.stringify(value)}) painted identical pixels`)
        .not.toBe(before);
    });
  }

  test('rowHeight changes the measured height of a row, by the amount asked for', async ({ page }) => {
    // Stronger than "the canvas moved": the row is the size requested. Catches
    // an option that repaints for an unrelated reason.
    await open(page);
    const heightOf = () => page.evaluate(() => window.__tree.csrm.getRowBoundsAt(1)?.h ?? null);
    const before = await heightOf();
    await setOption(page, 'rowHeight', 44);
    expect(await heightOf()).toBe(44);
    await setOption(page, 'rowHeight', 28);
    expect(await heightOf()).toBe(28);
    expect(before).not.toBe(44);
  });

  test('floatingFilter adds and removes the filter row', async ({ page }) => {
    await open(page);
    // Measure where the DATA starts, not how many <input> nodes exist. The
    // filter inputs are a POOLED overlay — the nodes are retained and hidden
    // when the row goes away, so counting them reports "nothing changed" for
    // an option that works. The band moving up by the row's height is the
    // effect; that pool is an implementation detail.
    const firstRowY = () => page.evaluate(() => window.__tree.csrm.getRowBoundsAt(1)?.y ?? null);
    await setOption(page, 'floatingFilter', true);
    const withRow = await firstRowY();
    await setOption(page, 'floatingFilter', false);
    const withoutRow = await firstRowY();
    expect(withoutRow, 'the data band did not move up when the filter row went away')
      .toBeLessThan(withRow!);
    await setOption(page, 'floatingFilter', true);
    expect(await firstRowY()).toBe(withRow);
  });

  test('statusBar shows and hides the row-count strip', async ({ page }) => {
    await open(page);
    // Scoped: `.first()` over the whole page re-resolves to the SSRM grid's
    // strip the moment the CSRM one hides, and then reports "still visible".
    const strip = page.locator('#csrm').getByText('Total Rows:').first();
    await expect(strip).toBeVisible();
    await setOption(page, 'statusBar', false);
    await expect(strip).toBeHidden();
    await setOption(page, 'statusBar', true);
    await expect(strip).toBeVisible();
  });

  test('rowGroupPanelShow shows and hides the drop strip', async ({ page }) => {
    await open(page);
    const panel = page.locator('#csrm').getByText('Drag here to set row groups').first();
    await expect(panel).toBeVisible();
    await setOption(page, 'rowGroupPanelShow', 'never');
    await expect(panel).toBeHidden();
  });

  test('a change to one grid does not touch the other', async ({ page }) => {
    // The scoping the probes above depend on, asserted rather than assumed:
    // these grids are separate instances and an option set on one must not
    // travel. It is also how the earlier version of this spec fooled itself.
    await open(page);
    const rowH = (host: string) => page.evaluate((h: string) =>
      (window as never as Record<string, { csrm: { getRowBoundsAt(i: number): { h: number } | null } }>)
        .__tree[h === 'csrm' ? 'csrm' : 'ssrm' as 'csrm'].getRowBoundsAt(1)?.h ?? null, host);
    const otherBefore = await rowH('ssrm');
    await setOption(page, 'rowHeight', 47);
    expect(await rowH('csrm')).toBe(47);
    expect(await rowH('ssrm'), 'the other grid moved too').toBe(otherBefore);
  });

  test('an option the grid does not know is refused, not silently swallowed', async ({ page }) => {
    // The taxonomy's own guarantee. If unknown keys were accepted, every probe
    // above could pass against a typo.
    await open(page);
    const threw = await page.evaluate(() => {
      try { window.__tree.csrm.setGridOption('noSuchOption', 1); return false; }
      catch { return true; }
    });
    expect(threw).toBe(true);
  });
});

/**
 * Options with no observable effect AT REST, and why.
 *
 * Not a pass — a ledger. Each needs an interaction (a click, a tick, a
 * right-click) or a second grid to show itself, so a repaint-based probe would
 * report "no effect" for something that works. They are listed so the gap is
 * visible instead of being mistaken for coverage, and so the list can shrink.
 *
 * The one option that genuinely does nothing (`animateRows`) is NOT here — it
 * is caught statically by `packages/kernel/tests/deadSwitches.test.ts`.
 */
const NO_AT_REST_PROBE: Record<string, string> = {
  suppressRowClickSelection: 'needs a click on a row',
  rowMultiSelectWithClick: 'needs two clicks',
  singleClickEdit: 'needs a click on a cell',
  suppressClickEdit: 'needs a click on a cell',
  suppressContextMenu: 'needs a right-click',
  enableCellChangeFlash: 'needs a value to change',
  cellFlashDirectional: 'needs a value to change',
  cellFlashDuration: 'needs a value to change, then timing',
  cellFadeDuration: 'needs a value to change, then timing',
  suppressRowHoverHighlight: 'needs a pointer over a row',
  clipboardDelimiter: 'needs a copy',
  suppressClipboardApi: 'needs a copy',
  enableFillHandle: 'needs a range selection and a drag',
  fillHandleDirection: 'needs a range selection and a drag',
  suppressColumnVirtualisation: 'a correctness/perf flag; same pixels either way',
  suppressRowVirtualisation: 'a correctness/perf flag; same pixels either way',
  rasterCacheBudgetMB: 'a cache size; same pixels either way',
  rowBuffer: 'a prefetch depth; same pixels either way',
  // Initial-only: `setGridOption` rejects it by design, so there is nothing to
  // probe at runtime. It reaches the grid through construction instead.
  groupDefaultExpanded: 'initial-only — rejected by setGridOption by design',
};

test.describe('the unprobed list stays honest', () => {
  test('every entry says why it cannot be probed at rest', () => {
    for (const [key, reason] of Object.entries(NO_AT_REST_PROBE)) {
      expect(reason.length, `no reason recorded for '${key}'`).toBeGreaterThan(10);
    }
    // A tripwire on the ledger's own size: if it grows past the options that
    // genuinely need interaction, someone is using it to park real gaps.
    expect(Object.keys(NO_AT_REST_PROBE).length).toBeLessThan(25);
  });
});
