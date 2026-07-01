// Cycle 27 / Task 2 — Per-cell border painter.
//
// Pure: given a canvas context, cell bounds, and a `BorderSpec`, strokes
// up to four lines (one per side). `all` provides a fallback for sides
// not explicitly listed (explicit side wins). Styles supported: solid,
// dashed, dotted, double.
//
// Cell painters call this after content paint, so borders sit on top of
// background and content. The grid-line painter still draws the global
// 1px grid; per-cell borders overlay where set.

import type { CachedContext2D } from '../gc';
import type { BorderSide, BorderSpec, BorderStyle } from '../../types';

type SideName = 'top' | 'right' | 'bottom' | 'left';

const SIDE_ORDER: readonly SideName[] = ['top', 'right', 'bottom', 'left'];

/** Paint the (up to) four sides of a cell border. No-op when `spec` has
 *  no visible sides. Saves/restores the canvas state so it doesn't leak
 *  setLineDash / strokeStyle across cells. */
export function paintCellBorders(
  gc: CachedContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  spec: BorderSpec,
): void {
  // Pre-compute each side's effective spec (own value, else `all`).
  // Iterate in fixed order so output is deterministic.
  for (const side of SIDE_ORDER) {
    const sideSpec = spec[side] ?? spec.all;
    if (!sideSpec || !sideSpec.width || sideSpec.width === 0) continue;
    paintSide(gc, bounds, side, sideSpec);
  }
}

function paintSide(
  gc: CachedContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  side: SideName,
  spec: BorderSide,
): void {
  const width = spec.width!;
  const color = spec.color ?? '#000';
  const style: BorderStyle = spec.style ?? 'solid';

  gc.cache.save();
  gc.cache.strokeStyle = color;
  gc.cache.lineWidth = width;
  setDashPattern(gc, style, width);

  if (style === 'double') {
    // Two parallel strokes separated by `width`. Each stroke is `width`
    // wide. Outer first, then inner.
    strokeSide(gc, bounds, side, 0);
    strokeSide(gc, bounds, side, width * 2);
  } else {
    strokeSide(gc, bounds, side, 0);
  }
  gc.cache.restore();
}

function setDashPattern(gc: CachedContext2D, style: BorderStyle, width: number): void {
  // setLineDash lives on the raw CanvasRenderingContext2D (a method, not a
  // tracked property), so it's reached via `gc` directly — NOT `gc.cache`.
  // The save/restore around the side wrapper unwinds the dash pattern.
  switch (style) {
    case 'solid':
    case 'double':
      gc.setLineDash([]); return;
    case 'dashed':
      gc.setLineDash([width * 3, width * 2]); return;
    case 'dotted':
      gc.setLineDash([width, width]); return;
  }
}

function strokeSide(
  gc: CachedContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  side: SideName,
  inset: number,
): void {
  gc.beginPath();
  switch (side) {
    case 'top':
      gc.moveTo(bounds.x, bounds.y + inset);
      gc.lineTo(bounds.x + bounds.w, bounds.y + inset);
      break;
    case 'right':
      gc.moveTo(bounds.x + bounds.w - inset, bounds.y);
      gc.lineTo(bounds.x + bounds.w - inset, bounds.y + bounds.h);
      break;
    case 'bottom':
      gc.moveTo(bounds.x, bounds.y + bounds.h - inset);
      gc.lineTo(bounds.x + bounds.w, bounds.y + bounds.h - inset);
      break;
    case 'left':
      gc.moveTo(bounds.x + inset, bounds.y);
      gc.lineTo(bounds.x + inset, bounds.y + bounds.h);
      break;
  }
  gc.stroke();
}
