/**
 * Scroll smoothness probe — hermetic `?paintHarness` + synthetic N rows
 * (no STOMP). Reports FPS / longtasks / getPaintStats for:
 *   - steady (idle)
 *   - realistic wheel (~1 notch / 120ms)
 *   - aggressive wheel (every 16ms — stress, not a real user)
 *
 * Soft thresholds fail the test when clearly janky; always log the JSON
 * report for before/after comparisons.
 */
import { test, expect, type Page } from '@playwright/test';

const ROW_COUNT = Number(process.env.SCROLL_SMOOTH_ROWS || 20_000);
const STEADY_MS = 4_000;
const SCROLL_MS = 5_000;

type FpsSample = {
  fps: number;
  frames: number;
  longTasks: number;
  longTaskMs: number;
  worstLongTaskMs: number;
};

type PaintSample = {
  paints: number;
  fullPaints: number;
  partialPaints: number;
  presents: number;
  blits: number;
  avgPaintMs: number;
  worstPaintMs?: number;
  layerShifts?: number;
  layerSyncFills?: number;
};

type SmoothReport = {
  rowCount: number;
  dpr: number;
  gpu?: { vendor: string | null; renderer: string };
  /** Same heuristic as kernel `isSoftwareCanvasRaster` (WebGL renderer sniff). */
  softwareRaster: boolean;
  steady: FpsSample;
  steadyPaint: PaintSample;
  realistic: FpsSample;
  realisticPaint: PaintSample;
  aggressive: FpsSample;
  aggressivePaint: PaintSample;
};

