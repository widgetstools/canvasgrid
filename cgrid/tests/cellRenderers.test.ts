import { describe, it, expect, vi } from 'vitest';
import { textCell, numberCell, checkboxCell, CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { CellPaintParams } from '../src/renderer/cellRenderers/registry';

function makeCtx() {
  return {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(), measureText: vi.fn(() => ({ width: 50 })),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
    globalAlpha: 1, lineWidth: 1,
  } as any;
}

const baseParams = (over: Partial<CellPaintParams> = {}): CellPaintParams => ({
  value: '', valueFormatted: '',
  bounds: { x: 0, y: 0, w: 100, h: 30 },
  style: { font: '13px Inter', fg: '#000', bg: '#fff', borderColor: '#ccc', halign: 'left' },
  isFocused: false, isSelected: false, isHovered: false,
  ...over,
});

describe('textCell', () => {
  it('paints background + text', () => {
    const ctx = makeCtx();
    textCell.paint(ctx, baseParams({ value: 'hi', valueFormatted: 'hi' }));
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('hi', expect.any(Number), expect.any(Number));
  });

  it('halign right adjusts text x to right side', () => {
    const ctx = makeCtx();
    textCell.paint(ctx, baseParams({ value: 'x', valueFormatted: 'x', style: { ...baseParams().style, halign: 'right' } }));
    const [, x] = ctx.fillText.mock.calls[0]!;
    expect(x).toBeGreaterThan(50);
  });
});

describe('numberCell', () => {
  it('right-aligns by default', () => {
    const ctx = makeCtx();
    numberCell.paint(ctx, baseParams({ value: 42, valueFormatted: '42' }));
    expect(ctx.textAlign).toBe('right');
  });
});

describe('checkboxCell', () => {
  it('paints a checkmark when value is true', () => {
    const ctx = makeCtx();
    checkboxCell.paint(ctx, baseParams({ value: true, valueFormatted: '' }));
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
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
