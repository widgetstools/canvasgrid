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
  // Clip to the focused column's band so the ring is cropped when:
  // - the focused row scrolls under the header / below the body
  //   (vertical bound: bodyTop..bodyBottom)
  // - a center cell scrolls into the pinned-left or pinned-right
  //   region (horizontal bound: the column's band based on its
  //   `pinned` flag).
  // Without the horizontal clip, a center cell that has scrolled to
  // col.left < bodyLeft would paint its focus ring inside the
  // pinned-left zone, on top of unrelated pinned cells.
  const xL = col.pinned === 'left' ? 0
    : col.pinned === 'right' ? vs.bodyRight
    : vs.bodyLeft;
  const xR = col.pinned === 'left' ? vs.bodyLeft
    : col.pinned === 'right' ? 1e6
    : vs.bodyRight;
  gc.beginPath();
  gc.rect(xL, vs.bodyTop, xR - xL, vs.bodyBottom - vs.bodyTop);
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
