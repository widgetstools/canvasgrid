import type { Page } from '@playwright/test';

export async function gotoFeature(page: Page, featureId: string): Promise<void> {
  await page.goto(`/?feature=${featureId}`);
  await page.waitForFunction(() => window.__cgridReady === true, { timeout: 10_000 });
}

export async function gridRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const grid = window.__cgrid;
    if (!grid) return 0;
    return (grid as any).rowCount ?? 0;
  });
}

export async function groupKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = window.__cgrid;
    if (!grid) return [];
    return (grid as any).getRowGroupColumns?.() ?? [];
  });
}
