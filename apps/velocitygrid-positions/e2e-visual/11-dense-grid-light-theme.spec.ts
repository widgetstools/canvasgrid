import { test, expect } from '@playwright/test';
import { setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — light-theme cell. The architecture pins the
// dark-theme matrix to `colorScheme: 'dark'`; this spec opts a single
// cell into `light` so a regression in light-mode theming (background
// swap, gridline contrast, scrollbar mode) shows up. The Quartz light
// theme is a distinct CSS class on the host (`vg-theme-quartz`), so
// the snapshot also gates the light-mode token table separately from
// the dark one.
test.use({ colorScheme: 'light' });

test('dense grid — 200 rows, Quartz light theme', async ({ page }) => {
  await setupGrid(page, 200);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: { setTheme: (cls: string) => void };
    }).__cgrid;
    g.setTheme('vg-theme-quartz');
    const host = document.getElementById('grid');
    if (host) {
      host.classList.remove('vg-theme-quartz-dark');
      host.classList.add('vg-theme-quartz');
    }
  });
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('11-dense-grid-light-theme.png');
});
