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

describe('column sparkline (Task 2)', () => {
  it('dispatches via type: "column" and paints N rects', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3, 4, 5],
      params: { sparkline: { type: 'column' } },
    }));
    expect((gc.fillRect as any).mock.calls.length).toBe(5);
    // Column painter must not invoke the line-stroke path.
    expect((gc.stroke as any)).not.toHaveBeenCalled();
  });

  it('bars sit fully inside the cell band (no overflow)', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 100, 50, 0, 25],
      bounds: { x: 10, y: 20, w: 80, h: 40 },
      params: { sparkline: { type: 'column' } },
    }));
    const calls = (gc.fillRect as any).mock.calls as [number, number, number, number][];
    for (const [x, y, w, h] of calls) {
      expect(x).toBeGreaterThanOrEqual(12);
      expect(x + w).toBeLessThanOrEqual(88);
      expect(y).toBeGreaterThanOrEqual(22);
      expect(y + h).toBeLessThanOrEqual(58);
    }
  });

  it('returns early on empty data', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [], params: { sparkline: { type: 'column' } } }));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
  });

  it('reads fill color from cellRendererParams options', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3],
      params: { sparkline: { type: 'column', options: { fill: '#10b981' } } },
    }));
    expect(gc.fillStyle).toBe('#10b981');
  });
});

describe('area sparkline (Task 2)', () => {
  it('dispatches via type: "area" — paints filled area then stroked line', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3, 4, 5],
      params: { sparkline: { type: 'area' } },
    }));
    // Two-pass paint: closed area path (fill) + open polyline (stroke).
    expect((gc.beginPath as any)).toHaveBeenCalledTimes(2);
    expect((gc.fill as any)).toHaveBeenCalledTimes(1);
    expect((gc.stroke as any)).toHaveBeenCalledTimes(1);
  });

  it('honors fill + lineColor options', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3],
      params: {
        sparkline: {
          type: 'area',
          options: { fill: 'rgba(37,99,235,0.15)', lineColor: '#2563eb' },
        },
      },
    }));
    // strokeStyle is set last (stroke pass runs after fill pass).
    expect(gc.strokeStyle).toBe('#2563eb');
  });

  it('returns early on empty / single-point data', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [], params: { sparkline: { type: 'area' } } }));
    expect((gc.beginPath as any)).not.toHaveBeenCalled();

    const gc2 = makeGc();
    sparklineCell.paint(gc2, baseParams({ value: [3], params: { sparkline: { type: 'area' } } }));
    expect((gc2.beginPath as any)).not.toHaveBeenCalled();
  });
});

describe('bar sparkline (Task 2)', () => {
  it('dispatches via type: "bar" and paints horizontal bars', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [1, 2, 3, 4],
      params: { sparkline: { type: 'bar' } },
    }));
    expect((gc.fillRect as any).mock.calls.length).toBe(4);
  });

  it('bars grow rightward — wider rects encode larger values', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [10, 90],
      bounds: { x: 0, y: 0, w: 100, h: 40 },
      params: { sparkline: { type: 'bar' } },
    }));
    const calls = (gc.fillRect as any).mock.calls as [number, number, number, number][];
    // Bigger value → wider bar. With min=10, max=90, normalized: 0 and 1.
    const [, , w0] = calls[0]!;
    const [, , w1] = calls[1]!;
    expect(w1).toBeGreaterThan(w0);
  });

  it('returns early on empty data', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [], params: { sparkline: { type: 'bar' } } }));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
  });
});

describe('pie sparkline (Task 2)', () => {
  it('dispatches via type: "pie" — paints a ring with a single arc segment', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [25, 100],
      params: { sparkline: { type: 'pie' } },
    }));
    // Two arcs (track ring + filled segment), two fills.
    expect((gc.arc as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect((gc.fill as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('returns early on empty data', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [], params: { sparkline: { type: 'pie' } } }));
    expect((gc.arc as any)).not.toHaveBeenCalled();
  });

  it('honors fill color option', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({
      value: [25, 100],
      params: { sparkline: { type: 'pie', options: { fill: '#f59e0b' } } },
    }));
    // fillStyle should land on the segment color by the end of the paint.
    expect(gc.fillStyle).toBe('#f59e0b');
  });
});

describe('sparkline type dispatch (Task 2)', () => {
  it('defaults to line when type is omitted', () => {
    const gc = makeGc();
    sparklineCell.paint(gc, baseParams({ value: [1, 2, 3], params: { sparkline: {} } }));
    // Line variant produces a stroke; column/bar produce none.
    expect((gc.stroke as any)).toHaveBeenCalled();
  });

  it('no-ops when type is unrecognized (defensive — never throws)', () => {
    const gc = makeGc();
    expect(() => {
      sparklineCell.paint(gc, baseParams({
        value: [1, 2, 3],
        params: { sparkline: { type: 'unknown' as any } },
      }));
    }).not.toThrow();
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.stroke as any)).not.toHaveBeenCalled();
  });
});
