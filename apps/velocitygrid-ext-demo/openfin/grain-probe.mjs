// Grain benchmark probe (Cycle 22 Task 0): drives bench/raster-grain.html
// through all rasterization modes over CDP and prints a markdown matrix.
//
// Usage: node grain-probe.mjs <regime>
//   chrome           — launches stock Chrome (playwright channel 'chrome')
//   chrome-swraster  — same + --disable-gpu
//   openfin          — connects to an already-launched OpenFin on CDP :9223
//                      (launch first: env -u ELECTRON_RUN_AS_NODE openfin
//                       --launch --config openfin/app-bench.json)
//   openfin-swraster — same connection; launch with app-bench-swraster.json
//
// Serve the built demo first: npm run build && npx vite preview --port 4188
// Per mode: fresh page load, 120-frame warm-up per phase (discarded), then
// 600 measured frames of scroll and 600 of ticks.
import { chromium } from 'playwright-core';

const regime = process.argv[2];
const REGIMES = ['chrome', 'chrome-swraster', 'openfin', 'openfin-swraster'];
if (!REGIMES.includes(regime)) {
  console.error(`usage: node grain-probe.mjs <${REGIMES.join('|')}>`);
  process.exit(1);
}

const BASE = 'http://localhost:4188/bench/raster-grain.html';
const MODES = [
  ['fillText', 'mode=fillText'],
  ['glyphAtlas', 'mode=glyphAtlas'],
  ['cellBlit', 'mode=cellBlit'],
  ['cellBlit+strips', 'mode=cellBlit&strips=1'],
];
const WARM_FRAMES = 120;
const FRAMES = 600;

let browser;
let page;
let ownBrowser = false;

if (regime.startsWith('chrome')) {
  const args = [];
  if (regime === 'chrome-swraster') args.push('--disable-gpu');
  browser = await chromium.launch({ headless: false, channel: 'chrome', args });
  page = await browser.newPage({ viewport: { width: 1680, height: 960 }, deviceScaleFactor: 2 });
  ownBrowser = true;
} else {
  browser = await chromium.connectOverCDP('http://localhost:9223');
  for (const c of browser.contexts()) {
    for (const p of c.pages()) {
      if (p.url().includes('raster-grain') || p.url().includes('localhost:4188')) page = p;
    }
  }
  if (!page) throw new Error('bench page not found among CDP targets on :9223');
}

const results = [];
let dpr = null;
for (const [label, qs] of MODES) {
  await page.goto(`${BASE}?${qs}`);
  await page.waitForFunction(() => !!window.__bench, null, { timeout: 20000 });
  dpr = await page.evaluate(() => devicePixelRatio);
  // warm-up per phase — discarded (JIT, font raster, cache fill)
  await page.evaluate(async (w) => {
    await window.__bench.runScroll(w);
    await window.__bench.runTicks(w);
  }, WARM_FRAMES);
  const scroll = await page.evaluate((f) => window.__bench.runScroll(f), FRAMES);
  const ticks = await page.evaluate((f) => window.__bench.runTicks(f), FRAMES);
  results.push({ label, scroll, ticks });
  console.error(`  measured ${label}`);
}

const fmt = (v) => (typeof v === 'number' ? v.toFixed(1) : String(v));
console.log(`\n#### ${regime} (dpr ${dpr}, ${FRAMES} frames/phase, ${WARM_FRAMES}-frame warm-up discarded)\n`);
console.log('| mode | phase | paint p50 (ms) | paint p95 (ms) | paint worst (ms) | frame worst (ms) | frames >50ms |');
console.log('|------|-------|---------------:|---------------:|-----------------:|-----------------:|-------------:|');
for (const r of results) {
  for (const phase of ['scroll', 'ticks']) {
    const s = r[phase];
    console.log(
      `| ${r.label} | ${phase} | ${fmt(s.paintMsP50)} | ${fmt(s.paintMsP95)} | ${fmt(s.paintMsWorst)} | ${fmt(s.frameMsWorst)} | ${s.longFrames} |`
    );
  }
}
console.log('\n<!-- raw: ' + JSON.stringify({ regime, dpr, results }) + ' -->');

if (ownBrowser) await browser.close();
else await browser.close(); // disconnects CDP; OpenFin itself is killed by the runner
