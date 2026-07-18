/**
 * Live-tick deferral during body scroll: applyTransactionAsync is buffered
 * while scrolling and flushed on bodyScrollEnd; flash fade rAF is paused.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
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
  let rafId = 0;
  (globalThis as any).requestAnimationFrame = (_cb: () => void) => {
    rafId += 1;
    return rafId;
  };
  (globalThis as any).cancelAnimationFrame = () => {};
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
      if (!ctx) {
        ctx = { ...fakeCtx, canvas: this };
        perCanvas.set(this, ctx);
      }
      return ctx;
    };
  })() as any;
});

function buildWiredGrid(options: Partial<CGridOptions<{ id: string; v: number }>> = {}) {
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
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, v: i }));
  const grid = new CGrid(container, {
    columnDefs: [{ field: 'id' }, { field: 'v', type: 'number' }],
    getRowId: (r) => r.id,
    rowData: rows,
    paintCache: false,
    enableCellChangeFlash: true,
    ...options,
  });
  const g = grid as any;
  Object.defineProperty(g.scroller, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(g.root, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(g.root, 'clientHeight', { value: 600, configurable: true });
  g.cgridCanvas.resize();
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, g, restore };
}

describe('defer async transactions while scrolling', () => {
  it('buffers applyTransactionAsync during bodyScroll and flushes on bodyScrollEnd', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await new Promise((r) => setTimeout(r, 40));

    const spy = vi.spyOn(g.workerCoord, 'applyTransaction');
    g.onScrollerScroll(0, 200);
    expect(g.bodyScrollActive).toBe(true);

    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 999 }] });
    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 1000 }] }); // conflate
    grid.applyTransactionAsync({ update: [{ id: 'r1', v: 42 }] });
    // Still scrolling — nothing dispatched to the worker yet.
    expect(spy).not.toHaveBeenCalled();
    expect(g.deferredAsyncTxs.length).toBe(3);

    // bodyScrollEnd is debounced 200ms after the last scroll tick.
    await new Promise((r) => setTimeout(r, 250));
    expect(g.bodyScrollActive).toBe(false);
    expect(g.deferredAsyncTxs.length).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0]![0] as { update?: Array<{ id: string; v: number }> };
    expect(payload.update?.map((r) => r.id).sort()).toEqual(['r0', 'r1']);
    expect(payload.update?.find((r) => r.id === 'r0')?.v).toBe(1000);

    grid.destroy();
    restore();
  });

  it('applies immediately when deferAsyncTransactionsWhileScrolling is false', async () => {
    const { grid, g, restore } = buildWiredGrid({
      deferAsyncTransactionsWhileScrolling: false,
    });
    await new Promise((r) => setTimeout(r, 40));

    const spy = vi.spyOn(g.workerCoord, 'applyTransaction');
    g.onScrollerScroll(0, 200);
    grid.applyTransactionAsync({ update: [{ id: 'r0', v: 7 }] });
    expect(spy).toHaveBeenCalledTimes(1);

    grid.destroy();
    restore();
  });

  it('pauses flash fade rAF while bodyScroll is active', async () => {
    const { grid, g, restore } = buildWiredGrid();
    await new Promise((r) => setTimeout(r, 40));

    g.flashTickHandle = 42;
    g.onScrollerScroll(0, 100);
    expect(g.flashTickHandle).toBeNull();
    expect(g.flashPausedForScroll).toBe(true);

    g.startFlashTickLoop();
    // Still scrolling — must not schedule a competing fade frame.
    expect(g.flashTickHandle).toBeNull();
    expect(g.flashPausedForScroll).toBe(true);

    grid.destroy();
    restore();
  });
});
