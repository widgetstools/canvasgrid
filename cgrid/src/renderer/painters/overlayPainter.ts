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

  const hw = theme.focusRingWidth / 2;
  gc.cache.save();
  gc.cache.strokeStyle = theme.focusRingColor;
  gc.cache.lineWidth = theme.focusRingWidth;
  gc.strokeRect(
    col.left + hw,
    row.top + hw,
    col.width - theme.focusRingWidth,
    row.height - theme.focusRingWidth,
  );
  gc.cache.restore();
}
