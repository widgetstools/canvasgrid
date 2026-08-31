import { test, expect } from '@playwright/test';

/**
 * Smoke coverage for the two provider demos.
 *
 * Asserts the things that are easy to break silently and awkward to notice by
 * eye: that VelocityGridExt actually mounted (rather than a bare grid), that
 * the dark theme is the one in effect, that columns came from the CATALOG
 * (not hard-coded), and that the data controller bound the seeded provider.
 *
 * Deliberately does NOT assert on rows — without the STOMP fixture running
 * both grids are legitimately empty, and a row assertion would make this fail
 * for an environment reason rather than a code one.
 */
const DEMOS = [
  { name: 'CSRM', url: 'http://localhost:5210/', providerId: 'demo-csrm-positions' },
  { name: 'SSRM', url: 'http://localhost:5211/', providerId: 'demo-ssrm-positions' },
] as const;

for (const demo of DEMOS) {
  test(`${demo.name} demo mounts Ext, dark theme, catalog columns`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(demo.url);
    await page.waitForFunction(() => (window as any).__demo?.ext !== undefined, { timeout: 45_000 });
    await page.waitForTimeout(6000);

    const state = await page.evaluate(() => {
      const d = (window as any).__demo;
      const themed = document.querySelector('[class*="vg-theme"]') as HTMLElement | null;
      return {
        hasExt: !!d.ext,
        theme: themed?.className?.match(/vg-theme-[a-z-]+/)?.[0] ?? null,
        extChromeNodes: document.querySelectorAll('[class^="vgext"], [class*=" vgext"]').length,
        columns: (d.grid?.getColumnState?.() ?? []).map((c: any) => c.colId),
        activeProvider: d.dataController?.getActiveProviderId?.() ?? null,
      };
    });

    expect(state.hasExt).toBe(true);
    // Dark by default — a light theme here means the default regressed.
    expect(state.theme).toContain('dark');
    // Ext chrome, not a bare grid.
    expect(state.extChromeNodes).toBeGreaterThan(20);
    // Columns come from the provider's columnDefinitions.
    expect(state.columns).toEqual(
      expect.arrayContaining(['positionId', 'desk', 'region', 'pnl']),
    );
    expect(state.activeProvider).toBe(demo.providerId);
    expect(pageErrors).toEqual([]);
  });

  test(`${demo.name} title bar renders in the declared left-to-right order`, async ({ page }) => {
    await page.goto(demo.url);
    await page.waitForSelector('.vgext-titlebar .vgext-toolbar-item', { timeout: 45_000 });
    await page.waitForTimeout(2000);

    // Read PAINTED position, not DOM order. The bug this pins was a layout
    // one — the utility cluster rendered left of the caption — and the
    // happy-dom unit test in packages/ext cannot measure that.
    const painted = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.vgext-titlebar .vgext-toolbar-item')]
        .map((c) => ({ id: c.dataset.itemId!, x: c.getBoundingClientRect().left }))
        .sort((a, b) => a.x - b.x)
        .map((c) => c.id));

    expect(painted).toEqual([
      'brand',              // caption
      'saved-filters',      // filter pills + funnels, beside the caption
      'search',
      'notifications',      // alerts
      'layouts',            // layout selector
      'layout-save',
      'date',
      'settings-launcher',  // toolbar selector (Columns / toolbars / theme)
      'overflow',           // ellipsis menu
    ]);
    // The default bundle's profile Save is dropped — it duplicated the layout
    // disk beside it and wrote through a different persister.
    expect(painted).not.toContain('save');
  });
}

