// Cycle 27 / Task 3 — Cell decorator painter.
//
// Decorators are small icons / emojis / dots / short text labels
// anchored to one of six positions inside a cell (TL/TR/BL/BR/ML/MR).
// They overlay the cell content — they don't shrink the content area
// (use `cellStyle.padding` for that).
//
// Up to 6 decorators per cell (one per position). The renderer doesn't
// enforce the cap — it just iterates whatever array it gets. Validation
// can layer on top if needed (a follow-up cycle could warn on duplicate
// positions and clamp the array length).

import type { CachedContext2D } from '../gc';
import type { CellDecorator, DecoratorPosition } from '../../types';
import { drawIcon, hasIcon } from '../icons';
import { resolveIcon as resolveLucideIcon } from '../../icons/registry';

const DEFAULT_SIZE = 12;
const DEFAULT_DOT_SIZE = 6;
const DEFAULT_INSET = 2;

/** Compute the (x, y) center point for a decorator of the given size
 *  at one of the six positions, with `inset` distance from the cell
 *  edge. Pure — exported so tests can verify the math in isolation. */
export function computeDecoratorPosition(
  bounds: { x: number; y: number; w: number; h: number },
  position: DecoratorPosition,
  size: number,
  inset: number,
): { x: number; y: number } {
  const half = size / 2;
  switch (position) {
    case 'tl': return { x: bounds.x + inset + half,             y: bounds.y + inset + half };
    case 'tr': return { x: bounds.x + bounds.w - inset - half,  y: bounds.y + inset + half };
    case 'bl': return { x: bounds.x + inset + half,             y: bounds.y + bounds.h - inset - half };
    case 'br': return { x: bounds.x + bounds.w - inset - half,  y: bounds.y + bounds.h - inset - half };
    case 'ml': return { x: bounds.x + inset + half,             y: bounds.y + bounds.h / 2 };
    case 'mr': return { x: bounds.x + bounds.w - inset - half,  y: bounds.y + bounds.h / 2 };
  }
}

/** Paint every decorator in `decorators` over the cell. No-op on empty
 *  array. Each decorator paints AFTER content so it sits on top.
 *  Save/restore around each so canvas state never leaks. */
export function paintCellDecorators(
  gc: CachedContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  decorators: readonly CellDecorator[],
): void {
  if (decorators.length === 0) return;
  for (const d of decorators) {
    paintOne(gc, bounds, d);
  }
}

function paintOne(
  gc: CachedContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  d: CellDecorator,
): void {
  const size = d.size ?? (d.kind === 'dot' ? DEFAULT_DOT_SIZE : DEFAULT_SIZE);
  const inset = d.inset ?? DEFAULT_INSET;
  const pos = computeDecoratorPosition(bounds, d.position, size, inset);

  // Optional bg circle (badge backdrop). Painted first so decorator sits on top.
  if (d.bg) {
    const bgRadius = Math.max(size / 2 + 2, size * 0.65);
    gc.cache.save();
    gc.cache.fillStyle = d.bg;
    gc.beginPath();
    gc.arc(pos.x, pos.y, bgRadius, 0, Math.PI * 2);
    gc.fill();
    gc.cache.restore();
  }

  gc.cache.save();
  switch (d.kind) {
    case 'dot': {
      gc.cache.fillStyle = d.color;
      gc.beginPath();
      gc.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
      gc.fill();
      break;
    }
    case 'emoji':
    case 'text': {
      gc.cache.fillStyle = d.color ?? '#000';
      gc.cache.font = `${size}px sans-serif`;
      gc.cache.textAlign = 'center';
      gc.cache.textBaseline = 'middle';
      gc.fillText(d.value, pos.x, pos.y);
      break;
    }
    case 'icon': {
      // Resolve from the Lucide icon-set registry FIRST — the same source
      // the cellIcon/headerIcon content slots paint from — so any icon a
      // picker can apply inline also paints as a positional decorator.
      // (Previously only the small chrome set was consulted, silently
      // dropping catalog icons like 'flame' at tl/tr/bl/br/ml/mr.)
      const lucide = d.icon !== undefined ? resolveLucideIcon(d.icon) : null;
      if (lucide) {
        gc.translate(pos.x - size / 2, pos.y - size / 2);
        const scale = size / 24; // Lucide viewBox is 24×24
        gc.scale(scale, scale);
        gc.cache.strokeStyle = d.color ?? '#000';
        gc.cache.lineWidth = 2 / scale;
        gc.cache.lineCap = 'round';
        gc.cache.lineJoin = 'round';
        gc.stroke(lucide);
        break;
      }
      if (!hasIcon(d.icon)) break;
      drawIcon(gc as unknown as CanvasRenderingContext2D, d.icon, pos.x, pos.y, size, {
        color: d.color ?? '#000',
        strokeWidth: 2,
      });
      break;
    }
  }
  gc.cache.restore();
}
