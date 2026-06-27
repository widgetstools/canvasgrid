import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';

export function paintOverlay(gc: CachedContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, selection } = p;
  const { focusedRowIndex, focusedColId } = selection;

  if (focusedRowIndex === null || focusedColId === null) return;

  // Find the focused data row + column in the current viewport. `focusedRowIndex`
  // is a data-row index — so match against `subgrid.isData && localRowIndex`,
  // not the new `rowIndex` (which is the visibleRows array slot).
  const row = vs.visibleRows.find((r) => r.subgrid.isData && r.localRowIndex === focusedRowIndex);
  const col = vs.visibleColumns.find((c) => c.colId === focusedColId);
  if (!row || !col) return;

  // Skip entirely when the focused row has scrolled outside the body
  // band. Without this guard the focus ring paints over the header
  // (top) or below the body bottom edge.
  if (row.bottom <= vs.bodyTop || row.top >= vs.bodyBottom) return;

  const hw = theme.focusRingWidth / 2;
  gc.save();
  // Clip to the scrollable body region so the ring is cropped when
  // the focused cell is partially scrolled under the header (or below
  // the body bottom). 1e6 is a "large enough" extent in CSS px — the
  // canvas is never wider than a few thousand pixels.
  gc.beginPath();
  gc.rect(0, vs.bodyTop, 1e6, vs.bodyBottom - vs.bodyTop);
  gc.clip();
  gc.cache.strokeStyle = theme.focusRingColor;
  gc.cache.lineWidth = theme.focusRingWidth;
  gc.strokeRect(
    col.left + hw,
    row.top + hw,
    col.width - theme.focusRingWidth,
    row.height - theme.focusRingWidth,
  );
  gc.restore();
}