for (const demo of DEMOS) {
  /**
   * Pivot must work when the grid is mounted by VelocityGridExt.
   *
   * Under Ext, column defs come from the provider catalog and are the ONLY
   * defs — and neither catalog mapper emitted `enablePivot`, which the pivot
   * panel checks before accepting a drop. So the panel rendered, invited a
   * drag, and silently refused every one. An app that hand-writes columnDefs
   * sets the flag itself, so the same feature worked or not depending purely
   * on how the grid was mounted.
   *
   * This drags for real rather than calling `setPivotColumns`, because the
   * API path bypasses the very gate that was broken.
   */
  test(`${demo.name} accepts a column dragged into Column Labels`, async ({ page }) => {
    await page.goto(demo.url);
    await page.waitForFunction(() => (window as any).__demo?.ext !== undefined, { timeout: 45_000 });
    await page.waitForTimeout(6000);

    const capabilities = await page.evaluate(() => {
      const g = (window as any).__demo.grid;
      const ids: string[] = (g.getColumnState() ?? []).map((c: any) => c.colId);
      return {
        pivotable: ids.filter((c) => g.isColumnPivotEnabled(c)),
        groupable: ids.filter((c) => g.isColumnRowGroupEnabled(c)),
        valued: ids.filter((c) => g.isColumnValueEnabled(c)),
      };
    });

    // Dimensions are pivotable and groupable; measures aggregate.
    expect(capabilities.pivotable).toEqual(
      expect.arrayContaining(['desk', 'region', 'ticker', 'instrumentType']),
    );
    expect(capabilities.valued).toEqual(expect.arrayContaining(['pnl', 'marketValue']));
    // The key column identifies rows; pivoting by it would mint one column per row.
    expect(capabilities.pivotable).not.toContain('positionId');
    expect(capabilities.groupable).not.toContain('positionId');

    const from = await page.evaluate(() => {
      const bb = (window as any).__demo.grid.getHeaderBoundsAt('region');
      if (!bb) return null;
      const r = document.querySelector('canvas')!.getBoundingClientRect();
      return { x: r.left + bb.x + bb.w / 2, y: r.top + bb.y + bb.h / 2 };
    });
    const panel = await page.locator('.vg-pivot-panel').first().boundingBox();
    expect(from).not.toBeNull();
    expect(panel).not.toBeNull();

    expect(await page.evaluate(() => (window as any).__demo.grid.getPivotColumns())).toEqual([]);

    const tx = panel!.x + panel!.width / 2;
    const ty = panel!.y + panel!.height / 2;
    await page.mouse.move(from!.x, from!.y);
    await page.mouse.down();
    // Stepped, not a single jump — the drag controller needs movement to start.
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(
        from!.x + ((tx - from!.x) * i) / 14,
        from!.y + ((ty - from!.y) * i) / 14,
      );
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(2500);

    expect(await page.evaluate(() => (window as any).__demo.grid.getPivotColumns())).toEqual(['region']);
  });
}

/**
 * Auto format must not undo the user's column state, and must not drop the
 * pivot cross-tab.
 *
 * Auto format edits every matched column in one pass, so it made two rebuild
 * defects unmissable: live `hide` / `pinned` were not carried across a column
 * rebuild (only `width` was), and under pivot the rebuild installed the SOURCE
 * columns over the synthetic cross-tab while `isPivotMode()` stayed true — the
 * grid painted primary columns with a Column Labels chip pointing at nothing.
 *
 * Run against CSRM because it takes rows synchronously; the rebuild path under
 * test is kernel-side and identical for both row models.
 */
test('Auto format preserves column state and the pivot cross-tab', async ({ page }) => {
  await page.goto('http://localhost:5210/');
  await page.waitForFunction(() => (window as any).__demo?.ext !== undefined, { timeout: 45_000 });
  await page.waitForTimeout(5000);

  const columnState = () => page.evaluate(() => {
    const st = (window as any).__demo.grid.getColumnState();
    return {
      hidden: st.filter((c: any) => c.hide).map((c: any) => c.colId),
      pinned: st.filter((c: any) => c.pinned).map((c: any) => `${c.colId}:${c.pinned}`),
      tickerWidth: st.find((c: any) => c.colId === 'ticker')?.width,
    };
  });
  const autoFormat = async () => {
    await page.evaluate(() => (window as any).__demo.ext.context.events.emit({ type: 'auto-format' }));
    await page.waitForTimeout(3000);
  };

  await page.evaluate(() => {
    const g = (window as any).__demo.grid;
    g.setColumnsVisible(['ticker', 'instrumentType'], false);
    g.setColumnsPinned(['desk'], 'left');
    g.setColumnWidths([{ key: 'ticker', newWidth: 222 }]);
  });
  await page.waitForTimeout(1000);

  const before = await columnState();
  expect(before.hidden).toEqual(['ticker', 'instrumentType']);
  expect(before.pinned).toEqual(['desk:left']);
  expect(before.tickerWidth).toBe(222);

  await autoFormat();
  expect(await columnState()).toEqual(before);

  // Now the pivot half: build a cross-tab, then auto format over the top.
  await page.evaluate(async () => {
    const g = (window as any).__demo.grid;
    g.setRowData(Array.from({ length: 300 }, (_, i) => ({
      positionId: 'p' + i, ticker: 'T' + (i % 7),
      desk: ['FX', 'Rates', 'Credit'][i % 3], region: ['EMEA', 'AMER', 'APAC'][i % 3],
      instrumentType: 'Bond', notionalAmount: 1000 + i, marketValue: 2000 + i,
      pnl: i * 10, dailyPnl: i,
    })));
    await new Promise((r) => setTimeout(r, 1200));
    g.setRowGroupColumns(['desk']);
    g.setPivotColumns(['region']);
    g.setValueColumns([{ colId: 'pnl', aggFunc: 'sum' }]);
    g.setPivotMode(true);
    await new Promise((r) => setTimeout(r, 3500));
  });

  const pivotState = () => page.evaluate(() => {
    const g = (window as any).__demo.grid;
    return {
      mode: g.isPivotMode(),
      resultColumns: g.getPivotResultColumns().length,
      // What is actually on screen — a rebuild left the model intact and
      // only the painted tree wrong, so the model alone would not catch it.
      paintedPivotHeaders: (g.getColumnState() ?? [])
        .filter((c: any) => String(c.colId).startsWith('pivotcol')).length
        + g.getPivotResultColumns().filter((id: string) => g.getHeaderBoundsAt(id) !== null).length,
    };
  });

  const pivotBefore = await pivotState();
  expect(pivotBefore.mode).toBe(true);
  expect(pivotBefore.resultColumns).toBe(3);
  expect(pivotBefore.paintedPivotHeaders).toBeGreaterThan(0);

  await autoFormat();

  // The cross-tab is still the thing being painted, not the source columns.
  expect(await pivotState()).toEqual(pivotBefore);
});

