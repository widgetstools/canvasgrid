/**
 * FloatingPanelHost — pure clamp math.
 *
 * Factored out of the host so the drag/resize arithmetic is unit-testable
 * without a DOM: given a candidate rect (in the coordinate space of the
 * overlaid `root` element), the root's content-box size, and a minimum
 * panel size, `clampRect` returns the rect adjusted so it never hangs off
 * an edge and never shrinks below `min`.
 *
 * Order of operations matters: size is resolved FIRST (raised to `min`,
 * then capped to `bounds` so an oversized min never overshoots a small
 * container), and position is resolved SECOND against the final size —
 * growing a corner-anchored rect up to its minimum can itself push the
 * rect back inside the bounds.
 */

export interface FloatingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingBounds {
  w: number;
  h: number;
}

export interface FloatingMinSize {
  w: number;
  h: number;
}

export function clampRect(rect: FloatingRect, bounds: FloatingBounds, min: FloatingMinSize): FloatingRect {
  const w = Math.min(Math.max(rect.w, min.w), bounds.w);
  const h = Math.min(Math.max(rect.h, min.h), bounds.h);
  const maxX = Math.max(0, bounds.w - w);
  const maxY = Math.max(0, bounds.h - h);
  const x = Math.min(Math.max(rect.x, 0), maxX);
  const y = Math.min(Math.max(rect.y, 0), maxY);
  return { x, y, w, h };
}
