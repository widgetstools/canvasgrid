/**
 * Phase 1 headless smoke — requires `npm run dev:ssrm-demo` on :5191.
 *
 *   node apps/cgrid-ssrm-demo/scripts/phase1-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.SSRM_DEMO_URL ?? 'http://localhost:5191/?quality=performance&feed=seed';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(120_000);

const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

console.log('open', BASE);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });

await page.waitForFunction(() => {
  const t = window.__ssrmDemo?.latest?.();
  return t && t.phase === 'live' && t.bookSize >= 10_000;
}, null, { timeout: 90_000 });

// Scroll each blotter body top → bottom → top.
const blotters = page.locator('.blotter-body');
const n = await blotters.count();
for (let i = 0; i < n; i++) {
  const el = blotters.nth(i);
  await el.evaluate((node) => {
    const canvas = node.querySelector('canvas') ?? node;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 4000, bubbles: true }));
  });
  await page.waitForTimeout(200);
  await el.evaluate((node) => {
    const canvas = node.querySelector('canvas') ?? node;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -4000, bubbles: true }));
  });
  await page.waitForTimeout(200);
}

const result = await page.evaluate(async () => {
  return window.__ssrmDemo.validatePhase1();
});

await browser.close();

console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) {
  console.error('console errors:', consoleErrors.slice(0, 10));
}
if (!result.ok) {
  process.exit(1);
}
console.log('Phase 1 smoke: PASS');
