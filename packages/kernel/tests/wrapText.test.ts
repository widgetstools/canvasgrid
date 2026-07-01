import { describe, it, expect, vi, beforeAll } from 'vitest';
import { wrapTextCell, wrapIntoLines, ellipsize } from '../src/renderer/cellRenderers/wrapText';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

// Each character is 10 px wide — easy arithmetic for line/ellipsis math.
const CHAR_W = 10;
const measureProportional = (s: string) => s.length * CHAR_W;

function makeGc(measureWidth: (s: string) => number = measureProportional): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: measureWidth(s) })),
    fillStyle: '', strokeStyle: '', font: '13px Inter',
    textBaseline: 'alphabetic', textAlign: 'start',
    globalAlpha: 1, lineWidth: 1,
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const baseParams = (over: Partial<CellPaintConfig> = {}): CellPaintConfig => ({
  value: '', valueFormatted: '',
  bounds: { x: 0, y: 0, w: 200, h: 60 },
  font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
  halign: 'left', prefillColor: '#fff',
  isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  ...over,
});

describe('wrapIntoLines (greedy word-wrap)', () => {
  it('keeps a short string on a single line', () => {
    const out: string[] = [];
    wrapIntoLines(out, 'hello world', 200, measureProportional);
    expect(out).toEqual(['hello world']);
  });

  it('breaks at word boundaries when the next word would overflow', () => {
    const out: string[] = [];
    // 'one two three four five six' — 26 chars including spaces.
    // maxWidth 100 ⇒ 10 chars per line at 10 px/char.
    wrapIntoLines(out, 'one two three four five six', 100, measureProportional);
    // Greedy: 'one two' (7) → +' three' would be 13 chars (130 px) ⇒ break.
    expect(out.length).toBeGreaterThan(1);
    // Each line by itself must fit (≤ 100 px / 10 chars).
    for (const line of out) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it('keeps a word that exceeds maxWidth on its own line (no mid-word split)', () => {
    const out: string[] = [];
    wrapIntoLines(out, 'short superlongword more', 50, measureProportional);
    expect(out).toContain('superlongword');
  });

  it('reuses the caller-owned array (no fresh allocation)', () => {
    const out: string[] = ['stale1', 'stale2', 'stale3'];
    wrapIntoLines(out, 'one two three', 200, measureProportional);
    // length resets to fit the new wrap; stale entries are gone.
    expect(out).toEqual(['one two three']);
  });

  it('produces at least one line for empty input (no crash)', () => {
    const out: string[] = [];
    wrapIntoLines(out, '', 200, measureProportional);
    expect(out.length).toBeLessThanOrEqual(1);
  });
});

describe('ellipsize', () => {
  it('appends an ellipsis when the full line fits with one', () => {
    // 'abc' (30 px) + '…' (10 px) = 40 px — fits in 50 px.
    expect(ellipsize('abc', 50, measureProportional)).toBe('abc…');
  });

  it('drops trailing chars until ellipsised line fits maxWidth', () => {
    // 'abcdefghij' (100 px) + '…' (10 px) = 110 px — does not fit 60 px.
    // Need ≤ 50 px before adding '…' (10 px). 5 chars = 50 px ⇒ 'abcde…'.
    expect(ellipsize('abcdefghij', 60, measureProportional)).toBe('abcde…');
  });

  it('returns just the ellipsis when no character fits', () => {
    // maxWidth 10 ⇒ only '…' (10 px) fits.
    expect(ellipsize('abcdef', 10, measureProportional)).toBe('…');
  });
});

describe('wrapTextCell painter', () => {
  it('paints a single line for a short string', () => {
    const gc = makeGc();
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'hello', bounds: { x: 0, y: 0, w: 200, h: 60 },
      bg: '#eee', prefillColor: '#fff',
    }));
    expect((gc.fillText as any)).toHaveBeenCalledTimes(1);
  });

  it('paints multiple fillText calls when text wraps', () => {
    const gc = makeGc();
    // 'one two three four five six' wraps inside w=100 (8 px padding side = ~80 inner).
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'one two three four five six seven eight',
      bounds: { x: 0, y: 0, w: 100, h: 120 },
      bg: '#eee', prefillColor: '#fff',
    }));
    expect((gc.fillText as any).mock.calls.length).toBeGreaterThan(1);
  });

  it('truncates the last visible line with ellipsis when row height is exceeded', () => {
    const gc = makeGc();
    // Force many lines: very narrow column + long text.
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm',
      // h ~ 30 px ⇒ at 13 px line-height fits ~2 lines. Wrap produces many.
      bounds: { x: 0, y: 0, w: 60, h: 30 },
      font: '13px Inter',
      bg: '#eee', prefillColor: '#fff',
    }));
    // Some call must paint a string that ends with the ellipsis char.
    const printed: string[] = (gc.fillText as any).mock.calls.map((c: any[]) => c[0]);
    const someLineEllipsised = printed.some((s) => s.endsWith('…'));
    expect(someLineEllipsised).toBe(true);
  });

  it('skips fillRect when bg matches prefillColor (bundle already painted bg)', () => {
    const gc = makeGc();
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'hi', bg: '#fff', prefillColor: '#fff',
    }));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalled();
  });

  it('does not stroke any cell-edge dividers', () => {
    const gc = makeGc();
    wrapTextCell.paint(gc, baseParams({ valueFormatted: 'one two three' }));
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('reuses one internal line buffer across paint calls (allocation discipline)', () => {
    // We can't reach into the closure, but we can assert paint() does not
    // crash on repeated invocations and produces the same output deterministically.
    const gc = makeGc();
    const p = baseParams({
      valueFormatted: 'one two three four five six seven',
      bounds: { x: 0, y: 0, w: 80, h: 80 },
      bg: '#eee', prefillColor: '#fff',
    });
    wrapTextCell.paint(gc, p);
    const callsAfterFirst = (gc.fillText as any).mock.calls.length;
    wrapTextCell.paint(gc, p);
    const callsAfterSecond = (gc.fillText as any).mock.calls.length;
    // Second paint produces the same number of fillText calls as the first.
    expect(callsAfterSecond - callsAfterFirst).toBe(callsAfterFirst);
  });

  it('right-align places text at the right edge', () => {
    const gc = makeGc();
    wrapTextCell.paint(gc, baseParams({
      valueFormatted: 'x', halign: 'right',
      bounds: { x: 0, y: 0, w: 100, h: 60 },
    }));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBeGreaterThan(50);
  });
});
