// Customizer modules smoke: conditional-styling + calculated-columns
// settings modules, CM6 editor, and grid-config persistence.
import { chromium } from 'playwright';
import { launchChromium } from '../../../scripts/launch-chromium.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const URL = 'http://localhost:5188/?paintHarness';
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ext?.grid, null, { timeout: 30000 });
await wait(800);

// ── Conditional styling module ─────────────────────────────────────────
await page.evaluate(() => window.__ext.openSettings('conditional-styling'));
await page.waitForSelector('.ckp', { timeout: 10000 });
check('styling module mounts', true);

await page.click('.ckp .ckp-addbtn');
await page.waitForSelector('.ckp .cm-editor', { timeout: 10000 });
check('CM6 editor mounts', await page.locator('.ckp .cm-editor').count() > 0);

// Type a real condition into CodeMirror.
await page.click('.ckp .cm-content');
await page.keyboard.press('Control+a');
await page.keyboard.type('[pnl] > 0');
await page.keyboard.press('Escape'); // dismiss autocomplete if open
// Name the rule via the title input.
await page.fill('.ckp .ckp-title', 'Positive PnL');
// Pick a background color: set via the draft is UI-only — use the color input.
await page.evaluate(() => {
  const color = document.querySelector('.ckp .ckp-stylechrome .vgext-rb-colorinput');
  color.value = '#164a2e';
  color.dispatchEvent(new Event('input', { bubbles: true })); color.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.click('.ckp .ckp-actbtn:has-text(\"Save\")');
await wait(300);
const rules = await page.evaluate(() => window.__ext.grid.getRules());
check('rule saved through kernel API', rules.length === 1 && rules[0].name === 'Positive PnL', JSON.stringify(rules.map((r) => r.name)));
check('rule condition from CM6 editor', rules[0]?.condition === '[pnl] > 0', rules[0]?.condition);

// Invalid condition shows diagnostics + error box.
await page.click('.ckp .cm-content');
await page.keyboard.press('Control+a');
await page.keyboard.type('[nope] >');
await page.waitForSelector('.ckp .ckp-error:not([style*="display: none"])', { timeout: 5000 });
check('invalid expression surfaces error', true);
await page.click('.ckp .cm-content');
await page.keyboard.press('Control+a');
await page.keyboard.type('[pnl] > 0');
await wait(300);

// ── Calculated columns module ──────────────────────────────────────────
await page.evaluate(() => window.__ext.openSettings('calculated-columns'));
await page.waitForSelector('.ckp', { timeout: 10000 });
check('calc module mounts', true);

await page.click('.ckp .ckp-addbtn');
await page.waitForSelector('.ckp .cm-editor', { timeout: 10000 });
await page.fill('.ckp .ckp-title', 'PnL x2');
await page.click('.ckp .cm-content');
await page.keyboard.type('[pnl] * 2');
await page.keyboard.press('Escape');
await page.click('.ckp .ckp-actbtn:has-text(\"Save\")');
await wait(400);
const calcCol = await page.evaluate(() => {
  const cols = window.__ext.grid.getColumnState();
  return cols.find((c) => c.colId.startsWith('vcol_'))?.colId ?? null;
});
check('calculated column registered + folded into grid', !!calcCol, String(calcCol));

// ── Persistence: both ride the grid config across reload ───────────────
await page.evaluate(() => window.__ext.grid.persistStateNow?.() ?? null);
await wait(600); // profile autosave debounce
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ext?.grid, null, { timeout: 30000 });
await page.waitForFunction(
  () => window.__ext.grid.getRules().length === 1,
  null, { timeout: 15000 },
).catch(() => {});
const restored = await page.evaluate(() => ({
  rules: window.__ext.grid.getRules().map((r) => ({ name: r.name, condition: r.condition })),
  calc: window.__ext.grid.getColumnState().find((c) => c.colId.startsWith('vcol_'))?.colId ?? null,
}));
check('rules persist in grid config across reload', restored.rules.length === 1 && restored.rules[0].condition === '[pnl] > 0', JSON.stringify(restored.rules));
check('calc column persists in grid config across reload', !!restored.calc, String(restored.calc));

await page.screenshot({ path: 'test-results/customizer-smoke.png' });
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S): ${failures.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log('\nCUSTOMIZER SMOKE OK');
}

