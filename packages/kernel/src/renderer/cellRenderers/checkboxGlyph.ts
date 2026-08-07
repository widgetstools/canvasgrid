/**
 * Shared checkbox glyph painting for canvas surfaces (boolean cells,
 * row-select, group tri-state, header select-all). One geometry so the
 * check and indeterminate dash stay optically centered in the box —
 * matching the DOM `.cg-checkbox` vocabulary.
 */
import type { CachedContext2D } from '../gc';

export const CHECKBOX_GLYPH_SIZE = 14;

/** Outlined 14×14 box (optional fill). Half-pixel snap for crisp 1px strokes. */
export function paintCheckboxBox(
  gc: CachedContext2D,
  x: number,
  y: number,
  size: number,
  opts: { borderColor: string; fill?: string | null },
): void {
  if (opts.fill && opts.fill !== 'transparent') {
    gc.cache.fillStyle = opts.fill;
    gc.fillRect(x, y, size, size);
  }
  gc.cache.strokeStyle = opts.borderColor;
  gc.cache.lineWidth = 1;
  gc.strokeRect(x + 0.5, y + 0.5, size, size);
}

/**
 * √ checkmark centered in the box. Anchored on the box mid so it shares
 * the same visual center as the indeterminate dash (not a bottom-right
 * biased L from fixed corner offsets).
 */
export function paintCheckboxCheck(
  gc: CachedContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  gc.cache.strokeStyle = color;
  gc.cache.lineWidth = 1.5;
  gc.cache.lineCap = 'square';
  gc.cache.lineJoin = 'miter';
  gc.beginPath();
  // Short arm (left → bottom), long arm (bottom → top-right). Offsets are
  // relative to center so the glyph's visual mass stays mid-box.
  gc.moveTo(cx - 3.5, cy + 0.2);
  gc.lineTo(cx - 1.1, cy + 2.8);
  gc.lineTo(cx + 3.6, cy - 3.2);
  gc.stroke();
}

/** Horizontal dash through the vertical mid — indeterminate / partial. */
export function paintCheckboxDash(
  gc: CachedContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const midY = y + size / 2 + 0.5;
  gc.cache.strokeStyle = color;
  gc.cache.lineWidth = 1.5;
  gc.cache.lineCap = 'butt';
  gc.beginPath();
  gc.moveTo(x + 3, midY);
  gc.lineTo(x + size - 3, midY);
  gc.stroke();
}
