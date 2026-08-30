import { test, expect } from '@playwright/test';

/**
 * Seed-feed tick realism, end to end.
 *
 * Notional is a position's SIZE and must not move on a price tick. The live
 * tick used to rebuild whole rows with a freshly drawn notional, so the
 * Notional column churned — and with it every group / pivot total over it.
 *
 * Measured here before the fix: 7 of 25 visible positions changed notional
 * within 6s. The assertion is exact (zero changes) rather than a threshold,
 * because any change at all means the feed is re-sizing existing positions.
 */
test('notional holds still while prices tick', async ({ page }) => {
  await page.goto('/simple.html?feed=seed&worker=dedicated');
  await page.waitForFunction(() => (window as any).__simple !== undefined, { timeout: 30_000 });

  const res = await page.evaluate(async () => {
    const s = (window as any).__simple;
    await s.waitForRows(50, 30_000);
    const g = s.grid as any;
    const snap = (): Record<string, { notional: unknown; pnl: unknown }> => {
      const o: Record<string, { notional: unknown; pnl: unknown }> = {};
      for (let r = 0; r < 25; r++) {
        const id = g.getCellValue?.(r, 'positionId');
        if (id) {
          o[String(id)] = {
            notional: g.getCellValue?.(r, 'notionalAmount'),
            pnl: g.getCellValue?.(r, 'pnl'),
          };
        }
      }
      return o;
    };
    const before = snap();
    await new Promise((r) => setTimeout(r, 6000));
    const after = snap();

    let compared = 0; let notionalChanged = 0; let pnlChanged = 0;
    for (const id of Object.keys(before)) {
      if (!after[id]) continue;
      compared++;
      if (before[id]!.notional !== after[id]!.notional) notionalChanged++;
      if (before[id]!.pnl !== after[id]!.pnl) pnlChanged++;
    }
    return { compared, notionalChanged, pnlChanged };
  });

  expect(res.compared).toBeGreaterThan(10);
  expect(res.notionalChanged).toBe(0);
  // Guard against a dead feed making the check pass vacuously.
  expect(res.pnlChanged).toBeGreaterThan(0);
});
