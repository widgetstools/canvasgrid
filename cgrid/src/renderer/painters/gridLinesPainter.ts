import type { PainterCtx } from './types';
import type { ViewportColumn } from '../../core/viewport';
import type { CachedContext2D } from '../gc';

/**
 * Paints all grid lines in one pass at the end of a frame.
 *
 * - Verticals: one `fillRect` per column right edge, drawn within each pinned/center
 *   band (clipped, so center cols scrolled past the body don't leak into pinned bands).
 *   The last column in each band is skipped — its right edge is either the band
 *   boundary (drawn separately with `borderColor`) or the viewport's right edge.
 * - Horizontals: one `fillRect` per visible row bottom, spanning the full visible width
 *   so the line is continuous across pinned bands.
 * - Pinned band edges: one `fillRect` each, using `theme.borderColor` (slightly
 *   heavier than `gridLineColor`) at the right edge of left-pinned and left edge of
 *   right-pinned bands.
 *
 * No `strokeRect`, no `stroke()` — every line is a `fillRect` aligned to integer
 * pixels so adjacent lines never re-draw the same pixel.
 */
export function paintGridLines(gc: CachedContext2D, p: PainterCtx): void {
  const { viewport: vs, theme } = p;
  if (vs.visibleColumns.length === 0 && vs.visibleRows.length === 0) return;

  // Full right edge of the painted area: rightmost visible column or the body
  // right (whichever is larger; rightPinned columns extend past bodyRight).
  const rightEdge = vs.visibleColumns.length === 0
    ? vs.bodyRight
    : Math.max(vs.bodyRight, ...vs.visibleColumns.map((c) => c.right));

  // Horizontals — one per visible data row bottom, spanning the full painted width.
  // Header rows aren't gridlines-eligible (their own band-divider in headerPainter
  // covers the header→body separator). Skip rows whose bottom lands outside the
  // body region (overscan rows above/below).
  gc.cache.fillStyle = theme.gridLineColor;
  for (const row of vs.visibleRows) {
    if (!row.subgrid.isData) continue;
    if (row.bottom <= vs.bodyTop || row.bottom > vs.bodyBottom) continue;
    const y = Math.round(row.bottom) - 1;
    gc.fillRect(0, y, rightEdge, 1);
  }

  // Verticals — one band at a time so out-of-band column lines stay clipped.
  const leftPinned = vs.visibleColumns.filter((c) => c.pinned === 'left');
  const center = vs.visibleColumns.filter((c) => !c.pinned);
  const rightPinned = vs.visibleColumns.filter((c) => c.pinned === 'right');

  paintVerticalsInBand(gc, leftPinned, 0, vs.bodyLeft, vs.bodyTop, vs.bodyBottom, theme.gridLineColor);
  paintVerticalsInBand(gc, center, vs.bodyLeft, vs.bodyRight, vs.bodyTop, vs.bodyBottom, theme.gridLineColor);
  paintVerticalsInBand(gc, rightPinned, vs.bodyRight, rightEdge, vs.bodyTop, vs.bodyBottom, theme.gridLineColor);

  // Pinned-band edges — heavier line via theme.borderColor, full body height.
  if (leftPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyLeft) - 1, vs.bodyTop, 1, vs.bodyBottom - vs.bodyTop);
  }
  if (rightPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyRight), vs.bodyTop, 1, vs.bodyBottom - vs.bodyTop);
  }

  // Subgrid separators — header→body, data→totals, etc.
  // bodyTop is the y where data rows start; a 1px borderColor line sits at bodyTop - 1.
  if (vs.bodyTop > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(0, Math.round(vs.bodyTop) - 1, rightEdge, 1);
  }
}

function paintVerticalsInBand(
  gc: CachedContext2D,
  cols: ViewportColumn[],
  bandLeft: number,
  bandRight: number,
  top: number,
  bottom: number,
  color: string,
): void {
  if (cols.length <= 1) return;
  gc.cache.save();
  gc.beginPath();
  gc.rect(bandLeft, top, bandRight - bandLeft, bottom - top);
  gc.clip();
  gc.cache.fillStyle = color;
  // Skip the last column — its right edge is the band boundary (or the viewport
  // edge for the rightmost band) and is either drawn as a band-edge line or
  // doesn't need one at all.
  for (let i = 0; i < cols.length - 1; i++) {
    const x = Math.round(cols[i]!.right) - 1;
    gc.fillRect(x, top, 1, bottom - top);
  }
  gc.cache.restore();
}
