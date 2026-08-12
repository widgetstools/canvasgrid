/**
 * Paint-cadence regression lock for `VelocityGridCanvas.tickPaint`.
 *
 * The gate used to be `elapsed > interval`, which on the dominant
 * 60Hz-display + 60fps-cap combination failed on every rAF tick that landed
 * a hair under 16.667ms — deferring an already-dirty frame to the next tick.
 * That produced an IRREGULAR 16.7/33.3/16.7/33.3 paint rhythm (scroll
 * judder), not a clean 30fps. These tests pin the three properties the fix
 * has to hold simultaneously:
 *
 *   1. no dropped frames when the cap matches the display refresh,
 *   2. the cap is still enforced when it is BELOW the refresh rate,
 *   3. the long-run rate converges on the cap when the two don't divide
 *      evenly (the grid-advance property).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { VelocityGridCanvas } from '../src/core/canvas';
import type { PaintComponent } from '../src/core/canvas';

beforeAll(() => {
  // Keep the module-level rAF loop inert — these tests drive tickPaint by
  // hand so the cadence under test is fully deterministic.
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  HTMLCanvasElement.prototype.getContext = (() => {
    const make = () => ({
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(),
      scale: vi.fn(), drawImage: vi.fn(),
      measureText: () => ({ width: 10 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    });
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) { ctx = make(); perCanvas.set(this, ctx); }
      return ctx;
    };
  })() as any;
});

/** Build a canvas whose paints are counted, with the RAF loop inert. */
function makeCanvas(fpsCap?: number) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let paints = 0;
  const component: PaintComponent = {
    setBounds: () => {},
    paint: () => { paints += 1; },
  };
  const cv = new VelocityGridCanvas(host, component, {
    fpsCap,
    useHiDPI: false,
    measureSize: () => ({ width: 400, height: 300 }),
  });
  // The constructor's synchronous first paint isn't part of the cadence.
  paints = 0;
  return {
    cv,
    paintCount: () => paints,
    /** Drive `ticks` rAF callbacks spaced `deltaMs` apart, always dirty. */
    run(ticks: number, deltaMs: number, startAt = deltaMs) {
      let t = startAt;
      for (let i = 0; i < ticks; i += 1) {
        cv.requestRepaint();
        cv.tickPaint(t);
        t += deltaMs;
      }
    },
    dispose() { cv.destroy(); host.remove(); },
  };
}

describe('VelocityGridCanvas.tickPaint — fps gate cadence', () => {
  it('does not drop ready frames when the cap matches a 60Hz display', () => {
    // A true 60Hz display delivers exactly the interval a 60fps cap computes.
    // The old `elapsed > interval` test is false at equality, so this is the
    // case it degraded worst — every dirty tick must paint now.
    const h = makeCanvas(60);
    h.run(60, 1000 / 60);
    expect(h.paintCount()).toBe(60);
    h.dispose();
  });

  it('holds ~full rate on a display running a hair fast (the judder case)', () => {
    // 16.6ms deltas are a 60.24Hz panel. A 60fps cap legitimately drops the
    // occasional frame here (~59/60), but the OLD gate dropped every OTHER
    // frame — an irregular 30fps rhythm. Anything near 60 proves the fix;
    // the upper bound proves the cap is still real.
    const h = makeCanvas(60);
    h.run(60, 16.6);
    expect(h.paintCount()).toBeGreaterThanOrEqual(58);
    expect(h.paintCount()).toBeLessThanOrEqual(60);
    h.dispose();
  });

  it('still enforces a cap that is BELOW the display refresh rate', () => {
    // 30fps cap driven by a 60Hz rAF → every other tick, not every tick.
    const h = makeCanvas(30);
    h.run(60, 1000 / 60);
    expect(h.paintCount()).toBe(30);
    h.dispose();
  });

  it('converges on the cap when refresh and cap do not divide evenly', () => {
    // 60fps cap on a 144Hz display (6.944ms deltas). Snapping
    // `lastRepaintTime` to `now` would settle near 48fps; advancing on the
    // interval grid converges on ~60 paints per simulated second.
    const h = makeCanvas(60);
    h.run(144, 1000 / 144);
    expect(h.paintCount()).toBeGreaterThanOrEqual(57);
    expect(h.paintCount()).toBeLessThanOrEqual(63);
    h.dispose();
  });

  it('never paints while clean, however much time passes', () => {
    const h = makeCanvas(60);
    let t = 16.6;
    for (let i = 0; i < 30; i += 1) { h.cv.tickPaint(t); t += 16.6; }
    expect(h.paintCount()).toBe(0);
    h.dispose();
  });

  it('re-anchors after a long stall instead of burst-painting the backlog', () => {
    // A 500ms stall (tab throttle / long task) is >2 intervals behind the
    // grid, so the gate re-anchors to `now`. The tick right after the stall
    // must NOT immediately paint again to "catch up".
    const h = makeCanvas(60);
    h.run(3, 16.6);
    expect(h.paintCount()).toBe(3);

    h.cv.requestRepaint();
    h.cv.tickPaint(500);
    expect(h.paintCount()).toBe(4);

    // Only ~2ms later — far inside the interval — must be skipped.
    h.cv.requestRepaint();
    h.cv.tickPaint(502);
    expect(h.paintCount()).toBe(4);

    // A full interval after the stall paints again, normal cadence resumed.
    h.cv.requestRepaint();
    h.cv.tickPaint(517);
    expect(h.paintCount()).toBe(5);
    h.dispose();
  });

  it('fpsCap of 0 disables scheduled painting entirely', () => {
    const h = makeCanvas(0);
    h.run(30, 16.6);
    expect(h.paintCount()).toBe(0);
    h.dispose();
  });
});
