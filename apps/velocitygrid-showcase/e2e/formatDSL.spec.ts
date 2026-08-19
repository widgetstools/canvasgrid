import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21c / Task 18 — Format DSL feature.
//
// Cell text is canvas-painted (not in the DOM), so tier assertions read
// the RESOLVED column defs through `window.__cgrid` — the compiled
// valueFormatter / cellStyleFn / cellIcon / _compositeProgram functions
// are exactly what the painter invokes per cell. The tooltip and
// clipboard scenarios assert real DOM / clipboard side effects.

const AAPL = { symbol: 'AAPL', price: 150.25, change: 2.5, volume: 45_000_000 };
const GOOG = { symbol: 'GOOG', price: 2850.1, change: -12.75, volume: 12_500_000 };

/** Invoke a resolved-def callback (valueFormatter / cellStyleFn / cellIcon)
 *  for one column against a sample row, inside the page. */
async function callResolved(
  page: import('@playwright/test').Page,
  colId: string,
  fnName: string,
  value: unknown,
  data: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(([cid, fname, v, d]) => {
    const def = (window.__cgrid as any).columnDefsMap.get(cid as string);
    const fn = def?.[fname as string];
    if (typeof fn !== 'function') return { __missing: true };
    return fn({ value: v, data: d, colId: cid });
  }, [colId, fnName, value, data] as const);
}

