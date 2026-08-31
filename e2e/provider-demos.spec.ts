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
