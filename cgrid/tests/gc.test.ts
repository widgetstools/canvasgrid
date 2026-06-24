import { describe, it, expect } from 'vitest';
import { attachGcCache, parseAlpha } from '../src/renderer/gc';

/** Build a real canvas in happy-dom and replace its getContext with a tiny
 * tracker that records property writes to the underlying ctx — that lets us
 * assert that gc.cache.X = same-value does NOT forward to the real ctx. */
function makeCanvasWithSpyCtx() {
  let saves = 0;
  let restores = 0;
  const writeLog: Array<[string, unknown]> = [];
  const ctx: any = {
    _fillStyle: 'A', _strokeStyle: 'B', _font: 'C', _textAlign: 'D',
    _textBaseline: 'E', _lineWidth: 1, _globalAlpha: 1,
    save() { saves++; },
    restore() { restores++; },
    clearRect() {},
    fillRect() {},
  };
  for (const k of ['fillStyle', 'strokeStyle', 'font', 'textAlign', 'textBaseline', 'lineWidth', 'globalAlpha']) {
    Object.defineProperty(ctx, k, {
      enumerable: true,
      configurable: true,
      get() { return ctx[`_${k}`]; },
      set(v) { writeLog.push([k, v]); ctx[`_${k}`] = v; },
    });
  }
  const canvas: any = { getContext: () => ctx };
  return { canvas, ctx, writeLog, counts: () => ({ saves, restores }) };
}

describe('parseAlpha', () => {
  it('returns 1 for opaque colors', () => {
    expect(parseAlpha('#ff0000')).toBe(1);
    expect(parseAlpha('red')).toBe(1);
    expect(parseAlpha('rgb(255,0,0)')).toBe(1);
  });
  it('returns 0 for transparent', () => {
    expect(parseAlpha('transparent')).toBe(0);
  });
  it('extracts alpha from rgba()', () => {
    expect(parseAlpha('rgba(0,0,0,0.5)')).toBe(0.5);
    expect(parseAlpha('rgba(0, 0, 0, 0)')).toBe(0);
  });
  it('extracts alpha from hsla()', () => {
    expect(parseAlpha('hsla(0, 100%, 50%, 0.25)')).toBe(0.25);
  });
});

describe('attachGcCache', () => {
  it('coalesces same-value writes — write through to ctx only on change', () => {
    const { canvas, writeLog } = makeCanvasWithSpyCtx();
    const gc = attachGcCache(canvas as any);
    writeLog.length = 0; // reset after attach (no writes expected on attach)

    gc.cache.fillStyle = 'red';
    gc.cache.fillStyle = 'red';   // same — should NOT forward
    gc.cache.fillStyle = 'red';
    expect(writeLog).toEqual([['fillStyle', 'red']]);

    gc.cache.fillStyle = 'blue';
    expect(writeLog).toEqual([['fillStyle', 'red'], ['fillStyle', 'blue']]);
  });

  it('save/restore stack the values frame so a child write does not leak out', () => {
    const { canvas, writeLog, counts } = makeCanvasWithSpyCtx();
    const gc = attachGcCache(canvas as any);
    writeLog.length = 0;

    gc.cache.fillStyle = 'red';
    gc.cache.save();
    gc.cache.fillStyle = 'green';
    gc.cache.restore();
    // After restore, the values frame is back to red. A subsequent write of
    // 'red' must be skipped (same value, no forward). A write of 'green' must
    // forward again (green is no longer the cached value).
    writeLog.length = 0;
    gc.cache.fillStyle = 'red';
    expect(writeLog).toEqual([]);   // matched cached value, elided
    gc.cache.fillStyle = 'green';
    expect(writeLog).toEqual([['fillStyle', 'green']]);

    // gc.save/restore counts mirror the cache.save/restore.
    expect(counts().saves).toBe(1);
    expect(counts().restores).toBe(1);
  });

  it('clearFill calls clearRect for translucent colors and fillRect for visible', () => {
    let cleared = 0;
    let filled = 0;
    const ctx: any = {
      fillStyle: '', save() {}, restore() {},
      clearRect() { cleared++; },
      fillRect() { filled++; },
    };
    const canvas: any = { getContext: () => ctx };
    const gc = attachGcCache(canvas as any);

    gc.clearFill(0, 0, 10, 10, 'rgba(0,0,0,0.5)');  // translucent — clear THEN fill
    expect(cleared).toBe(1);
    expect(filled).toBe(1);

    gc.clearFill(0, 0, 10, 10, '#000000');           // opaque — fill only
    expect(cleared).toBe(1);
    expect(filled).toBe(2);

    gc.clearFill(0, 0, 10, 10, 'transparent');       // transparent — clear only, no fill
    expect(cleared).toBe(2);
    expect(filled).toBe(2);
  });
});
