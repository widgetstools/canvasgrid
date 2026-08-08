import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SparklineTooltip } from '../src/interaction/features/sparklineTooltip';
import type { VelocityGridLike, VelocityGridEventCtx } from '../src/interaction/feature';
import type { Hit } from '../src/interaction/hitTester';

/**
 * Cycle 21 / Task 3 — sparkline tooltip overlay tests.
 *
 * The feature subscribes to mousemove + mouseleave. On hover into a
 * column whose cellRenderer is `'sparkline'` it mounts a single shared
 * DOM tooltip showing the closest data point. Tracking must NOT trigger
 * a canvas repaint (pure DOM overlay positioning).
 */

function makeGrid(over: Partial<VelocityGridLike> = {}): {
  grid: VelocityGridLike;
  overlay: HTMLElement;
  requestRepaint: ReturnType<typeof vi.fn>;
  getSparklineData: ReturnType<typeof vi.fn>;
} {
  const overlay = document.createElement('div');
  document.body.appendChild(overlay);
  const requestRepaint = vi.fn();
  const getSparklineData = vi.fn();
  const canvasEl = document.createElement('canvas');
  const grid = {
    canvas: {
      canvas: canvasEl,
      requestRepaint,
    },
    getOverlayHost: () => overlay,
    getSparklineData,
    columnLeftOf: (_colId: string) => 0,
    columnWidthOf: (_colId: string) => 100,
    ...over,
  } as unknown as VelocityGridLike;
  return { grid, overlay, requestRepaint, getSparklineData };
}

function moveCtx(grid: VelocityGridLike, hit: Hit, raw: Partial<MouseEvent>): VelocityGridEventCtx {
  return {
    grid,
    hit,
    point: { x: 0, y: 0 },
    raw: { type: 'mousemove', clientX: 0, clientY: 0, offsetX: 0, ...raw } as MouseEvent,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('SparklineTooltip — mount + content', () => {
  it('mounts a tooltip into the overlay host on first sparkline-cell mousemove', () => {
    const { grid, overlay, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([1, 2, 3, 4, 5]);
    const feature = new SparklineTooltip();
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: 100, clientY: 200, offsetX: 50,
    }));
    const tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement | null;
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toMatch(/\d+/); // shows at least the value
  });

  it('renders <index, value> for the nearest data point', () => {
    const { grid, overlay, getSparklineData } = makeGrid({
      columnLeftOf: () => 0,
      columnWidthOf: () => 100,
    });
    getSparklineData.mockReturnValue([10, 20, 30, 40, 50]);
    const feature = new SparklineTooltip();
    // Five evenly-spaced points across width 100 (minus 2px inner pad on each
    // side → 96px useable). Nearest to x=2 is index 0, x=98 is index 4, x=50
    // is index 2.
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 1, colId: 'spark' }, {
      clientX: 200, clientY: 100, offsetX: 50,
    }));
    const tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement;
    expect(tip.textContent).toContain('30');
  });
});

describe('SparklineTooltip — nearest-index math', () => {
  it.each([
    { offsetX: 2,  expectedValue: 10 },   // far left → index 0
    { offsetX: 26, expectedValue: 20 },   // ~1/4 → index 1
    { offsetX: 50, expectedValue: 30 },   // middle → index 2
    { offsetX: 74, expectedValue: 40 },   // ~3/4 → index 3
    { offsetX: 98, expectedValue: 50 },   // far right → index 4
  ])('offsetX=$offsetX maps to value $expectedValue', ({ offsetX, expectedValue }) => {
    const { grid, overlay, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([10, 20, 30, 40, 50]);
    const feature = new SparklineTooltip();
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: offsetX, clientY: 100, offsetX,
    }));
    const tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement;
    expect(tip.textContent).toContain(String(expectedValue));
  });
});

describe('SparklineTooltip — positioning', () => {
  it('positions at (clientX, clientY - 24px)', () => {
    const { grid, overlay, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([1, 2, 3]);
    const feature = new SparklineTooltip();
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: 300, clientY: 400, offsetX: 50,
    }));
    const tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement;
    // Tooltip is positioned via inline styles — assert the two coords.
    expect(tip.style.left).toBe('300px');
    expect(tip.style.top).toBe('376px');
  });
});

describe('SparklineTooltip — hide lifecycle', () => {
  it('hides the tooltip when the hit leaves the sparkline cell', () => {
    const { grid, overlay, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([1, 2, 3]);
    const feature = new SparklineTooltip();
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: 100, clientY: 100, offsetX: 10,
    }));
    let tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement;
    expect(tip.style.display).not.toBe('none');

    // Mouse moves to a non-sparkline cell (different colId, no data).
    getSparklineData.mockReturnValue(null);
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'plain' }, {
      clientX: 200, clientY: 100, offsetX: 10,
    }));
    tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement;
    expect(tip.style.display).toBe('none');
  });

  it('hides the tooltip when the hit becomes empty / non-cell', () => {
    const { grid, overlay, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([1, 2, 3]);
    const feature = new SparklineTooltip();
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: 100, clientY: 100, offsetX: 10,
    }));
    feature.handleMouseMove(moveCtx(grid, { kind: 'empty' }, {
      clientX: 200, clientY: 100, offsetX: 10,
    }));
    const tip = overlay.querySelector('.vg-sparkline-tooltip') as HTMLElement;
    expect(tip.style.display).toBe('none');
  });
});

describe('SparklineTooltip — no canvas repaint', () => {
  it('does not call requestRepaint on mousemove (DOM-only positioning)', () => {
    const { grid, requestRepaint, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([1, 2, 3]);
    const feature = new SparklineTooltip();
    for (let i = 0; i < 5; i++) {
      feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
        clientX: 100 + i * 5, clientY: 100, offsetX: 10 + i * 5,
      }));
    }
    expect(requestRepaint).not.toHaveBeenCalled();
  });

  it('does not call requestRepaint when leaving the sparkline cell either', () => {
    const { grid, requestRepaint, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValueOnce([1, 2, 3]).mockReturnValue(null);
    const feature = new SparklineTooltip();
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: 100, clientY: 100, offsetX: 10,
    }));
    feature.handleMouseMove(moveCtx(grid, { kind: 'empty' }, {
      clientX: 200, clientY: 100, offsetX: 10,
    }));
    expect(requestRepaint).not.toHaveBeenCalled();
  });
});

describe('SparklineTooltip — forwards through the chain', () => {
  it('calls super.handleMouseMove so downstream features still see moves', () => {
    const { grid, getSparklineData } = makeGrid();
    getSparklineData.mockReturnValue([1, 2, 3]);
    const downstream = { handleMouseMove: vi.fn() };
    const feature = new SparklineTooltip();
    (feature as any).next = downstream;
    feature.handleMouseMove(moveCtx(grid, { kind: 'cell', rowIndex: 0, colId: 'spark' }, {
      clientX: 100, clientY: 100, offsetX: 10,
    }));
    expect(downstream.handleMouseMove).toHaveBeenCalledTimes(1);
  });
});
