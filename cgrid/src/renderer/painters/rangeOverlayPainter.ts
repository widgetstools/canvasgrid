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
 * Cycle 12 / Task 2 — band-clip math now lives behind
 * `PainterCtx.getVisibleCellBounds`. The painter resolves the visible
 * top-left + bottom-right corners of each range through the helper, so a
 * cell that has scrolled into a foreign band (center → pinned-left, etc.)
 * or out of `[bodyTop, bodyBottom]` is treated as not visible and the
 * range is skipped. No `bodyLeft / bodyRight` reads or `gc.clip` calls
 * remain.
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

  // Track the LAST range's band-aware bottom-right so the fill handle
  // hides when the bottom-right cell scrolled out of its band.
  let lastBottomRight: { x: number; y: number } | null = null;

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    const colIds = range.colIds;

    // Find leftmost + rightmost columns of this range present in the
    // visible window, in display order. `.indexOf` per column is fine
    // here — colIds is small (typically 1..20).
    let leftColId: string | null = null;
    let rightColId: string | null = null;
    for (let c = 0; c < vs.visibleColumns.length; c++) {
      const col = vs.visibleColumns[c]!;
      if (colIds.indexOf(col.colId) === -1) continue;
      if (leftColId === null) leftColId = col.colId;
      rightColId = col.colId;
    }
    if (leftColId === null || rightColId === null) continue;

    // Find topmost + bottommost data rows of this range present in the
    // visible window. Walks `visibleRows` in order, so the first
    // matching row is the topmost and the last is the bottommost.
    let topRowLocal = -1;
    let bottomRowLocal = -1;
    for (let r = 0; r < vs.visibleRows.length; r++) {
      const row = vs.visibleRows[r]!;
      if (!row.subgrid.isData) continue;
      if (row.localRowIndex < range.rowStart || row.localRowIndex > range.rowEnd) continue;
      if (topRowLocal === -1) topRowLocal = row.localRowIndex;
      bottomRowLocal = row.localRowIndex;
    }
    if (topRowLocal === -1) continue;

    // Resolve band-clipped corner bounds via the helper. When either
    // corner has scrolled out of its band (center → pinned zone, or
    // straddling the body's top/bottom edge), treat the range as having
    // no on-screen footprint and skip the paint.
    const topLeft = p.getVisibleCellBounds(topRowLocal, leftColId);
    const bottomRight = p.getVisibleCellBounds(bottomRowLocal, rightColId);
    if (!topLeft || !bottomRight) continue;

    const x = topLeft.x;
    const y = topLeft.y;
    const w = bottomRight.x + bottomRight.w - topLeft.x;
    const h = bottomRight.y + bottomRight.h - topLeft.y;

    gc.fillRect(x, y, w, h);
    // Inset the border by 0.5px so the 1px stroke sits on the integer
    // pixel grid without anti-aliasing fuzz at canvas DPRs other than 1.
    gc.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    if (i === ranges.length - 1) {
      lastBottomRight = {
        x: bottomRight.x + bottomRight.w,
        y: bottomRight.y + bottomRight.h,
      };
    }
  }

  // Cycle 9 / Task 5 — fill handle paint. 6×6 square centered on the
  // bottom-right of the LAST range. The handle uses the opaque border
  // color so it's visible against the translucent fill. Only painted
  // when `showFillHandle` is true (cgrid host reads
  // `options.enableFillHandle`) AND the last range's bottom-right cell
  // is band-visible.
  if (p.showFillHandle && lastBottomRight !== null) {
    gc.cache.fillStyle = theme.rangeBorderColor;
    gc.fillRect(lastBottomRight.x - 3, lastBottomRight.y - 3, 6, 6);
  }
}
