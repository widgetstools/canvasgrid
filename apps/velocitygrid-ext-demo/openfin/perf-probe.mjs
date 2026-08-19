// Performance probe for the velocitygrid-ext-demo hosted in OpenFin (CDP :9223).
// Measures: boot-to-ready, steady-state FPS under live STOMP ticks, long
// tasks, scroll FPS during continuous programmatic scrolling, heap size.
// Usage: node of-perf.mjs <cdp-port> <label>
import { chromium } from 'playwright-core';

const port = process.argv[2] ?? '9223';
const label = process.argv[3] ?? 'openfin';

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const contexts = browser.contexts();
let page = null;
for (const c of contexts) {
  for (const p of c.pages()) {
    if (p.url().includes('localhost:4188')) page = p;
  }
}
if (!page) throw new Error('demo page not found among CDP targets');

await page.waitForFunction(() => window.__ext && document.querySelector('.vgext-ribbon-band'), null, { timeout: 30000 });

const metrics = await page.evaluate(async () => {
  const out = {};
  // nav timing
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) out.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd - nav.startTime);

  const measureFps = (ms) => new Promise((res) => {
    let frames = 0;
    const lt = [];
    const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) lt.push(Math.round(e.duration)); });
    try { po.observe({ entryTypes: ['longtask'] }); } catch {}
    const t0 = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else { po.disconnect(); res({ fps: Math.round(frames / (ms / 1000)), longTasks: lt.length, longTaskMs: lt.reduce((a, b) => a + b, 0), worstMs: Math.max(0, ...lt) }); }
    };
    requestAnimationFrame(tick);
  });

  // 1. steady state with live STOMP ticks
  out.steady = await measureFps(6000);

  // 2. continuous scroll: drive the grid's scroll surface with wheel events
  const canvas = document.querySelector('.vg-canvas');
  const r = canvas.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dir = 1, sent = 0;
  const wheeler = setInterval(() => {
    canvas.dispatchEvent(new WheelEvent('wheel', { clientX: cx, clientY: cy, deltaY: 120 * dir, bubbles: true, cancelable: true }));
    if (++sent % 40 === 0) dir = -dir;
  }, 16);
  out.scroll = await measureFps(6000);
  clearInterval(wheeler);

  // heap
  if (performance.memory) {
    out.heapUsedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    out.heapTotalMB = Math.round(performance.memory.totalJSHeapSize / 1048576);
  }
  out.rows = window.__ext.grid.getDisplayedRowCount?.() ?? null;
  out.dpr = devicePixelRatio;
  return out;
});

console.log(JSON.stringify({ label, ...metrics }, null, 1));
await browser.close();
