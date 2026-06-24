import type { PainterCtx } from './types';
import type { ViewportColumn } from '../../core/viewport';
import type { CachedContext2D } from '../gc';

/**
 * Paints all grid lines in one pass at the end of a frame.
 *
 * - Verticals: one `fillRect` per column right edge, drawn within each pinned/center
 *   band (clipped, so center cols scrolled past the body don't leak into pinned bands).
 *   Span the full canvas height (0..bodyBottom) so header column separators are
 *   visible too — without this, the header row reads as one merged strip.
 * - Horizontals: one `fillRect` per visible row bottom + every header row bottom,
 *   spanning the full visible width so the line is continuous across pinned bands.
 * - Pinned band edges: one `fillRect` each, using `theme.borderColor` (slightly
 *   heavier than `gridLineColor`) at the right edge of left-pinned and left edge of
 *   right-pinned bands, also spanning the full canvas height.
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

  // Locate the LEAF-header row top — the last header subgrid is the leaf
  // header; any rows above it are group-header rows. Verticals start at the
  // leaf-header top so group-header cells (which span multiple leaves) read
  // as one merged rect instead of being sliced by per-leaf separators. When
  // there are no header subgrids, fall back to 0 (no header at all).
  let leafHeaderTop = 0;
  for (const row of vs.visibleRows) {
    if (row.subgrid.isHeader) leafHeaderTop = row.top;
  }

  // Horizontals — one per visible row bottom for BOTH header and data rows.
  // The bottom of group-header rows visually separates depth levels above the
  // leaf header. Skip data rows whose bottom lands outside the body region
  // (overscan rows above/below).
  gc.cache.fillStyle = theme.gridLineColor;
  for (const row of vs.visibleRows) {
    if (row.subgrid.isData) {
      if (row.bottom <= vs.bodyTop || row.bottom > vs.bodyBottom) continue;
    } else if (!row.subgrid.isHeader) {
      continue; // totals/footer not yet wired
    }
    const y = Math.round(row.bottom) - 1;
    gc.fillRect(0, y, rightEdge, 1);
  }

  // Verticals — one band at a time so out-of-band column lines stay clipped.
  // Span from leafHeaderTop to bodyBottom so the leaf header + data rows get
  // column separators while group-header rows above stay merged.
  const leftPinned = vs.visibleColumns.filter((c) => c.pinned === 'left');
  const center = vs.visibleColumns.filter((c) => !c.pinned);
  const rightPinned = vs.visibleColumns.filter((c) => c.pinned === 'right');

  paintVerticalsInBand(gc, leftPinned, 0, vs.bodyLeft, leafHeaderTop, vs.bodyBottom, theme.gridLineColor);
  paintVerticalsInBand(gc, center, vs.bodyLeft, vs.bodyRight, leafHeaderTop, vs.bodyBottom, theme.gridLineColor);
  paintVerticalsInBand(gc, rightPinned, vs.bodyRight, rightEdge, leafHeaderTop, vs.bodyBottom, theme.gridLineColor);

  // Group-header rows: paint verticals ONLY at group boundaries (where two
  // adjacent leaves resolve to different groups at this depth). Inside a
  // group span the cells stay merged. Cells where both neighbours are
  // ungrouped at this depth also stay un-divided so the row reads quietly
  // outside the grouped regions.
  for (const row of vs.visibleRows) {
    if (!row.subgrid.isHeader) continue;
    const sg = row.subgrid as { getGroupIdAt?: (colId: string) => string | null };
    if (typeof sg.getGroupIdAt !== 'function') continue;
    paintGroupBoundariesInBand(gc, leftPinned, 0, vs.bodyLeft, row.top, row.bottom, sg, theme.gridLineColor);
    paintGroupBoundariesInBand(gc, center, vs.bodyLeft, vs.bodyRight, row.top, row.bottom, sg, theme.gridLineColor);
    paintGroupBoundariesInBand(gc, rightPinned, vs.bodyRight, rightEdge, row.top, row.bottom, sg, theme.gridLineColor);
  }

  // Pinned-band edges — heavier line via theme.borderColor. Span from the top
  // of the canvas to bodyBottom so the pinned/scroll divider is visible even
  // through group-header rows (the divider doesn't subdivide a single cell —
  // it separates pinned from scrollable regions, which is meaningful at every
  // header depth).
  if (leftPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyLeft) - 1, 0, 1, vs.bodyBottom);
  }
  if (rightPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyRight), 0, 1, vs.bodyBottom);
  }

  // Subgrid separator — header→body. The leaf-header bottom already paints a
  // gridLineColor horizontal above; this overlays a slightly heavier borderColor
  // line at exactly bodyTop - 1 so the transition reads clearly.
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

/** Paint verticals only at group boundaries in a group-header row.
 *  A boundary exists between adjacent columns whose groupId at this row's
 *  depth differs (and at least one is non-null). Inside a contiguous group
 *  span both neighbours share the same groupId — no vertical. Between two
 *  ungrouped columns both are null — also no vertical, so the un-grouped
 *  area of the group-header reads as one quiet strip. */
function paintGroupBoundariesInBand(
  gc: CachedContext2D,
  cols: ViewportColumn[],
  bandLeft: number,
  bandRight: number,
  top: number,
  bottom: number,
  subgrid: { getGroupIdAt?: (colId: string) => string | null },
  color: string,
): void {
  if (cols.length <= 1 || !subgrid.getGroupIdAt) return;
  gc.cache.save();
  gc.beginPath();
  gc.rect(bandLeft, top, bandRight - bandLeft, bottom - top);
  gc.clip();
  gc.cache.fillStyle = color;
  for (let i = 0; i < cols.length - 1; i++) {
    const a = subgrid.getGroupIdAt(cols[i]!.colId);
    const b = subgrid.getGroupIdAt(cols[i + 1]!.colId);
    if (a === b) continue;
    // a !== b — at least one side belongs to a group; emit a boundary line.
    const x = Math.round(cols[i]!.right) - 1;
    gc.fillRect(x, top, 1, bottom - top);
  }
  gc.cache.restore();
}