test.describe('format DSL feature', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'format-dsl');
  });

  test('mounts 5 rows and 15 columns including the composite summary', async ({ page }) => {
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBe(5);
    const colIds: string[] = await page.evaluate(() =>
      Array.from((window.__cgrid as any).columnDefsMap.keys()));
    expect(colIds).toEqual([
      'symbol', 'price', 'change', 'changeColor', 'changeIcon', 'volume', 'summary',
      'changePct', 'updated', 'trend', 'volAbbr', 'qty', 'momentum', 'tier', 'priceEur',
    ]);
  });

  test('Tier 0 — string valueFormatter compiles to a currency formatter', async ({ page }) => {
    expect(await callResolved(page, 'price', 'valueFormatter', 150.25, AAPL)).toBe('$150.25');
    expect(await callResolved(page, 'price', 'valueFormatter', 2850.1, GOOG)).toBe('$2,850.10');
    expect(await callResolved(page, 'volume', 'valueFormatter', 45_000_000, AAPL)).toBe('45,000,000');
  });

  test('Tier 0 — semicolon sections apply [Red] on the negative section', async ({ page }) => {
    expect(await callResolved(page, 'change', 'valueFormatter', -12.75, GOOG)).toBe('-$12.75');
    const negStyle = await callResolved(page, 'change', 'cellStyleFn', -12.75, GOOG);
    expect((negStyle as any)?.fg?.toLowerCase()).toBe('#e53935');
    const posStyle = await callResolved(page, 'change', 'cellStyleFn', 2.5, AAPL);
    expect((posStyle as any)?.fg).toBeUndefined();
  });

  test('Tier 1 — [color=<expr>] resolves a per-row color', async ({ page }) => {
    const pos = await callResolved(page, 'changeColor', 'cellStyleFn', 2.5, AAPL);
    expect((pos as any)?.fg).toBe('#0a7');
    const neg = await callResolved(page, 'changeColor', 'cellStyleFn', -12.75, GOOG);
    expect((neg as any)?.fg).toBe('#d33');
  });

  test('Tier 1 — {icon:…|<expr>} resolves a conditional inline icon', async ({ page }) => {
    const up = await callResolved(page, 'changeIcon', 'cellIcon', 2.5, AAPL);
    expect((up as any)?.name).toBe('trending-up');
    const down = await callResolved(page, 'changeIcon', 'cellIcon', -12.75, GOOG);
    expect((down as any)?.name).toBe('trending-down');
    // The Lucide bundle loads async via the bridge — it must be resolvable
    // by paint time so the painter strokes a real Path2D.
    await expect
      .poll(() => page.evaluate(() => (window.__cgrid as any).resolveIcon('trending-up') !== null))
      .toBe(true);
  });

  test('Tier 2 — composite column routes to the composite renderer with 5 fragments', async ({ page }) => {
    const info = await page.evaluate(() => {
      const def = (window.__cgrid as any).columnDefsMap.get('summary');
      const program = def?._compositeProgram;
      const ctx = { value: null, row: { symbol: 'AAPL', price: 150.25, change: 2.5 }, colId: 'summary' };
      return {
        cellRenderer: def?.cellRenderer,
        overflow: def?.compositeOverflow,
        hasProgram: !!program,
        text: program?.formatText(ctx),
        fragments: program?.resolveFragments(ctx),
      };
    });
    expect(info.cellRenderer).toBe('composite');
    expect(info.overflow).toBe('ellipsis');
    expect(info.hasProgram).toBe(true);
    expect(info.text).toBe('AAPL  $150.25  +2.50');
    expect(info.fragments).toHaveLength(5);
    expect(info.fragments[0]).toEqual({ text: 'AAPL', style: { weight: 'bold' } });
    expect(info.fragments[4]).toEqual({ text: '+2.50', style: { color: '#0a7' } });
  });

  test('hovering a composite summary cell shows the provider tooltip', async ({ page }) => {
    const canvas = page.locator('#grid-host canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // summary column spans x 690→950; first data row center is
    // headerHeight(36) + rowHeight(32)/2 = 52.
    await page.mouse.move(box!.x + 760, box!.y + 52);
    // 500ms debounce before the provider fires.
    const tooltip = page.locator('#cgrid-tooltip-provider');
    await expect(tooltip).toBeVisible({ timeout: 5_000 });
    await expect(tooltip).toContainText('AAPL');
    await expect(tooltip).toContainText('+2.50');
  });

  test('copying a range with the composite column emits text/plain + text/html', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#grid-host canvas').first().click({ position: { x: 40, y: 52 } });
    await page.evaluate(async () => {
      const grid = window.__cgrid as any;
      grid.clearCellRanges();
      grid.addCellRange({ rowStart: 0, rowEnd: 1, colIds: ['symbol', 'price', 'summary'] });
      await grid.copySelectedRangesToClipboard();
    });
    const [plain, html] = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      let plain = '';
      let html = '';
      for (const item of items) {
        if (item.types.includes('text/plain')) plain = await (await item.getType('text/plain')).text();
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      }
      return [plain, html];
    });
    // The TSV flavor carries raw cell values (pre-existing Cycle 10
    // behavior); the rich per-fragment styling lands in the HTML flavor.
    expect(plain).toContain('AAPL');
    expect(plain).toContain('150.25');
    expect(html).toContain('<table');
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('AAPL');
  });

  test('Tier 0 — percent, date tokens, and conditional [>1000] sections', async ({ page }) => {
    expect(await callResolved(page, 'changePct', 'valueFormatter', 0.0169, AAPL)).toBe('1.7%');
    const dateText = await page.evaluate(() => {
      const def = (window.__cgrid as any).columnDefsMap.get('updated');
      return def.valueFormatter({ value: new Date(2026, 6, 1), data: {}, colId: 'updated' });
    });
    expect(dateText).toBe('2026-07-01');
    expect(await callResolved(page, 'trend', 'valueFormatter', 15.3, { change: 15.3 })).toBe('UP 15.30');
    expect(await callResolved(page, 'trend', 'valueFormatter', -12.75, GOOG)).toBe('DOWN -12.75');
    expect(await callResolved(page, 'trend', 'valueFormatter', 2.5, AAPL)).toBe('2.50');
  });

  test('Tier 1 — [bg=], [weight=], [style=], and [if] section selectors', async ({ page }) => {
    // Resolved styles use the kernel override vocabulary:
    // bg / fg / fontWeight / fontStyle.
    const big = { qty: 220 };
    const small = { qty: 8 };
    const bigStyle = await callResolved(page, 'qty', 'cellStyleFn', 220, big);
    expect((bigStyle as any)?.bg).toBe('#fff3cd');
    expect((bigStyle as any)?.fontWeight).toBe('bold');
    const smallStyle = await callResolved(page, 'qty', 'cellStyleFn', 8, small);
    expect((smallStyle as any)?.bg).toBe('transparent');
    expect((smallStyle as any)?.fontWeight).toBe('normal');

    const downStyle = await callResolved(page, 'momentum', 'cellStyleFn', -12.75, GOOG);
    expect((downStyle as any)?.fontStyle).toBe('italic');

    expect((await callResolved(page, 'tier', 'valueFormatter', 220, big) as string).trim()).toBe('BLOCK');
    expect((await callResolved(page, 'tier', 'valueFormatter', 75, { qty: 75 }) as string).trim()).toBe('LOT');
    expect((await callResolved(page, 'tier', 'valueFormatter', 8, small) as string).trim()).toBe('ODD');
  });

  test('Tier 2 — composite cellBackground + align resolve per row', async ({ page }) => {
    const info = await page.evaluate(() => {
      const def = (window.__cgrid as any).columnDefsMap.get('summary');
      const program = def?._compositeProgram;
      const down = { value: null, row: { symbol: 'GOOG', price: 2850.1, change: -12.75 }, colId: 'summary' };
      const up = { value: null, row: { symbol: 'AAPL', price: 150.25, change: 2.5 }, colId: 'summary' };
      return {
        align: def?.compositeAlign,
        downBg: program?.resolveStyle(down)?.background,
        upBg: program?.resolveStyle(up)?.background,
      };
    });
    expect(info.align).toBe('left');
    expect(info.downBg).toBe('#fee2e2');
    expect(info.upBg).toBe('transparent');
  });

  test('formatter template registry — Currency + Abbreviated templates', async ({ page }) => {
    const text = await callResolved(page, 'priceEur', 'valueFormatter', 2850.1, GOOG);
    // de-DE grouping: dot thousands, comma decimals, trailing €.
    expect(text).toContain('2.850,10');
    expect(text).toContain('€');
    expect(await callResolved(page, 'volAbbr', 'valueFormatter', 45_000_000, AAPL)).toBe('45M');
  });

  test('description bar mentions Cycle 21c', async ({ page }) => {
    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('Cycle 21c');
  });
});
