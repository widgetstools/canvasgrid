import { test, expect } from '@playwright/test';

// Cycle 12 / Task 4 — proves the visual-regression harness wiring works:
// dev server starts (or is reused), the demo page mounts, `window.__cgrid`
// exists. Snapshots come in Task 5; this spec deliberately holds no PNGs so
// the harness can ship green before any baseline exists.
test('demo mounts and exposes __cgrid hook', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    undefined,
    { timeout: 20_000 },
  );
  const hasCgrid = await page.evaluate(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
  );
  expect(hasCgrid).toBe(true);
});
