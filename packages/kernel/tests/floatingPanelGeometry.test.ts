// FloatingPanelHost — geometry unit tests.
//
// `clampRect` is the pure math behind both the drag and resize gestures:
// given a candidate rect, the container bounds, and a minimum size, it
// returns the rect pinned inside the bounds with size floored at `min`.
// Kept side-effect-free (no DOM) so the full matrix is covered without a
// browser-like environment.

import { describe, it, expect } from 'vitest';
import { clampRect, type FloatingRect } from '../src/interaction/floatingPanel/geometry';

const bounds = { w: 800, h: 600 };
const min = { w: 240, h: 160 };

describe('clampRect', () => {
  it('leaves a rect fully inside the bounds unchanged', () => {
    const rect: FloatingRect = { x: 100, y: 80, w: 300, h: 200 };
    expect(clampRect(rect, bounds, min)).toEqual(rect);
  });

  it('pushes a rect back inside when it hangs past the right/bottom edge', () => {
    const rect: FloatingRect = { x: 700, y: 550, w: 300, h: 200 };
    expect(clampRect(rect, bounds, min)).toEqual({ x: 500, y: 400, w: 300, h: 200 });
  });

  it('pushes a rect back inside when x/y are negative (past the left/top edge)', () => {
    const rect: FloatingRect = { x: -40, y: -20, w: 300, h: 200 };
    expect(clampRect(rect, bounds, min)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });

  it('raises width/height below the minimum up to the minimum, anchored at x/y', () => {
    const rect: FloatingRect = { x: 100, y: 100, w: 100, h: 50 };
    expect(clampRect(rect, bounds, min)).toEqual({ x: 100, y: 100, w: 240, h: 160 });
  });

  it('clamps a rect larger than the bounds down to the bounds and pins it at the origin', () => {
    const rect: FloatingRect = { x: 50, y: 50, w: 1000, h: 900 };
    expect(clampRect(rect, bounds, min)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('composes size-raising and position-clamping: growing to min size can push x/y back in', () => {
    // Right-anchored small rect: raising width to min would hang off the
    // right edge unless the position clamp (which runs after sizing) pulls
    // it back in.
    const rect: FloatingRect = { x: 780, y: 580, w: 20, h: 20 };
    expect(clampRect(rect, bounds, min)).toEqual({ x: 560, y: 440, w: 240, h: 160 });
  });

  it('when min exceeds bounds, size is capped at bounds (never overshoots the container)', () => {
    const tinyBounds = { w: 200, h: 100 };
    const rect: FloatingRect = { x: 0, y: 0, w: 50, h: 50 };
    expect(clampRect(rect, tinyBounds, min)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
});
