// @wellsfargo-starui/velocity-grid-ext/renderers — paintUtils tests (Cycle 21f / Task 2).
//
// TDD: these tests are written BEFORE the implementations to prove RED → GREEN.
// `gc.calls` assertions verify draw ORDER not just individual mock invocations.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  withAlpha,
  mixHex,
  labInterpolate,
  pill,
  dot,
  miniBar,
  fragText,
} from '../../src/renderers/paintUtils';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';

// ─── withAlpha ───────────────────────────────────────────────────────────────

describe('withAlpha', () => {
  it('converts hex + alpha to rgba string (catalog §1 positive green)', () => {
    // #0aa063 → r=10, g=160, b=99
    expect(withAlpha('#0aa063', 0.25)).toBe('rgba(10,160,99,0.25)');
  });

  it('handles full-opacity (alpha=1)', () => {
    expect(withAlpha('#e63946', 1)).toBe('rgba(230,57,70,1)');
  });

  it('handles zero-opacity (alpha=0)', () => {
    expect(withAlpha('#3b82f6', 0)).toBe('rgba(59,130,246,0)');
  });
});

// ─── mixHex ──────────────────────────────────────────────────────────────────

describe('mixHex', () => {
  it('mid-point black→white → #808080 (128,128,128 — linear byte average)', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('t=0 → first color', () => {
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('t=1 → second color', () => {
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('t clamped below 0', () => {
    expect(mixHex('#ff0000', '#0000ff', -0.5)).toBe('#ff0000');
  });

  it('t clamped above 1', () => {
    expect(mixHex('#ff0000', '#0000ff', 2)).toBe('#0000ff');
  });
});

// ─── labInterpolate ──────────────────────────────────────────────────────────

describe('labInterpolate', () => {
  it('endpoint exactness: t=0 returns first color', () => {
    expect(labInterpolate('#000000', '#ffffff', 0, 'lab')).toBe('#000000');
  });

  it('endpoint exactness: t=1 returns second color', () => {
    expect(labInterpolate('#000000', '#ffffff', 1, 'lab')).toBe('#ffffff');
  });

  it('mid-point black→white Lab → #777777 (119,119,119 — L*=50 gray in sRGB)', () => {
    // Lab midpoint L*=50 → sRGB 119 (not 128) because sRGB gamma is non-linear
    // w.r.t. L*: this is the concrete proof Lab beats linear mixing for HeatCell.
    expect(labInterpolate('#000000', '#ffffff', 0.5, 'lab')).toBe('#777777');
  });

  it('mid-point black→white with curve:linear → #808080 (matches mixHex)', () => {
    expect(labInterpolate('#000000', '#ffffff', 0.5, 'linear')).toBe('#808080');
  });

  it('defaults to lab when curve omitted', () => {
    expect(labInterpolate('#000000', '#ffffff', 0.5)).toBe('#777777');
  });

  it('monotonicity: no channel reverses direction red→green', () => {
    const ts = [0, 0.25, 0.5, 0.75, 1] as const;
    const results = ts.map((t) => {
      const hex = labInterpolate('#e63946', '#0aa063', t);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return { r, g, b };
    });

    // Red decreases (from e6=230 to 0a=10)
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.r).toBeLessThanOrEqual(results[i - 1]!.r + 1); // +1 rounding tolerance
    }
    // Green increases (from 39=57 to a0=160)
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.g).toBeGreaterThanOrEqual(results[i - 1]!.g - 1); // -1 rounding tolerance
    }
  });
});

// ─── pill ────────────────────────────────────────────────────────────────────

describe('pill', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('normal pill with border — draws rounded rect then strokes border', () => {
    pill(gc, 10, 5, 80, 20, 4, '#3b82f61f', '#3b82f6');

    const ops = gc.calls.map((c) => c.op);
    // fill style set before the path
    expect(ops).toContain('set:fillStyle');
    // beginPath → (moveTo + 4×arcTo) → closePath → fill
    const bi = ops.indexOf('beginPath');
    const ci = ops.indexOf('closePath');
    const fi = ops.indexOf('fill');
    expect(bi).toBeGreaterThanOrEqual(0);
    expect(ci).toBeGreaterThan(bi);
    expect(fi).toBeGreaterThan(ci);
    // 4 arcTo calls
    expect(ops.filter((o) => o === 'arcTo')).toHaveLength(4);
    // strokeStyle set and stroke called after fill (border present)
    expect(ops).toContain('set:strokeStyle');
    expect(ops).toContain('stroke');
    expect(ops.indexOf('set:strokeStyle')).toBeGreaterThan(fi);
    expect(ops.indexOf('stroke')).toBeGreaterThan(fi);
  });

  it('pill with radius=0 — still calls beginPath/fill, 4×arcTo with r=0', () => {
    pill(gc, 0, 0, 40, 14, 0, '#ffffff');
    const ops = gc.calls.map((c) => c.op);
    expect(ops).toContain('beginPath');
    expect(ops).toContain('fill');
    expect(ops).not.toContain('stroke');
    // 4 arcTo calls, all with radius 0
    const arcToCalls = gc.calls.filter((c) => c.op === 'arcTo');
    expect(arcToCalls).toHaveLength(4);
    arcToCalls.forEach((c) => {
      expect(c.args[4]).toBe(0); // radius arg
    });
  });

  it('pill without border — no strokeStyle set, no stroke call', () => {
    pill(gc, 0, 0, 60, 18, 3, '#f0b4291f');
    const ops = gc.calls.map((c) => c.op);
    expect(ops).not.toContain('set:strokeStyle');
    expect(ops).not.toContain('stroke');
  });

  it('fill color is passed to fillStyle before path', () => {
    const fill = '#0aa0631f';
    pill(gc, 0, 0, 60, 18, 3, fill);
    const fillStyleCall = gc.calls.find((c) => c.op === 'set:fillStyle');
    expect(fillStyleCall?.args[0]).toBe(fill);
    const bi = gc.calls.findIndex((c) => c.op === 'beginPath');
    const fsi = gc.calls.findIndex((c) => c.op === 'set:fillStyle');
    expect(fsi).toBeLessThan(bi);
  });
});

