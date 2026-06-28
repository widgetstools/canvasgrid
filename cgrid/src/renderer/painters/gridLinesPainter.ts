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
  // (overscan rows above/below). Pinned rows (Cycle 14 / Task 2) paint
  // gridlines too so multi-pinned stacks read as connected member rows; the
  // structural border pass below overpaints the body-side edge with
  // `pinnedRowBorder` so the transition between the pinned stack and the
  // scrollable body reads as a single deliberate hairline.
  gc.cache.fillStyle = theme.gridLineColor;
  for (const row of vs.visibleRows) {
    if (row.subgrid.isData) {
      if (row.bottom <= vs.bodyTop || row.bottom > vs.bodyBottom) continue;
    } else if (!row.subgrid.isHeader && !row.subgrid.isPinned) {
      continue; // totals/footer skip the per-row gridline (totals draws its own border below)
    }
    const y = Math.round(row.bottom) - 1;
    gc.fillRect(0, y, rightEdge, 1);
  }

  // Cycle 14 / Task 1 — totals row top border. The single "hairline lift"
  // signature from the design plan — 1px solid `theme.totalsBorderTop`
  // painted at `Math.round(row.top) - 1`. Mirrors the bodyTop separator
  // idiom further down, so the rule reads as part of the grid's visual
  // grammar (not a one-off). Only the FIRST totals-row in stack gets a
  // top border (a multi-row pinned totals subgrid is rare; if a future
  // task ships one, this loop already handles it because every row's
  // own top gets its rule).
  for (const row of vs.visibleRows) {
    if (!row.subgrid.isTotals) continue;
    gc.cache.fillStyle = theme.totalsBorderTop;
    gc.fillRect(0, Math.round(row.top) - 1, rightEdge, 1);
  }

  // Cycle 15 / Task 12 — per-group footer row top border. Same hairline
  // lift signature as the grand-totals row but painted on inline footer
  // rows (DataSubgrid rows whose `chunk.rowKinds[localIndex] === 3`).
  // Reads `theme.groupFooterBorderTop` so apps can dial the per-group
  // border independently of the grand-total. Painted AFTER the data-row
  // gridline above (drawn at `row.top - 1` so it overpaints the gridline
  // at the row immediately above the footer). Guarded for partial
  // PainterCtx instances built by older tests (the probe is optional).
  const rowKindAt = p.rowKindAt;
  if (rowKindAt) {
    for (const row of vs.visibleRows) {
      if (!row.subgrid.isData) continue;
      if (rowKindAt(row.localRowIndex) !== 3) continue;
      gc.cache.fillStyle = theme.groupFooterBorderTop;
      gc.fillRect(0, Math.round(row.top) - 1, rightEdge, 1);
    }
  }

  // Verticals — one band at a time so out-of-band column lines stay clipped.
  // Span from leafHeaderTop to the bottom of the LAST rendered row so column
  // separators don't bleed into empty canvas below the data.
  const leftPinned = vs.visibleColumns.filter((c) => c.pinned === 'left');
  const center = vs.visibleColumns.filter((c) => !c.pinned);
  const rightPinned = vs.visibleColumns.filter((c) => c.pinned === 'right');

  // Compute the bottom of the last visible non-header row; if there are no
  // data/totals rows yet, fall back to bodyTop (verticals span header only).
  let lastRowBottom = vs.bodyTop;
  for (const row of vs.visibleRows) {
    if (row.subgrid.isHeader) continue;
    const b = Math.min(row.bottom, vs.bodyBottom);
    if (b > lastRowBottom) lastRowBottom = b;
  }

  paintVerticalsInBand(gc, leftPinned, 0, vs.bodyLeft, leafHeaderTop, lastRowBottom, theme.gridLineColor);
  paintVerticalsInBand(gc, center, vs.bodyLeft, vs.bodyRight, leafHeaderTop, lastRowBottom, theme.gridLineColor);
  paintVerticalsInBand(gc, rightPinned, vs.bodyRight, rightEdge, leafHeaderTop, lastRowBottom, theme.gridLineColor);

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

  // Pinned-band edges — heavier line via theme.borderColor. Stop at
  // lastRowBottom (same as verticals) so the divider doesn't extend into
  // empty canvas below the data area.
  if (leftPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyLeft) - 1, 0, 1, lastRowBottom);
  }
  if (rightPinned.length > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(Math.round(vs.bodyRight), 0, 1, lastRowBottom);
  }

  // Subgrid separator — header→body. The leaf-header bottom already paints a
  // gridLineColor horizontal above; this overlays a slightly heavier borderColor
  // line at exactly bodyTop - 1 so the transition reads clearly.
  if (vs.bodyTop > 0) {
    gc.cache.fillStyle = theme.borderColor;
    gc.fillRect(0, Math.round(vs.bodyTop) - 1, rightEdge, 1);
  }

  // Cycle 14 / Task 2 — pinned stack ↔ data structural border. Painted
  // LAST so it overpaints both the per-row gridline (laid down in the
  // horizontals pass above) AND the bodyTop separator (when pinned-top
  // pushes bodyTop down to the bottom of the pinned stack). This keeps
  // BOTH pinned↔data boundaries — top stack ↔ data and data ↔ bottom
  // stack — at the same `theme.pinnedRowBorder` hairline color, matching
  // the design plan's "same border color on both pinned and totals".
  // The pinned↔totals transition is intentionally NOT drawn here: the
  // totals row paints its own top border above, which is the body-edge
  // boundary for that pair.
  for (let r = 0; r < vs.visibleRows.length; r++) {
    const a = vs.visibleRows[r]!;
    const b = vs.visibleRows[r + 1];
    if (!b) continue;
    const aPinned = a.subgrid.isPinned === true;
    const bPinned = b.subgrid.isPinned === true;
    if (aPinned === bPinned) continue;
    if (!(a.subgrid.isData || b.subgrid.isData)) continue;
    gc.cache.fillStyle = theme.pinnedRowBorder;
    gc.fillRect(0, Math.round(a.bottom) - 1, rightEdge, 1);
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
