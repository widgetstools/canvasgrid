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

describe('checkboxCell', () => {
  it('paints a checkmark when value is true', () => {
    const gc = makeGc();
    checkboxCell.paint(gc, baseParams({ value: true, valueFormatted: '' }));
    expect((gc.strokeRect as any)).toHaveBeenCalled();
    expect((gc.stroke as any)).toHaveBeenCalled();
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