// ─── dot ─────────────────────────────────────────────────────────────────────

describe('dot', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('draws beginPath → arc(cx,cy,r,0,2π) → fill', () => {
    dot(gc, 10, 20, 4, '#0aa063');

    const ops = gc.calls.map((c) => c.op);
    expect(ops.indexOf('beginPath')).toBeLessThan(ops.indexOf('arc'));
    expect(ops.indexOf('arc')).toBeLessThan(ops.indexOf('fill'));

    const arcCall = gc.calls.find((c) => c.op === 'arc');
    expect(arcCall?.args[0]).toBe(10);   // cx
    expect(arcCall?.args[1]).toBe(20);   // cy
    expect(arcCall?.args[2]).toBe(4);    // r
    expect(arcCall?.args[3]).toBe(0);    // start angle
    expect(arcCall?.args[4]).toBeCloseTo(Math.PI * 2, 10); // end angle
  });

  it('r=0 edge case — still draws, no throw', () => {
    expect(() => dot(gc, 5, 5, 0, '#ff0000')).not.toThrow();
    const ops = gc.calls.map((c) => c.op);
    expect(ops).toContain('beginPath');
    expect(ops).toContain('fill');
    const arcCall = gc.calls.find((c) => c.op === 'arc');
    expect(arcCall?.args[2]).toBe(0);
  });

  it('sets fillStyle to color before drawing', () => {
    dot(gc, 0, 0, 8, '#e63946');
    const fsi = gc.calls.findIndex((c) => c.op === 'set:fillStyle');
    const arcI = gc.calls.findIndex((c) => c.op === 'arc');
    expect(fsi).toBeGreaterThanOrEqual(0);
    expect(fsi).toBeLessThan(arcI);
    expect(gc.calls[fsi]?.args[0]).toBe('#e63946');
  });
});

// ─── miniBar ─────────────────────────────────────────────────────────────────