/**
 * Formatting reaches pivot cells, in every order, every time.
 *
 * A synthesized pivot leaf used to be built from six hard-coded properties and
 * never saw the calc provider, so the format toolbar / Column format… / Auto
 * format could not touch a pivot column at all. Pivot did not consume the
 * column pipeline, it bypassed it — which is why formatting "worked sometimes"
 * (it worked until you pivoted) and why fixes to the primary path kept
 * appearing not to stick.
 *
 * The determinism this asserts is the point: the SAME formatting must land
 * whether it was applied before pivoting, while pivoted, or across a pivot
 * off/on round trip.
 */
test('a value column format paints on its pivot cells, whatever the order', async ({ page }) => {
  await page.goto('http://localhost:5210/');
  await page.waitForFunction(() => (window as any).__demo?.ext !== undefined, { timeout: 45_000 });
  await page.waitForTimeout(5000);

  const paintedPivotCells = () => page.evaluate(() => {
    const g = (window as any).__demo.grid;
    const out: string[] = [];
    for (let r = 0; r < 4; r++) {
      for (const colId of g.getPivotResultColumns()) {
        const text = g.getCellFormattedValue(r, colId);
        if (text) out.push(text);
      }
    }
    return out;
  });

  await page.evaluate(async () => {
    const g = (window as any).__demo.grid;
    g.setRowData(Array.from({ length: 300 }, (_, i) => ({
      positionId: 'p' + i, ticker: 'T' + (i % 7),
      desk: ['FX', 'Rates', 'Credit'][i % 3], region: ['EMEA', 'AMER', 'APAC'][i % 3],
      instrumentType: 'Bond', notionalAmount: 1000 + i, marketValue: 2000 + i,
      pnl: i * 10, dailyPnl: i,
    })));
    await new Promise((r) => setTimeout(r, 1500));
    g.setRowGroupColumns(['desk']);
    g.setPivotColumns(['region']);
    g.setValueColumns([{ colId: 'pnl', aggFunc: 'sum' }]);
    g.setPivotMode(true);
    await new Promise((r) => setTimeout(r, 3500));
  });

  // Unformatted: raw numbers, no separators.
  const raw = await paintedPivotCells();
  expect(raw.length).toBeGreaterThan(0);
  for (const cell of raw) expect(cell).toMatch(/^\d+$/);

  // Applied WHILE pivoted — the case that was impossible.
  await page.evaluate(() => (window as any).__demo.grid.editColumn('pnl', { format: '$#,##0.00' }));
  await page.waitForTimeout(3000);
  const whilePivoted = await paintedPivotCells();
  expect(whilePivoted.length).toBe(raw.length);
  for (const cell of whilePivoted) expect(cell).toMatch(/^\$[\d,]+\.\d{2}$/);

  // And it survives leaving and re-entering pivot — same cells, same text.
  await page.evaluate(async () => {
    const g = (window as any).__demo.grid;
    g.setPivotMode(false);
    await new Promise((r) => setTimeout(r, 1500));
    g.setPivotMode(true);
    await new Promise((r) => setTimeout(r, 3000));
  });
  expect(await paintedPivotCells()).toEqual(whilePivoted);
});

/**
 * SSRM status bar: `Total Rows` is the unfiltered book, `Rows` is what the
 * filter left. They used to print the same number, because server-side
 * `getTotalRowCount()` just returned the displayed count.
 *
 * Driven by a stub datasource rather than the STOMP fixture: the fixture is
 * not present in every environment, and the assertion is about which count
 * each label reads, which a stub states far more precisely than live data.
 */
