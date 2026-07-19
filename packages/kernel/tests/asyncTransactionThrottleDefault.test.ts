/**
 * Cycle 26 (W3) — the grid's live-update rate cap defaults ON.
 *
 * `asyncTransactionThrottleMillis` (worker-side flush spacing, mechanics
 * locked in rowStore.test.ts) previously defaulted to 0/off. It now
 * defaults to 200ms — at most 5 grid updates per second under a
 * continuous stream — with values clamped to the Grid Options editor's
 * [100, 1000] range and an explicit programmatic 0 as the off switch.
 * Isolated updates are unaffected: after a quiet period the first flush
 * still lands after the wait debounce alone.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import { buildGridOptionsSchema } from '../src/core/optionSchema';
import type { CGridOptions } from '../src/types/options';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
  // FIRING rAF mock (not the usual no-op counter): WorkerClient coalesces
  // push messages (asyncTransactionsFlushed / modelUpdated) and dispatches
  // them on requestAnimationFrame — with a never-firing mock the events
  // this suite counts would never reach the grid.
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) { ctx = { ...fakeCtx, canvas: this }; perCanvas.set(this, ctx); }
      return ctx;
    };
  })() as any;
});

function buildWiredGrid(opts: Partial<CGridOptions<{ id: string; v: number }>> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: any) { this.host.handle(msg); }
    addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
    terminate() {}
  };
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, v: i }));
  const grid = new CGrid(container, {
    columnDefs: [{ field: 'id' }, { field: 'v', type: 'number' }],
    getRowId: (r) => r.id,
    rowData: rows,
    ...opts,
  });
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, g: grid as any, restore };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('resolveAsyncThrottleMillis — default + clamping', () => {
  it('omitted resolves to 200 (5 updates/second cap)', () => {
    const { g, grid, restore } = buildWiredGrid();
    expect(g.resolveAsyncThrottleMillis()).toBe(200);
    grid.destroy(); restore();
  });

  it('explicit 0 stays 0 — the programmatic off switch', () => {
    const { g, grid, restore } = buildWiredGrid({ asyncTransactionThrottleMillis: 0 });
    expect(g.resolveAsyncThrottleMillis()).toBe(0);
    grid.destroy(); restore();
  });

  it('clamps below-range to 100 and above-range to 1000', () => {
    const low = buildWiredGrid({ asyncTransactionThrottleMillis: 30 });
    expect(low.g.resolveAsyncThrottleMillis()).toBe(100);
    low.grid.destroy(); low.restore();
    const high = buildWiredGrid({ asyncTransactionThrottleMillis: 5000 });
    expect(high.g.resolveAsyncThrottleMillis()).toBe(1000);
    high.grid.destroy(); high.restore();
  });

  it('in-range values pass through', () => {
    const { g, grid, restore } = buildWiredGrid({ asyncTransactionThrottleMillis: 350 });
    expect(g.resolveAsyncThrottleMillis()).toBe(350);
    grid.destroy(); restore();
  });

  it('runtime setGridOption re-resolves through the same clamp', () => {
    const { grid, g, restore } = buildWiredGrid();
    grid.setGridOption('asyncTransactionThrottleMillis', 40);
    expect(g.resolveAsyncThrottleMillis()).toBe(100);
    grid.setGridOption('asyncTransactionThrottleMillis', 500);
    expect(g.resolveAsyncThrottleMillis()).toBe(500);
    grid.destroy(); restore();
  });
});

describe('default-on behavior (continuous stream capped, isolated update prompt)', () => {
  it('a continuous tick stream is capped at ~5 flushes/second', async () => {
    // waitMillis 10 so the UNcapped baseline would flush every ~10-25ms
    // (≈8-10 flushes for this stream) — the 200ms default cap is the only
    // thing keeping the count low. Load-proof: the bound derives from the
    // MEASURED elapsed wall time, not the loop's nominal pace.
    const { grid, restore } = buildWiredGrid({ asyncTransactionWaitMillis: 10 });
    await tick(60); // initial rowData settled
    let updates = 0;
    grid.on('asyncTransactionsFlushed', () => { updates += 1; });
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      grid.applyTransactionAsync({ update: [{ id: 'r1', v: 100 + i }] });
      await tick(12);
    }
    await tick(300); // let the trailing conflated flush land
    const elapsed = performance.now() - t0;
    // At most one flush per 200ms window (+1 slack for the rAF-coalesced
    // event dispatch straddling a boundary under load).
    expect(updates).toBeLessThanOrEqual(Math.ceil(elapsed / 200) + 1);
    expect(updates).toBeGreaterThanOrEqual(1);
    grid.destroy(); restore();
  });

  it('an isolated update after a quiet period flushes after just the wait debounce', async () => {
    const { grid, restore } = buildWiredGrid();
    await tick(250); // initial load + a full quiet throttle window
    let updates = 0;
    grid.on('asyncTransactionsFlushed', () => { updates += 1; });
    grid.applyTransactionAsync({ update: [{ id: 'r2', v: 999 }] });
    // Wait debounce is 50ms — well under the 200ms cap; the flush must
    // NOT be delayed by the throttle after a quiet period. 150ms is past
    // the debounce (plus load slack) but before a throttled 200ms slot
    // could have produced it, so ===1 stays discriminating.
    await tick(150);
    expect(updates).toBe(1);
    grid.destroy(); restore();
  });

  it('explicit 0 restores uncapped flushing', async () => {
    const { grid, restore } = buildWiredGrid({
      asyncTransactionThrottleMillis: 0,
      asyncTransactionWaitMillis: 10,
    });
    await tick(60);
    let updates = 0;
    grid.on('asyncTransactionsFlushed', () => { updates += 1; });
    for (let i = 0; i < 4; i++) {
      grid.applyTransactionAsync({ update: [{ id: 'r1', v: i }] });
      await tick(40);
    }
    expect(updates).toBeGreaterThanOrEqual(3);
    grid.destroy(); restore();
  });
});

describe('Grid Options editor entry', () => {
  it('offers the clamped range with the 200ms default', () => {
    const section = buildGridOptionsSchema({
      getGridOption: () => undefined,
      setGridOption: () => {},
    });
    const bands = (section as unknown as { bands?: Array<{ fields: unknown[] }> }).bands
      ?? (section as unknown as { sections?: Array<{ fields: unknown[] }> }).sections
      ?? [];
    const fields = (bands as Array<{ fields: Array<Record<string, unknown>> }>)
      .flatMap((b) => b.fields);
    const field = fields.find((f) => f.key === 'asyncTransactionThrottleMillis') as {
      min: number; max: number; defaultValue: unknown; get: () => unknown;
    };
    expect(field).toBeDefined();
    expect(field.min).toBe(100);
    expect(field.max).toBe(1000);
    // With no app-configured value, the editor baseline + live value both
    // show the 200ms kernel default.
    expect(field.defaultValue).toBe(200);
    expect(field.get()).toBe(200);
  });
});
