/**
 * Scroll performance probe for velocitygrid-ext-demo.
 *
 * Boots ?paintHarness (hermetic data), expands to N rows, then measures:
 *   - steady-state FPS / longtasks (6s)
 *   - continuous wheel-scroll FPS / longtasks (6s)
 *   - VelocityGrid getPaintStats() during the scroll window
 *
 * Usage:
 *   node openfin/scroll-measure.mjs [baseUrl] [rowCount]
 * Defaults: http://localhost:4188  20000
 */
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] || 'http://localhost:4188';
const rowCount = Number(process.argv[3] || 20000);
const exe = process.env.CHROME_PATH;
// HEADED=1 (default for fair GPU comparison) uses a visible Chrome window so
// chrome://settings "Use graphics acceleration" applies. Headless often
// falls back to SwiftShader / software GL.
const headed = process.env.HEADED !== '0';

const browser = await chromium.launch({
  headless: !headed,
  channel: exe ? undefined : 'chrome',
  executablePath: exe || undefined,
  args: headed ? ['--ignore-gpu-blocklist'] : undefined,
});
const page = await browser.newPage({
  viewport: { width: 1680, height: 960 },
  deviceScaleFactor: 2,
});

const trimmed = baseUrl.replace(/\/$/, '');
const url = /[?&]paintHarness\b/.test(trimmed)
  ? trimmed
  : `${trimmed}${trimmed.includes('?') ? '&' : '?'}paintHarness`;
console.error(`[scroll-measure] goto ${url} rows=${rowCount}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__ext?.grid, null, { timeout: 60000 });
await page.waitForFunction(
  () => /Total Rows:\s*[1-9]/.test(document.body.textContent || ''),
  null,
  { timeout: 30000 },
);

// Expand harness to a larger synthetic dataset for sustained scroll.
await page.evaluate((n) => {
  const base = Array.from({ length: Math.min(200, n) }, (_, i) => ({
    positionId: `HARNESS-${String(i).padStart(4, '0')}`,
    cusip: `CUSIP${String(i).padStart(5, '0')}`,
    ticker: `TICK${i % 40}`,
    notionalAmount: 1_000_000 + i * 1000,
    marketValue: 1_000_000 + i * 900,
    currentPrice: 100 + (i % 50) * 0.1,
    pnl: (i % 7) * 1000,
    dailyPnl: (i % 5) * 100,
    unrealizedPnl: (i % 9) * 200,
    yield: (i % 80) / 10,
    spread: i % 300,
    dv01: i % 5000,
    pv01: i % 5000,
  }));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const b = base[i % base.length];
    rows.push({ ...b, positionId: `ROW-${String(i).padStart(6, '0')}` });
  }
  window.__ext.setRowData(rows);
}, rowCount);

await page.waitForFunction(
  (n) => {
    const m = /Total Rows:\s*([\d,]+)/.exec(document.body.textContent || '');
    if (!m) return false;
    return Number(m[1].replace(/,/g, '')) >= n;
  },
  rowCount,
  { timeout: 60000 },
);
await page.waitForTimeout(2000);

const metrics = await page.evaluate(async () => {
  const grid = window.__ext.grid;

  const measureFps = (ms) =>
    new Promise((res) => {
      let frames = 0;
      const lt = [];
      let po;
      try {
        po = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) lt.push(Math.round(e.duration));
        });
        po.observe({ entryTypes: ['longtask'] });
      } catch {
        po = null;
      }
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else {
          po?.disconnect();
          res({
            fps: Math.round(frames / (ms / 1000)),
            frames,
            longTasks: lt.length,
            longTaskMs: lt.reduce((a, b) => a + b, 0),
            worstLongTaskMs: lt.length ? Math.max(...lt) : 0,
          });
        }
      };
      requestAnimationFrame(tick);
    });

  const out = {
    dpr: devicePixelRatio,
    viewport: { w: innerWidth, h: innerHeight },
    rowCountLabel: document.body.textContent.match(/Total Rows:\s*([\d,]+)/)?.[1] ?? null,
  };

  grid.resetPaintStats();
  out.steady = await measureFps(6000);
  out.steadyPaint = { ...grid.getPaintStats() };

  grid.resetPaintStats();
  const canvas = document.querySelector('.vg-canvas');
  if (!canvas) throw new Error('no .vg-canvas');
  const r = canvas.getBoundingClientRect();
  let dir = 1;
  let sent = 0;
  const wheel = setInterval(() => {
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        deltaY: 120 * dir,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (++sent % 40 === 0) dir = -dir;
  }, 16);

  out.scroll = await measureFps(6000);
  clearInterval(wheel);
  out.scrollPaint = { ...grid.getPaintStats() };

  // GPU / acceleration fingerprint for before/after comparisons.
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.gpu = {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    } else {
      out.gpu = { vendor: null, renderer: 'no-webgl' };
    }
  } catch (e) {
    out.gpu = { vendor: null, renderer: String(e) };
  }

  if (performance.memory) {
    out.heapUsedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
  }
  return out;
});

const result = {
  label: 'cgrid-scroll-measure',
  baseUrl: url,
  rowCount,
  measuredAt: new Date().toISOString(),
  platform: process.platform,
  headed,
  ...metrics,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