test('SSRM Total Rows reports the unfiltered book, not the filtered count', async ({ page }) => {
  await page.goto('http://localhost:5211/');
  await page.waitForFunction(() => (window as any).__demo?.ext !== undefined, { timeout: 45_000 });
  await page.waitForTimeout(2500);

  const install = async (matching: number, declare: boolean) => {
    await page.evaluate(([matching, declare]: [number, boolean]) => {
      (window as any).__demo.grid.setServerSideDatasource({
        getRows: ({ request, success }: any) => {
          const rowData = [];
          for (let i = request.startRow; i < Math.min(request.endRow, matching); i++) {
            rowData.push({ positionId: 'p' + i, desk: 'FX', region: 'EMEA', pnl: i });
          }
          success({
            rowData,
            rowCount: matching,
            ...(declare ? { unfilteredRowCount: 5000 } : {}),
          });
        },
      });
    }, [matching, declare] as [number, boolean]);
    await page.waitForTimeout(1200);
  };

  const counts = () => page.evaluate(() => [...document.querySelectorAll('.vg-status-panel-count')]
    .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.includes('Rows'))
    .join(' '));

  // Filtered: the two labels must disagree. This is the reported bug.
  await install(3337, true);
  expect(await counts()).toContain('5,000');
  expect(await counts()).toContain('3,337');

  // Unfiltered: agreeing here is correct, not a regression.
  await install(5000, true);
  expect(await counts()).toMatch(/Total Rows:\s*5,000\s*Rows:\s*5,000/);

  // A datasource that declares nothing keeps the old fallback rather than
  // printing "Total Rows: 0".
  await install(3337, false);
  expect(await counts()).toMatch(/Total Rows:\s*3,337\s*Rows:\s*3,337/);
});

/**
 * Saved-filter pill: stadium shape, and per-pill actions that stay out of the
 * way until the pill is hovered OR focused.
 *
 * Lives here rather than in a packages/ext unit test because all of it is
 * layout — the reveal is a CSS max-width transition and the assertions are
 * measured widths, which the happy-dom test environment cannot produce.
 *
 * The keyboard half is the point of the focus-within assertion: these actions
 * were once display:none-until-hover, which put them out of a keyboard user's
 * reach entirely. Collapsing them by width instead keeps them focusable, and
 * this fails if anyone swaps that back for display/visibility.
 */
test('saved-filter pills are stadium-shaped and reveal their actions on hover or focus', async ({ page }) => {
  await page.goto('http://localhost:5211/');
  await page.waitForSelector('.vgext-titlebar .vgext-toolbar-item', { timeout: 45_000 });
  await page.waitForTimeout(2000);

  // Seed a pill through the real path: apply a column filter, then press the
  // strip's "save current filters as a pill" funnel.
  await page.evaluate(() => (window as any).__demo.grid.setFilterModel(
    { region: { filterType: 'text', type: 'equals', filter: 'EMEA' } }));
  await page.waitForTimeout(600);
  await page.locator('.vgext-sf-add').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__demo.grid.setFilterModel({}));
  await page.waitForTimeout(500);

  const pill = page.locator('.vgext-sf-pill').first();
  await expect(pill).toBeVisible();

  const actionsWidth = () => page.evaluate(() => Math.round(
    document.querySelector('.vgext-sf-pill .vgext-sf-actions')!.getBoundingClientRect().width));

  expect(await pill.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px');

  // Park the cursor off the strip first: clicking the funnel left it there,
  // and adding the pill shifts the funnel right — putting the new pill under
  // the cursor, which would leave it hovered before we ever measure idle.
  await page.mouse.move(750, 400);
  await page.waitForTimeout(350);

  // Idle: collapsed to nothing.
  expect(await actionsWidth()).toBe(0);

  // Hover reveals.
  await pill.hover();
  await page.waitForTimeout(350);
  expect(await actionsWidth()).toBeGreaterThan(50);

  // Move away; it collapses again.
  await page.mouse.move(750, 400);
  await page.waitForTimeout(350);
  expect(await actionsWidth()).toBe(0);

  // Keyboard: focusing the pill reveals, and Tab reaches a real target.
  await pill.evaluate((el: HTMLElement) => el.focus());
  await page.waitForTimeout(350);
  expect(await actionsWidth()).toBeGreaterThan(50);

  await page.keyboard.press('Tab');
  await page.waitForTimeout(350);
  const focused = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      isAction: a?.classList.contains('vgext-sf-act') ?? false,
      width: a ? Math.round(a.getBoundingClientRect().width) : 0,
    };
  });
  expect(focused.isAction).toBe(true);
  // Focused while actually visible, at the 20px target size — not a zero-box.
  expect(focused.width).toBe(20);
});
