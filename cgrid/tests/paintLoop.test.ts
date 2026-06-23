import { describe, it, expect, vi, afterEach } from 'vitest';
import { PaintLoop } from '../src/core/paintLoop';

const realRAF = globalThis.requestAnimationFrame;
const realCAF = globalThis.cancelAnimationFrame;

function mockRAF() {
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    callbacks.push(cb); return callbacks.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((_id: number) => {}) as typeof cancelAnimationFrame;
  return { tick: () => { const queued = callbacks.splice(0); queued.forEach((c) => c(performance.now())); } };
}

afterEach(() => { globalThis.requestAnimationFrame = realRAF; globalThis.cancelAnimationFrame = realCAF; });

describe('PaintLoop', () => {
  it('paints once per rAF after a markDirty', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    loop.markDirty({ x: 0, y: 0, w: 10, h: 10 });
    raf.tick();
    expect(paint).toHaveBeenCalledOnce();
    expect(paint.mock.calls[0]![0]).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });

  it('no-op when no dirty rects accumulated', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    raf.tick();
    expect(paint).not.toHaveBeenCalled();
  });

  it('coalesces multiple markDirty calls into one paint per frame', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    loop.markDirty({ x: 0, y: 0, w: 10, h: 10 });
    loop.markDirty({ x: 50, y: 0, w: 10, h: 10 });
    raf.tick();
    expect(paint).toHaveBeenCalledOnce();
    expect(paint.mock.calls[0]![0]).toHaveLength(2);
  });

  it('markFullDirty replaces accumulated rects with a sentinel', () => {
    const raf = mockRAF();
    const paint = vi.fn();
    const loop = new PaintLoop(paint);
    loop.start();
    loop.markDirty({ x: 0, y: 0, w: 5, h: 5 });
    loop.markFullDirty();
    raf.tick();
    expect(paint.mock.calls[0]![0]).toEqual([{ x: -Infinity, y: -Infinity, w: Infinity, h: Infinity }]);
  });
});
