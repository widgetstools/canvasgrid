import { describe, it, expect, vi, beforeAll } from 'vitest';
import { textCell, numberCell, checkboxCell, headerCell, CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import type { CachedContext2D } from '../src/renderer/gc';

// happy-dom doesn't include Path2D; provide a minimal stub for icon-path tests.
beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class {
      constructor(_d?: string) {}
    };
  }
});

function makeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
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
  bounds: { x: 0, y: 0, w: 100, h: 30 },
  font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc',
  halign: 'left', prefillColor: '#fff',
  isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  ...over,
});

describe('textCell', () => {
  it('paints background + text', () => {
    const gc = makeGc();
    // Use a different bg than prefillColor so the background fill is triggered
    textCell.paint(gc, baseParams({ value: 'hi', valueFormatted: 'hi', bg: '#eee', prefillColor: '#fff' }));
    expect((gc.fillRect as any)).toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalledWith('hi', expect.any(Number), expect.any(Number));
  });

  it('halign right adjusts text x to right side', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ value: 'x', valueFormatted: 'x', halign: 'right', bg: '#eee', prefillColor: '#fff' }));
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBeGreaterThan(50);
  });

  // Cell renderers must NOT draw cell-edge lines themselves. Grid lines run as
  // a single pass at the end of the frame; per-cell strokes leave double-stroked
  // seams between adjacent cells.
  it('does not stroke any cell-edge dividers', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ value: 'x', valueFormatted: 'x' }));
    expect((gc.stroke as any)).not.toHaveBeenCalled();
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('skips fillRect when bg === prefillColor (bundle already painted it)', () => {
    const gc = makeGc();
    // bg matches prefillColor → no per-cell background fill
    textCell.paint(gc, baseParams({ value: 'hi', valueFormatted: 'hi', bg: '#fff', prefillColor: '#fff' }));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalled();
  });
});

// "look-and-feel" Part A — em-dash nulls. Mirrors the totals renderer's
// empty-cell handling (`totals.ts`): opt-in via `emptyCellText`, painted in
// `emptyFg` (fallback `fg`). Default (emptyCellText unset) keeps the
// pre-existing blank behavior for null/empty values.
describe('textCell — empty/null glyph (opt-in via emptyCellText)', () => {
  it('paints emptyCellText in emptyFg when the value is null and emptyCellText is set', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      value: null, valueFormatted: '',
      fg: '#000', emptyFg: '#888', emptyCellText: '–',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('–');
    expect(gc.cache.fillStyle).toBe('#888');
  });

  it('paints emptyCellText for undefined and empty-string values too', () => {
    for (const v of [undefined, ''] as const) {
      const gc = makeGc();
      textCell.paint(gc, baseParams({
        value: v, valueFormatted: '',
        emptyCellText: '–',
      }));
      const [text] = (gc.fillText as any).mock.calls[0]!;
      expect(text).toBe('–');
    }
  });

  it('falls back to fg when emptyFg is unset', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      value: null, valueFormatted: '',
      fg: '#123456', emptyFg: undefined, emptyCellText: '–',
    }));
    expect(gc.cache.fillStyle).toBe('#123456');
  });

  it('draws NOTHING (blank) for a null value when emptyCellText is unset (default, unchanged behavior)', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({ value: null, valueFormatted: '', emptyCellText: undefined }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('');
  });

  it('paints the real value in normal fg for a non-empty cell, even when emptyCellText is set', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      value: 'hello', valueFormatted: 'hello',
      fg: '#111', emptyFg: '#888', emptyCellText: '–',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('hello');
    expect(gc.cache.fillStyle).toBe('#111');
  });

  it('left-aligns the empty glyph like a normal left-aligned text cell', () => {
    const gc = makeGc();
    textCell.paint(gc, baseParams({
      value: null, valueFormatted: '', halign: 'left', emptyCellText: '–',
    }));
    expect(gc.cache.textAlign).toBe('left');
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(0 + 6); // bounds.x + PADDING
  });
});

describe('numberCell', () => {
  it('right-aligns by default', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: 42, valueFormatted: '42',
      halign: 'right',
    }));
    expect(gc.textAlign).toBe('right');
  });

  it('respects explicit center halign', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: 42, valueFormatted: '42',
      halign: 'center',
    }));
    expect(gc.textAlign).toBe('center');
  });

  it('respects explicit left halign', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: 7, valueFormatted: '7',
      halign: 'left',
    }));
    expect(gc.textAlign).toBe('left');
  });

  it('does not stroke any cell-edge dividers', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({ value: 42, valueFormatted: '42' }));
    expect((gc.stroke as any)).not.toHaveBeenCalled();
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });
});