async function seedRows(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => {
    const base = Array.from({ length: Math.min(200, count) }, (_, i) => ({
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
    for (let i = 0; i < count; i++) {
      const b = base[i % base.length]!;
      rows.push({ ...b, positionId: `ROW-${String(i).padStart(6, '0')}` });
    }
    (window as any).__ext.setRowData(rows);
  }, n);
  await page.waitForFunction(
    (count) => {
      const m = /Total Rows:\s*([\d,]+)/.exec(document.body.textContent || '');
      if (!m) return false;
      return Number(m[1]!.replace(/,/g, '')) >= count;
    },
    n,
    { timeout: 60_000 },
  );
}

async function measure(page: Page): Promise<SmoothReport> {
  return page.evaluate(
    async ({ steadyMs, scrollMs }) => {
      const grid = (window as any).__ext.grid as {
        resetPaintStats: () => void;
        getPaintStats: () => PaintSample;
      };

      const measureFps = (ms: number): Promise<FpsSample> =>
        new Promise((res) => {
          let frames = 0;
          const lt: number[] = [];
          let po: PerformanceObserver | null = null;
          try {
            po = new PerformanceObserver((list) => {
              for (const e of list.getEntries()) lt.push(Math.round(e.duration));
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

      const wheelScroll = async (ms: number, intervalMs: number, deltaY: number) => {
        const canvas = document.querySelector('.cg-canvas') as HTMLElement | null;
        if (!canvas) throw new Error('no .cg-canvas');
        const r = canvas.getBoundingClientRect();
        let dir = 1;
        let sent = 0;
        const wheel = setInterval(() => {
          canvas.dispatchEvent(
            new WheelEvent('wheel', {
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
              deltaY: deltaY * dir,
              bubbles: true,
              cancelable: true,
            }),
          );
          if (++sent % 40 === 0) dir = -dir;
        }, intervalMs);
        const fps = await measureFps(ms);
        clearInterval(wheel);
        return fps;
      };

      const paintSnap = (): PaintSample => {
        const s = grid.getPaintStats() as PaintSample & Record<string, number>;
        return {
          paints: s.paints,
          fullPaints: s.fullPaints,
          partialPaints: s.partialPaints,
          presents: s.presents ?? 0,
          blits: s.blits,
          avgPaintMs: s.avgPaintMs,
          worstPaintMs: (s as any).worstPaintMs,
          layerShifts: (s as any).layerShifts,
          layerSyncFills: (s as any).layerSyncFills,
        };
      };

      let gpu: SmoothReport['gpu'];
      try {
        const c = document.createElement('canvas');
        const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info') as {
            UNMASKED_VENDOR_WEBGL: number;
            UNMASKED_RENDERER_WEBGL: number;
          } | null;
          gpu = {
            vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
            renderer: dbg
              ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
              : String(gl.getParameter(gl.RENDERER)),
          };
        } else {
          gpu = { vendor: null, renderer: 'no-webgl' };
        }
      } catch (e) {
        gpu = { vendor: null, renderer: String(e) };
      }
      // Mirror packages/kernel/src/core/paintQuality.ts SOFTWARE_RENDERER_RE
      const softwareRaster = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|gdi generic|mesa offscreen|cpu rasterizer/i
        .test(gpu?.renderer ?? '');

      grid.resetPaintStats();
      const steady = await measureFps(steadyMs);
      const steadyPaint = paintSnap();

      grid.resetPaintStats();
      const realistic = await wheelScroll(scrollMs, 120, 40);
      const realisticPaint = paintSnap();

      grid.resetPaintStats();
      const aggressive = await wheelScroll(scrollMs, 16, 120);
      const aggressivePaint = paintSnap();

      return {
        dpr: devicePixelRatio,
        gpu,
        softwareRaster,
        steady,
        steadyPaint,
        realistic,
        realisticPaint,
        aggressive,
        aggressivePaint,
      };
    },
    { steadyMs: STEADY_MS, scrollMs: SCROLL_MS },
  ).then((r) => ({ ...r, rowCount: ROW_COUNT }));
}

test.describe('scroll smoothness (@perf)', () => {
  test.setTimeout(120_000);

  test('20k paintHarness — steady + realistic + aggressive wheel metrics', async ({ page }) => {
    await page.goto('/?paintHarness&noFlash');
    await page.waitForFunction(() => (window as any).__ext?.grid, null, { timeout: 60_000 });
    await seedRows(page, ROW_COUNT);
    await page.waitForTimeout(1_500);

    const report = await measure(page);
    // Always print — this is the deliverable.
    console.log('\n[scroll-smoothness]\n' + JSON.stringify(report, null, 2));
    console.log(
      `[scroll-smoothness] softwareRaster=${report.softwareRaster} renderer=${report.gpu?.renderer ?? 'n/a'}`,
    );

    // Soft GL hosts miss 60fps more often — keep floors lower there.
    const soft = report.softwareRaster;
    const steadyFloor = soft ? 25 : 45;
    const realisticFloor = soft ? 20 : 40;

    // Steady should be near the display refresh (Playwright often ~60).
    expect(report.steady.fps, 'steady fps').toBeGreaterThanOrEqual(steadyFloor);
    expect(report.steady.worstLongTaskMs, 'steady worst longtask').toBeLessThan(soft ? 200 : 80);

    // Realistic scroll is the user-relevant bar (PERF-NOTES).
    expect(report.realistic.fps, 'realistic scroll fps').toBeGreaterThanOrEqual(realisticFloor);
    expect(report.realistic.worstLongTaskMs, 'realistic worst longtask').toBeLessThan(soft ? 250 : 100);
    if (report.realisticPaint.paints > 0) {
      const fullFrac = report.realisticPaint.fullPaints / report.realisticPaint.paints;
      // Informational: lean/hybrid paths can full-paint often and still hit
      // frame budget — FPS + longtasks are the smoothness signal.
      console.log(`[scroll-smoothness] realistic fullPaintFraction=${fullFrac.toFixed(3)} avgPaintMs=${report.realisticPaint.avgPaintMs.toFixed(1)}`);
    }

    // Aggressive is stress-only — soft floor so CI doesn't flake on software GL.
    expect(report.aggressive.fps, 'aggressive scroll fps (stress)').toBeGreaterThanOrEqual(20);
    console.log(
      `[scroll-smoothness] verdict: steady=${report.steady.fps}fps ` +
        `realistic=${report.realistic.fps}fps aggressive=${report.aggressive.fps}fps ` +
        `longTasks=${report.realistic.longTasks}/${report.aggressive.longTasks}`,
    );
  });
});
