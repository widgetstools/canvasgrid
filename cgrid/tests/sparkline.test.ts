import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  CellRendererRegistry,
  type CellPaintConfig,
} from '../src/renderer/cellRenderers/registry';
import { sparklineCell } from '../src/renderer/cellRenderers/sparkline';
import type { CachedContext2D } from '../src/renderer/gc';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

function makeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), closePath: vi.fn(),
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
  value: [] as number[], valueFormatted: '',
  bounds: { x: 0, y: 0, w: 100, h: 30 },
  font: '13px Inter', fg: '#2563eb', bg: '#fff', borderColor: '#ccc',
  halign: 'left', prefillColor: '#fff',
  isFocused: false, isSelected: false, isHovered: false, isHeader: false,
  params: { sparkline: { type: 'line' } },
  ...over,
});

/** Pull every (x, y) argument the painter passed to moveTo + lineTo so
 *  tests can assert both call counts and coordinate sanity (no NaN). */
function pointArgs(gc: CachedContext2D) {
  const move = (gc.moveTo as any).mock.calls as [number, number][];
  const line = (gc.lineTo as any).mock.calls as [number, number][];
  return { move, line };
}

describe('sparkline registration', () => {
  it('registers under the name "sparkline"', () => {
    const reg = new CellRendererRegistry();
    reg.register('sparkline', sparklineCell);
    expect(reg.get('sparkline')).toBe(sparklineCell);
  });
});

describe('line sparkline (Task 1)', () => {
  it('paints an ascending series as a polyline (1 moveTo + N-1 lineTo)', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [1, 2, 3, 4, 5] }));
    expect((gc.beginPath as any)).toHaveBeenCalledTimes(1);
    const { move, line } = pointArgs(gc);
    expect(move.length).toBe(1);
    expect(line.length).toBe(4);
    expect((gc.stroke as any)).toHaveBeenCalledTimes(1);
    // First point sits at x0; last point sits at x0 + w (within tolerance).
    expect(move[0]![0]).toBeCloseTo(2, 5);          // x0 = bounds.x + 2
    expect(line[3]![0]).toBeCloseTo(100 - 2, 5);    // x0 + w = bounds.x + 2 + 96
  });

  it('paints a descending series with min at the top and max at the bottom inverted', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [5, 4, 3, 2, 1] }));
    const { move, line } = pointArgs(gc);
    // y axis: max → top (smaller y), min → bottom (larger y). Descending
    // data means the first y is at the top of the cell band, last at bottom.
    const firstY = move[0]![1]!;
    const lastY = line[3]![1]!;
    expect(lastY).toBeGreaterThan(firstY);
  });

  it('produces finite coordinates for constant data (range fallback)', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [7, 7, 7, 7] }));
    const { move, line } = pointArgs(gc);
    for (const [x, y] of [...move, ...line]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('returns early on empty data — no path built', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [] }));
    expect((gc.beginPath as any)).not.toHaveBeenCalled();
    expect((gc.moveTo as any)).not.toHaveBeenCalled();
    expect((gc.lineTo as any)).not.toHaveBeenCalled();
    expect((gc.stroke as any)).not.toHaveBeenCalled();
  });

  it('returns early on single-point data — no polyline can be drawn', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [42] }));
    expect((gc.beginPath as any)).not.toHaveBeenCalled();
    expect((gc.stroke as any)).not.toHaveBeenCalled();
  });

  it('returns early on null/undefined value', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: null }));
    expect((gc.beginPath as any)).not.toHaveBeenCalled();

    const gc2 = makeGc();
    sparklineCell.paint(gc2, baseParams({ value: undefined }));
    expect((gc2.beginPath as any)).not.toHaveBeenCalled();
  });

  it('honors lineColor + lineWidth from cellRendererParams options', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3],
      params: { sparkline: { type: 'line', options: { lineColor: '#ff0000', lineWidth: 2 } } },
    }));
    expect(gc.strokeStyle).toBe('#ff0000');
    expect(gc.lineWidth).toBe(2);
  });

  it('falls back to p.fg when no lineColor option is set', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3],
      fg: '#abcdef',
      params: { sparkline: { type: 'line' } },
    }));
    expect(gc.strokeStyle).toBe('#abcdef');
  });

  it('keeps points within the cell bounds (inner 2px padding on every side)', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 100, 50, 0, 25],
      bounds: { x: 10, y: 20, w: 80, h: 40 },
    }));
    const { move, line } = pointArgs(gc);
    for (const [x, y] of [...move, ...line]) {
      expect(x).toBeGreaterThanOrEqual(12);
      expect(x).toBeLessThanOrEqual(88);
      expect(y).toBeGreaterThanOrEqual(22);
      expect(y).toBeLessThanOrEqual(58);
    }
  });

  it('is allocation-disciplined — exactly one beginPath + one stroke per paint', () => {
    const gc = makeGc();
    // A reasonably large series should still be a single-pass paint.
    const data = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1));
    sparklineCell.paint(gc, baseParams({ value: data }));
    expect((gc.beginPath as any)).toHaveBeenCalledTimes(1);
    expect((gc.stroke as any)).toHaveBeenCalledTimes(1);
    expect((gc.moveTo as any)).toHaveBeenCalledTimes(1);
    expect((gc.lineTo as any)).toHaveBeenCalledTimes(99);
  });
});