// "look-and-feel" Part A — em-dash nulls (numeric column path).
describe('numberCell — empty/null glyph (opt-in via emptyCellText)', () => {
  it('paints emptyCellText in emptyFg when the value is null and emptyCellText is set', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: null, valueFormatted: '',
      fg: '#000', emptyFg: '#888', emptyCellText: '–',
      halign: 'right',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('–');
    expect(gc.cache.fillStyle).toBe('#888');
  });

  it('falls back to fg when emptyFg is unset', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: undefined, valueFormatted: '',
      fg: '#123456', emptyFg: undefined, emptyCellText: '–',
    }));
    expect(gc.cache.fillStyle).toBe('#123456');
  });

  it('draws NOTHING (blank) for a null value when emptyCellText is unset (default, unchanged behavior)', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({ value: null, valueFormatted: '', emptyCellText: undefined }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('');
  });

  it('paints the real value in normal fg for a non-empty numeric cell, even when emptyCellText is set', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: 42, valueFormatted: '42',
      fg: '#111', emptyFg: '#888', emptyCellText: '–',
      halign: 'right',
    }));
    const [text] = (gc.fillText as any).mock.calls[0]!;
    expect(text).toBe('42');
    expect(gc.cache.fillStyle).toBe('#111');
  });

  it('right-aligns the empty glyph like a normal right-aligned number cell', () => {
    const gc = makeGc();
    numberCell.paint(gc, baseParams({
      value: null, valueFormatted: '', halign: 'right', emptyCellText: '–',
      bounds: { x: 0, y: 0, w: 100, h: 30 },
    }));
    expect(gc.textAlign).toBe('right');
    const [, x] = (gc.fillText as any).mock.calls[0]!;
    expect(x).toBe(100 - 6); // bounds.x + bounds.w - PADDING
  });
});

describe('checkboxCell — tri-state indicator (true / false / null)', () => {
  it('true: strokes the outlined 14×14 box AND strokes the checkmark path', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: true, valueFormatted: '' }));
    expect((gc.strokeRect as any)).toHaveBeenCalled();
    expect((gc.stroke as any)).toHaveBeenCalled();
    // Never falls through to the em-dash text path.
    expect((gc.fillText as any)).not.toHaveBeenCalled();
  });

  it('false: strokes the outlined empty box but never the checkmark', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: false, valueFormatted: '' }));
    expect((gc.strokeRect as any)).toHaveBeenCalled();
    expect((gc.stroke as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).not.toHaveBeenCalled();
  });

  it('null: paints a centered em-dash with reduced alpha and skips the box entirely', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: null, valueFormatted: '', bounds: { x: 0, y: 0, w: 60, h: 30 } }));
    // Em-dash goes through fillText, not the box path.
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalledWith('—', 30, 15);
    // Reduced alpha is applied to the fillText call and restored afterwards
    // — assertion is on the final restored value (test spy checks final gc state).
    expect(gc.globalAlpha).toBe(1);
  });

  it('undefined: same em-dash path as null', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: undefined, valueFormatted: '', bounds: { x: 0, y: 0, w: 60, h: 30 } }));
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalledWith('—', 30, 15);
  });

  it("empty string: null path — the text-encoded null value shipped by the worker's text-column format", () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: '', valueFormatted: '', bounds: { x: 0, y: 0, w: 60, h: 30 } }));
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
    expect((gc.fillText as any)).toHaveBeenCalledWith('—', 30, 15);
  });

  it("string 'true': true path — a text-column boolean arrives as the string 'true' after String(bool)", () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: 'true', valueFormatted: '' }));
    expect((gc.strokeRect as any)).toHaveBeenCalled();
    expect((gc.stroke as any)).toHaveBeenCalled(); // checkmark path fires
  });

  it("string 'false': false path — MUST NOT paint the check even though non-empty strings are JS-truthy", () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: 'false', valueFormatted: '' }));
    expect((gc.strokeRect as any)).toHaveBeenCalled();
    // The check stroke is NOT called — this is the invariant that guards
    // against the regression where any non-empty string flipped the visual
    // to true because the painter checked JS-truthiness directly.
    expect((gc.stroke as any)).not.toHaveBeenCalled();
  });

  it('unknown string: null path — treats non-boolean text as unknown rather than misrepresenting', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: 'maybe', valueFormatted: '', bounds: { x: 0, y: 0, w: 60, h: 30 } }));
    expect((gc.fillText as any)).toHaveBeenCalledWith('—', 30, 15);
  });

  it('accent fill: fillRect is called on true when checkboxCheckedBg is set', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({
      value: true, valueFormatted: '',
      checkboxCheckedBg: '#2563eb',
    }));
    // fillRect fires for the accent + the background (when bg !== prefillColor).
    // Verifying the accent fill happened is enough — the exact number of fillRect
    // calls depends on the bg / prefillColor branch which other tests cover.
    expect((gc.fillRect as any)).toHaveBeenCalled();
  });

  it('accent fill: NOT applied when value is false (the empty-box path)', () => {
    const gc = makeGc();
    const params = baseParams({
      value: false, valueFormatted: '',
      checkboxCheckedBg: '#2563eb',
      bg: '#fff', prefillColor: '#fff',
    });
    checkboxCell.paint(gc, params);
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
  });
});

