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

  test('mounts 5 rows and 7 columns including the composite summary', async ({ page }) => {
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBe(5);
    const colIds: string[] = await page.evaluate(() =>
      Array.from((window.__cgrid as any).columnDefsMap.keys()));
    expect(colIds).toEqual(['symbol', 'price', 'change', 'changeColor', 'changeIcon', 'volume', 'summary']);
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

  test('description bar mentions Cycle 21c', async ({ page }) => {
    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('Cycle 21c');
  });
});