describe('miniBar', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('frac=1 — draws fill rect at full width', () => {
    miniBar(gc, 0, 0, 100, 16, 1, '#0aa063');
    const fillRects = gc.calls.filter((c) => c.op === 'fillRect');
    expect(fillRects).toHaveLength(1);
    expect(fillRects[0]?.args[2]).toBe(100); // width = w * 1
  });

  it('frac=0.5 — draws fill rect at half width', () => {
    miniBar(gc, 0, 0, 100, 16, 0.5, '#0aa063');
    const fillRects = gc.calls.filter((c) => c.op === 'fillRect');
    expect(fillRects).toHaveLength(1);
    expect(fillRects[0]?.args[2]).toBe(50); // w * 0.5
  });

  it('frac=0 — no fill rect emitted, only track (when trackColor given)', () => {
    miniBar(gc, 0, 0, 100, 16, 0, '#0aa063', '#cccccc');
    const fillRects = gc.calls.filter((c) => c.op === 'fillRect');
    // Only the track rect (width=100), no fill rect
    expect(fillRects).toHaveLength(1);
    expect(fillRects[0]?.args[2]).toBe(100); // track is full width
  });

  it('frac>1 — clamped to full width', () => {
    miniBar(gc, 0, 0, 100, 16, 1.5, '#0aa063');
    const fillRects = gc.calls.filter((c) => c.op === 'fillRect');
    expect(fillRects).toHaveLength(1);
    expect(fillRects[0]?.args[2]).toBe(100); // clamped to w * 1 = 100
  });

  it('with trackColor — track drawn first, fill drawn second', () => {
    miniBar(gc, 10, 5, 80, 16, 0.6, '#0aa063', '#e0e0e0');
    const fillRects = gc.calls.filter((c) => c.op === 'fillRect');
    expect(fillRects).toHaveLength(2);
    // Track is full width, fill is 80 * 0.6 = 48
    expect(fillRects[0]?.args[2]).toBe(80);  // track: full width
    expect(fillRects[1]?.args[2]).toBe(48);  // fill: 80 * 0.6
  });

  it('without trackColor — only fill rect, no extra fillRect', () => {
    miniBar(gc, 0, 0, 100, 16, 0.75, '#f0b429');
    const fillRects = gc.calls.filter((c) => c.op === 'fillRect');
    expect(fillRects).toHaveLength(1);
  });
});

// ─── fragText ────────────────────────────────────────────────────────────────

describe('fragText', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('passthrough — text fits maxWidth, passes original text to fillText', () => {
    // "ab" = 2 chars * 7 = 14px, maxWidth=50 → no truncation
    fragText(gc, 'ab', 10, 20, { maxWidth: 50 });
    const ftCall = gc.calls.find((c) => c.op === 'fillText');
    expect(ftCall?.args[0]).toBe('ab');
  });

  it('truncation — maxWidth forces …-suffixed shorter string', () => {
    // "abcdefghij" = 10 chars * 7 = 70px, maxWidth=30
    // "abc" = 21px, "abc…" = 28px ≤ 30 → stops there
    fragText(gc, 'abcdefghij', 10, 20, { maxWidth: 30 });
    const ftCall = gc.calls.find((c) => c.op === 'fillText');
    expect(ftCall?.args[0]).toBe('abc…');
  });

  it('no maxWidth — passes text through unchanged', () => {
    fragText(gc, 'Hello World', 0, 0);
    const ftCall = gc.calls.find((c) => c.op === 'fillText');
    expect(ftCall?.args[0]).toBe('Hello World');
  });

  it('sets font via cache before fillText when opts.font given', () => {
    fragText(gc, 'hi', 0, 12, { font: 'bold 14px Inter' });
    const fsi = gc.calls.findIndex((c) => c.op === 'set:font');
    const fti = gc.calls.findIndex((c) => c.op === 'fillText');
    expect(fsi).toBeGreaterThanOrEqual(0);
    expect(fsi).toBeLessThan(fti);
    expect(gc.calls[fsi]?.args[0]).toBe('bold 14px Inter');
  });

  it('sets fillStyle via cache before fillText when opts.color given', () => {
    fragText(gc, 'hi', 0, 12, { color: '#e63946' });
    const colorI = gc.calls.findIndex((c) => c.op === 'set:fillStyle');
    const fti = gc.calls.findIndex((c) => c.op === 'fillText');
    expect(colorI).toBeGreaterThanOrEqual(0);
    expect(colorI).toBeLessThan(fti);
    expect(gc.calls[colorI]?.args[0]).toBe('#e63946');
  });

  it('sets textAlign via cache before fillText when opts.align given', () => {
    fragText(gc, 'hi', 0, 12, { align: 'right' });
    const ai = gc.calls.findIndex((c) => c.op === 'set:textAlign');
    const fti = gc.calls.findIndex((c) => c.op === 'fillText');
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(ai).toBeLessThan(fti);
    expect(gc.calls[ai]?.args[0]).toBe('right');
  });

  it('x and y are passed to fillText', () => {
    fragText(gc, 'test', 42, 17);
    const ftCall = gc.calls.find((c) => c.op === 'fillText');
    expect(ftCall?.args[1]).toBe(42);
    expect(ftCall?.args[2]).toBe(17);
  });
});