describe('headerCell', () => {
  it('paints text for header name', () => {
    const gc = makeGc();
    headerCell.paint(gc, baseParams({
      value: 'Name', valueFormatted: 'Name',
      isHeader: true, bg: '#eee', prefillColor: '#fff',
    }));
    expect((gc.fillText as any)).toHaveBeenCalledWith('Name', expect.any(Number), expect.any(Number));
  });

  it('draws sort icon when sortDirection is set', () => {
    const gc = makeGc();
    headerCell.paint(gc, baseParams({
      value: 'Name', valueFormatted: 'Name',
      isHeader: true, sortDirection: 'asc',
      bg: '#eee', prefillColor: '#fff',
    }));
    // drawIcon calls gc.stroke() via Path2D
    expect((gc.stroke as any)).toHaveBeenCalled();
  });

  it('does not draw sort icon when sortDirection is undefined', () => {
    const gc = makeGc();
    headerCell.paint(gc, baseParams({
      value: 'Name', valueFormatted: 'Name',
      isHeader: true, sortDirection: undefined,
      bg: '#eee', prefillColor: '#fff',
    }));
    expect((gc.stroke as any)).not.toHaveBeenCalled();
  });

  it('draws the faint chevron pair when unSortIcon is true and no sortDirection', () => {
    // Cycle 8 / Task 5 — `unSortIcon: true` makes the header paint a
    // faint chevrons-up-down hint when the column is sortable but
    // unsorted. The hint slots in the same x position the active
    // chevron would; drawIcon calls gc.stroke() via Path2D.
    const gc = makeGc();
    headerCell.paint(gc, baseParams({
      value: 'Name', valueFormatted: 'Name',
      isHeader: true, sortDirection: undefined, unSortIcon: true,
      bg: '#eee', prefillColor: '#fff',
    }));
    expect((gc.stroke as any)).toHaveBeenCalled();
  });

  it('unSortIcon path yields to an active sortDirection (no double-paint)', () => {
    // When the column IS currently sorted, the active chevron wins —
    // unSortIcon must NOT also paint underneath. We verify by counting
    // gc.stroke invocations: one for the asc chevron, zero for the pair.
    const gc = makeGc();
    headerCell.paint(gc, baseParams({
      value: 'Name', valueFormatted: 'Name',
      isHeader: true, sortDirection: 'asc', unSortIcon: true,
      bg: '#eee', prefillColor: '#fff',
    }));
    // `chevron-up` is a single Path2D stroke; `chevrons-up-down` is also
    // a single Path2D stroke (the icon contains both glyphs in one path).
    // We assert exactly one stroke so the else branch is provably dead.
    expect((gc.stroke as any)).toHaveBeenCalledTimes(1);
  });
});

describe('CellRendererRegistry', () => {
  it('register + get', () => {
    const reg = new CellRendererRegistry();
    reg.register('text', textCell);
    expect(reg.get('text')).toBe(textCell);
  });
  it('throws on unknown name', () => {
    expect(() => new CellRendererRegistry().get('missing')).toThrow(/missing/);
  });
});
