import { test, expect } from '@playwright/test';
import { gotoFeature, gridHost, toggleToLightTheme, waitForFrames } from './_setup';

// Cycle 21f visual-polish fix pass — visual-regression baselines for the
// three renderer showcase pages (renderer-blotter, renderer-charts,
// renderer-catalog) × light/dark, 6 snapshots total. Screenshots ONLY
// `#grid-host` (never the sidebar/desc-bar/controls chrome around it).
//
// Determinism: none of the three pages' demo data depends on the wall
// clock — rendererBlotter.ts and rendererCatalog.ts each capture a
// module-level clock ONCE at import time (D1's `frozenNow` / `FROZEN_NOW`)
// and only advance it via the tick controls, which this suite never
// clicks; rendererCharts.ts has no time-based renderer (age/relative-time/
// stale-flag) at all. No STOMP, no random.
const PAGES = [
  { id: 'renderer-blotter', label: 'blotter' },
  { id: 'renderer-charts', label: 'charts' },
  { id: 'renderer-catalog', label: 'catalog' },
] as const;

for (const { id, label } of PAGES) {
  test(`${label} — dark (default)`, async ({ page }) => {
    await gotoFeature(page, id);
    await waitForFrames(page, 8);
    await expect(gridHost(page)).toHaveScreenshot(`${label}-dark.png`);
  });

  test(`${label} — light (theme toggled once)`, async ({ page }) => {
    await gotoFeature(page, id);
    await toggleToLightTheme(page);
    await expect(gridHost(page)).toHaveScreenshot(`${label}-light.png`);
  });
}
