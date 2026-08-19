import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('theming feature', () => {
  test('mounts with the normal density pill active and a theme pill active', async ({ page }) => {
    await gotoFeature(page, 'theming');
    await expect(page.getByTestId('btn-density-normal')).toHaveClass(/primary/);
    // The showcase shell defaults to dark; the feature inherits whichever
    // theme the user last set. Verify SOME theme pill is active rather
    // than asserting a specific one — the demo's job is to expose the
    // toggle, not pin the default.
    const activeThemeCount: number = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid^="btn-theme-"].primary').length;
    });
    expect(activeThemeCount).toBe(1);
  });

  test('density pill swaps the vg-density-<mode> class on the grid root', async ({ page }) => {
    await gotoFeature(page, 'theming');
    await page.getByTestId('btn-density-compact').click();
    const classes: string = await page.evaluate(() => {
      const g = (window as any).__cgrid;
      // root is a private field — read from the host's first .vg-grid child
      const root = document.querySelector('.vg-grid') as HTMLElement;
      return root.className;
    });
    expect(classes).toContain('vg-density-compact');
  });

  test('theme pill swaps the vg-theme-* class on the grid root', async ({ page }) => {
    await gotoFeature(page, 'theming');
    await page.getByTestId('btn-theme-quartz-dark').click();
    const classes: string = await page.evaluate(() => {
      const root = document.querySelector('.vg-grid') as HTMLElement;
      return root.className;
    });
    expect(classes).toContain('vg-theme-quartz-dark');
    expect(classes).not.toContain('vg-theme-quartz '); // boundary check: not the light class
  });

  test('vg-theme-auto pill lands and the auto class is on the root', async ({ page }) => {
    await gotoFeature(page, 'theming');
    await page.getByTestId('btn-theme-auto').click();
    const classes: string = await page.evaluate(() => {
      const root = document.querySelector('.vg-grid') as HTMLElement;
      return root.className;
    });
    expect(classes).toContain('vg-theme-auto');
  });

  test('color picker write lands as an inline --vg-* style on the grid root', async ({ page }) => {
    await gotoFeature(page, 'theming');
    // Use the page's API to call setThemeParams (avoids fiddly color-picker
    // simulation across browsers).
    await page.evaluate(() => {
      (window as any).__cgrid.setThemeParams({ '--vg-header-bg': '#0f172a' });
    });
    const inlineStyle: string = await page.evaluate(() => {
      const root = document.querySelector('.vg-grid') as HTMLElement;
      return root.style.getPropertyValue('--vg-header-bg');
    });
    expect(inlineStyle).toBe('#0f172a');
  });

  test('reset tokens clears the inline overrides', async ({ page }) => {
    await gotoFeature(page, 'theming');
    await page.evaluate(() => {
      (window as any).__cgrid.setThemeParams({
        '--vg-header-bg': '#0f172a',
        '--vg-row-height': '40px',
      });
    });
    await page.getByTestId('btn-reset-tokens').click();
    const remaining: Record<string, string> = await page.evaluate(() => {
      return (window as any).__cgrid.getThemeParams();
    });
    expect(remaining).toEqual({});
  });

  test('shadow-root toggle re-mounts the grid inside a shadow tree', async ({ page }) => {
    await gotoFeature(page, 'theming');
    const beforeShadow: boolean = await page.evaluate(() => {
      const host = document.querySelector('#grid-host') as HTMLElement;
      return host.shadowRoot !== null;
    });
    expect(beforeShadow).toBe(false);

    await page.getByTestId('btn-shadow-root').click();
    // Wait for re-construction.
    await page.waitForFunction(() => {
      const host = document.querySelector('#grid-host') as HTMLElement;
      return host.shadowRoot !== null
        && host.shadowRoot.querySelector('.vg-grid') !== null;
    }, { timeout: 5000 });

    const styleEl: boolean = await page.evaluate(() => {
      const host = document.querySelector('#grid-host') as HTMLElement;
      return host.shadowRoot!.querySelector('style.vg-shadow-tokens') !== null;
    });
    expect(styleEl).toBe(true);
  });
});
