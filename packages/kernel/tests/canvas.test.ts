import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CGridCanvas } from '../src/core/canvas';

beforeEach(() => {
  // happy-dom doesn't implement getContext; stub with a fake.
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

describe('CGridCanvas', () => {
  it('appends a <canvas> to the host and fires setBounds + paint synchronously on construct', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const setBounds = vi.fn();
    const paint = vi.fn();
    const cgc = new CGridCanvas(host, { setBounds, paint }, {
      measureSize: () => ({ width: 400, height: 300 }),
      useHiDPI: false,
    });
    // Canvas was created & attached.
    expect(host.querySelector('canvas')).toBe(cgc.canvas);
    // setBounds was called BEFORE paint, both synchronously in the constructor.
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 400, height: 300 });
    expect(paint).toHaveBeenCalledOnce();
    expect(setBounds.mock.invocationCallOrder[0]!).toBeLessThan(paint.mock.invocationCallOrder[0]!);
    cgc.destroy();
  });

  it('checkSize is a no-op when measured size is unchanged', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const setBounds = vi.fn();
    const paint = vi.fn();
    const cgc = new CGridCanvas(host, { setBounds, paint }, {
      measureSize: () => ({ width: 400, height: 300 }),
      useHiDPI: false,
    });
    setBounds.mockClear();
    paint.mockClear();
    cgc.checkSize();
    // No resize/paint when nothing changed — this is the key "no per-frame
    // cascade" property that makes resize flicker-free.
    expect(setBounds).not.toHaveBeenCalled();
    expect(paint).not.toHaveBeenCalled();
    cgc.destroy();
  });

  it('checkSize triggers resize + synchronous paint when measured size changes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let measured = { width: 400, height: 300 };
    const setBounds = vi.fn();
    const paint = vi.fn();
    const cgc = new CGridCanvas(host, { setBounds, paint }, {
      measureSize: () => measured,
      useHiDPI: false,
    });
    setBounds.mockClear();
    paint.mockClear();
    measured = { width: 500, height: 400 };
    cgc.checkSize();
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 500, height: 400 });
    expect(paint).toHaveBeenCalledOnce();
    cgc.destroy();
  });

  it('paintNow paints inside a cache.save/cache.restore so renderer state changes do not leak across frames', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const order: string[] = [];
    const setBounds = vi.fn();
    const paint = vi.fn((gc: any) => {
      // Set a state property inside paint — outside cache.save/restore it
      // would leak into the next frame.
      gc.cache.fillStyle = 'red';
      order.push('paint');
    });
    const cgc = new CGridCanvas(host, { setBounds, paint }, {
      measureSize: () => ({ width: 100, height: 100 }),
      useHiDPI: false,
    });
    paint.mockClear();
    cgc.paintNow();
    expect(paint).toHaveBeenCalledOnce();
    cgc.destroy();
  });

  it('destroy detaches the canvas and stops further paints', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const paint = vi.fn();
    const cgc = new CGridCanvas(host, { setBounds: () => {}, paint }, {
      measureSize: () => ({ width: 100, height: 100 }),
      useHiDPI: false,
    });
    cgc.destroy();
    expect(host.querySelector('canvas')).toBeNull();
    paint.mockClear();
    cgc.paintNow();
    expect(paint).not.toHaveBeenCalled();
  });
});
