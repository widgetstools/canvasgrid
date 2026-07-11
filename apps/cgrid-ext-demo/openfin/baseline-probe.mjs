// Baseline: same production build, same feed, in stock Chromium.
import { chromium } from 'playwright-core';
const exe = process.env.CHROME_PATH;
const browser = await chromium.launch({ headless: false, channel: exe ? undefined : 'chrome' });
const page = await browser.newPage({ viewport: { width: 1680, height: 960 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4188/');
await page.waitForFunction(() => window.__ext, null, { timeout: 30000 });
await page.waitForFunction(() => /Total Rows:\s*[1-9]/.test(document.body.textContent), null, { timeout: 20000 });
await page.waitForTimeout(8000); // settle like the openfin run
const metrics = await page.evaluate(async () => {
  const measureFps = (ms) => new Promise((res) => {
    let frames = 0; const lt = [];
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); });
    try { po.observe({ entryTypes: ['longtask'] }); } catch {}
    const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else { po.disconnect(); res({ fps: Math.round(frames / (ms / 1000)), longTasks: lt.length, longTaskMs: lt.reduce((a,b)=>a+b,0), worstMs: Math.max(0,...lt) }); } };
    requestAnimationFrame(tick);
  });
  const out = {};
  out.steady = await measureFps(6000);
  const canvas = document.querySelector('.cg-canvas');
  const r = canvas.getBoundingClientRect();
  let dir = 1, sent = 0;
  const w = setInterval(() => { canvas.dispatchEvent(new WheelEvent('wheel', { clientX: r.left+r.width/2, clientY: r.top+r.height/2, deltaY: 120*dir, bubbles: true, cancelable: true })); if (++sent % 40 === 0) dir = -dir; }, 16);
  out.scroll = await measureFps(6000);
  clearInterval(w);
  if (performance.memory) { out.heapUsedMB = Math.round(performance.memory.usedJSHeapSize/1048576); }
  out.dpr = devicePixelRatio;
  return out;
});
console.log(JSON.stringify({ label: 'chrome-baseline', ...metrics }, null, 1));
await browser.close();
