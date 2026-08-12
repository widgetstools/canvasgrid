import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';

/**
 * Cycle 9 / Task 3 — paints `SelectionModel.ranges` as one translucent
 * fill + one opaque border per contiguous rect. Runs after the focus-ring
 * overlay so the range border layers above the cell content + bundles.
 *
 * Reads exclusively from the main-side `PainterCtx.selection.ranges` —
 * no worker round-trip. Ranges that fall entirely outside the visible
 * window (no overlapping data row OR no overlapping column) contribute
 * zero paint cost: the per-range loop bails before touching `gc`.
 *
 * Cycle 12 / Task 2 + fix: the band-aware corner-cell approach broke
 * partial ranges (a range whose top row had scrolled into overscan
 * above `bodyTop` was skipped entirely even though its middle rows
 * were on-screen). We walk EVERY visible data row inside the range
 * to compute the bounding box from raw `row.top` / `row.bottom`, then
 * wrap the paint in a band clip rect so the bounding box still can't
 * leak into the header (top), below body (bottom), or into pinned
 * zones (when the range's columns belong to the center band).
 */
export function paintRangeOverlay(gc: CachedContext2D, p: PainterCtx): void {
  const ranges = p.selection.ranges;
  if (!ranges || ranges.length === 0) return;

  const vs = p.viewport;
  const theme = p.theme;

  // Set draw state once. The painter doesn't save/restore between
  // ranges because every property it touches is unconditionally
  // rewritten on the next paint pass that needs them.
  gc.cache.fillStyle = theme.rangeFillColor;
  gc.cache.strokeStyle = theme.rangeBorderColor;
  gc.cache.lineWidth = 1;

  // Track the LAST range's bottom-right (in raw coords) so the fill
  // handle paints on top after the loop. The handle's own band clip
  // is the range's clip, so a handle on a center column won't bleed
  // into pinned zones either.
  let lastBottomRight: { x: number; y: number } | null = null;
  let lastClip: { xL: number; xR: number } | null = null;

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    const colIds = range.colIds;

    // Walk visible columns in display order. Track the band of the
    // FIRST matching column — every column in a range shares a pinned
    // status by construction (you can't drag a range across the
    // center↔pinned boundary), so one column's band defines the
    // horizontal clip for the whole range.
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let rangePinned: 'left' | 'right' | undefined;
    let sawCol = false;
    for (let c = 0; c < vs.visibleColumns.length; c++) {
      const col = vs.visibleColumns[c]!;
      if (colIds.indexOf(col.colId) === -1) continue;
      if (!sawCol) { rangePinned = col.pinned; sawCol = true; }
      if (col.left < minLeft) minLeft = col.left;
      if (col.right > maxRight) maxRight = col.right;
    }
    if (!sawCol) continue;

    // Walk visible data rows for the range, using raw row.top /
    // row.bottom (the helper rejects overscan rows whose top is
    // above bodyTop, which would otherwise skip a partial range).
    let minTop = Number.POSITIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (let r = 0; r < vs.visibleRows.length; r++) {
      const row = vs.visibleRows[r]!;
      if (!row.subgrid.isData) continue;
      if (row.localRowIndex < range.rowStart || row.localRowIndex > range.rowEnd) continue;
      if (row.top < minTop) minTop = row.top;
      if (row.bottom > maxBottom) maxBottom = row.bottom;
    }
    if (minTop === Number.POSITIVE_INFINITY) continue;

    // Per-range band clip. Matches the band rule the focus ring
    // uses: pinned-left → [0, bodyLeft], pinned-right → [bodyRight,
    // ∞], center → [bodyLeft, bodyRight]. Vertical clip is always
    // [bodyTop, bodyBottom].
    const xL = rangePinned === 'left' ? 0
      : rangePinned === 'right' ? vs.bodyRight
      : vs.bodyLeft;
    const xR = rangePinned === 'left' ? vs.bodyLeft
      : rangePinned === 'right' ? 1e6
      : vs.bodyRight;

    gc.save();
    gc.beginPath();
    gc.rect(xL, vs.bodyTop, xR - xL, vs.bodyBottom - vs.bodyTop);
    gc.clip();
    gc.fillRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
    // Inset the border by 0.5px so the 1px stroke sits on the integer
    // pixel grid without anti-aliasing fuzz at canvas DPRs other than 1.
    gc.strokeRect(minLeft + 0.5, minTop + 0.5, maxRight - minLeft - 1, maxBottom - minTop - 1);
    gc.restore();

    if (i === ranges.length - 1) {
      lastBottomRight = { x: maxRight, y: maxBottom };
      lastClip = { xL, xR };
    }
  }

  // Cycle 9 / Task 5 — fill handle paint. 6×6 square centered on the
  // bottom-right of the LAST range, clipped to the range's band so a
  // center-range handle can't bleed into a pinned zone.
  if (p.showFillHandle && lastBottomRight !== null && lastClip !== null) {
    gc.save();
    gc.beginPath();
    gc.rect(lastClip.xL, vs.bodyTop, lastClip.xR - lastClip.xL, vs.bodyBottom - vs.bodyTop);
    gc.clip();
    gc.cache.fillStyle = theme.rangeBorderColor;
    gc.fillRect(lastBottomRight.x - 3, lastBottomRight.y - 3, 6, 6);
    gc.restore();
  }
}
