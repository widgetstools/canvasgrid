import type { Page, Locator } from '@playwright/test';

// Cycle 21f — visual-regression harness for the three renderer showcase
// pages (renderer-blotter, renderer-charts, renderer-catalog). Mirrors
// apps/velocitygrid-positions/e2e-visual/_setup.ts's shape (gridReady /
// waitForFrames precedent) but drives the showcase's own feature-router +
// `#theme-toggle` rather than the positions app's demo surface.

/** Navigate to a showcase feature and wait for its grid to finish its
 *  first paint. Mirrors apps/velocitygrid-showcase/e2e/helpers.ts's
 *  `gotoFeature` (functional suite) — duplicated here rather than shared
 *  so the visual config's separate Playwright project never depends on
 *  the functional suite's test files. */
export async function gotoFeature(page: Page, featureId: string): Promise<void> {
  await page.goto(`/?feature=${featureId}`);
  await page.waitForFunction(() => window.__cgridReady === true, undefined, { timeout: 20_000 });
}

/** Park the page for `n` rAF ticks so an in-flight repaint (theme flip,
 *  canvas resize) lands before the screenshot. Mirrors the positions
 *  visual harness's `waitForFrames`. */
export async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => {
        i += 1;
        if (i >= count) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

/** Click `#theme-toggle` once — the showcase starts DARK (main.ts:
 *  `currentTheme = 'vg-theme-quartz-dark'`, `app.dataset.theme = 'dark'`)
 *  and a single click flips to the Quartz LIGHT theme. Never call this
 *  twice in the same test (a second click flips back to dark). */
export async function toggleToLightTheme(page: Page): Promise<void> {
  await page.locator('#theme-toggle').click();
  await waitForFrames(page, 8);
}

/** The `#grid-host` element locator — every visual-regression snapshot in
 *  this suite screenshots ONLY this element (the canvas + its scroller
 *  chrome), never the sidebar/desc-bar/controls shell around it. */
export function gridHost(page: Page): Locator {
  return page.locator('#grid-host');
}
