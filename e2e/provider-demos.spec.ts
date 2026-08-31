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
}
