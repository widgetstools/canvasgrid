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
 * The painter is allocation-free on the scroll path. `fillStyle` /
 * `strokeStyle` / `lineWidth` are set once before the loop; each visible
 * range emits a single `fillRect` + `strokeRect`.
 */
export function paintRangeOverlay(gc: CachedContext2D, p: PainterCtx): void {
  const ranges = p.selection.ranges;
  if (!ranges || ranges.length === 0) return;

  const vs = p.viewport;
  const theme = p.theme;

  // Clip every range fill / border to the scrollable body region so a
  // partially-scrolled range can't paint over the header (top) or
  // below the body bottom edge. `save` + `restore` brackets the loop
  // because the clip applies to all ranges plus the fill-handle paint
  // below.
  gc.save();
  gc.beginPath();
  gc.rect(0, vs.bodyTop, 1e6, vs.bodyBottom - vs.bodyTop);
  gc.clip();

  // Set draw state once. The painter doesn't save/restore between
  // ranges because every property it touches is unconditionally
  // rewritten on the next paint pass that needs them.
  gc.cache.fillStyle = theme.rangeFillColor;
  gc.cache.strokeStyle = theme.rangeBorderColor;
  gc.cache.lineWidth = 1;

  // Track the LAST range's bottom-right so we can paint the fill handle
  // on it after the per-range loop (the handle uses a different fillStyle).
  let lastBottomRight: { x: number; y: number } | null = null;

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;

    // Resolve the visible row band. We walk `visibleRows` looking for
    // data rows whose `localRowIndex` falls inside [rowStart, rowEnd].
    // The bounding rect uses the min top + max bottom across hits so
    // partially-visible ranges still paint a single contiguous strip.
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

    // Resolve the visible column band. `colIds` is small (typically 1..20)
    // so the inner `.indexOf` is fine; we avoid building a Set per frame.
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    const colIds = range.colIds;
    for (let c = 0; c < vs.visibleColumns.length; c++) {
      const col = vs.visibleColumns[c]!;
      if (colIds.indexOf(col.colId) === -1) continue;
      if (col.left < minLeft) minLeft = col.left;
      if (col.right > maxRight) maxRight = col.right;
    }
    if (minLeft === Number.POSITIVE_INFINITY) continue;

    const x = minLeft;
    const y = minTop;
    const w = maxRight - minLeft;
    const h = maxBottom - minTop;

    gc.fillRect(x, y, w, h);
    // Inset the border by 0.5px so the 1px stroke sits on the integer
    // pixel grid without anti-aliasing fuzz at canvas DPRs other than 1.
    gc.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    if (i === ranges.length - 1) {
      lastBottomRight = { x: maxRight, y: maxBottom };
    }
  }

  // Cycle 9 / Task 5 — fill handle paint. 6×6 square centered on the
  // bottom-right of the LAST range. The handle uses the opaque border
  // color so it's visible against the translucent fill. Only painted
  // when `showFillHandle` is true (cgrid host reads
  // `options.enableFillHandle`) AND the last range has any on-screen
  // footprint.
  if (p.showFillHandle && lastBottomRight !== null) {
    gc.cache.fillStyle = theme.rangeBorderColor;
    gc.fillRect(lastBottomRight.x - 3, lastBottomRight.y - 3, 6, 6);
  }

  gc.restore();
}
