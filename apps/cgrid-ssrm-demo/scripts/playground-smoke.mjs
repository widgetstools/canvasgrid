import { chromium } from 'playwright';
import { launchChromium } from '../../../scripts/launch-chromium.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:5191/playground.html', { waitUntil: 'domcontentloaded' });

await page.waitForFunction(() => window.__playground?.grid?.getDisplayedRowCount() >= 10000, null, { timeout: 60000 });
console.log('boot rows:', await page.evaluate(() => window.__playground.grid.getDisplayedRowCount()));

// Apply a desk filter that matches 1/5 of the seed book.
await page.fill('#filter', '[["desk","==","FX Spot"]]');
await page.fill('#rate', '80');
await page.click('form.cfg button');
for (let i = 0; i < 20; i++) {
  await wait(700);
  const s = await page.evaluate(() => ({
    n: window.__playground?.grid?.getDisplayedRowCount() ?? -1,
    status: document.getElementById('status').innerText.replace(/\s+/g, ' ').slice(0, 110),
  }));
  console.log(`t+${(i + 1) * 700}ms n=${s.n} | ${s.status}`);
  if (s.n === 2000) break;
}

// Invalid JSON → inline error.
await page.fill('#filter', 'not json');
await page.click('form.cfg button');
await wait(400);
console.log('invalid filter flagged:', await page.evaluate(() => document.querySelector('#filter').classList.contains('invalid')));

// Clear filter → full book.
await page.fill('#filter', '');
await page.click('form.cfg button');
await page.waitForFunction(() => window.__playground?.grid?.getDisplayedRowCount() >= 10000, null, { timeout: 60000 });
console.log('after clearing filter:', await page.evaluate(() => window.__playground.grid.getDisplayedRowCount()));
await page.screenshot({ path: 'test-results/playground.png' });
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'PLAYGROUND SMOKE OK');
await browser.close();
