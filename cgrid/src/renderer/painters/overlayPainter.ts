import type { PainterCtx } from './types';

export function paintOverlay(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, selection } = p;
  const { focusedRowIndex, focusedColId } = selection;

  if (focusedRowIndex === null || focusedColId === null) return;

  // Find the focused row and column in the current viewport.
  const row = vs.visibleRows.find((r) => r.rowIndex === focusedRowIndex);
  const col = vs.visibleColumns.find((c) => c.colId === focusedColId);
  if (!row || !col) return;

  const hw = theme.focusRingWidth / 2;
  ctx.save();
  ctx.strokeStyle = theme.focusRingColor;
  ctx.lineWidth = theme.focusRingWidth;
  ctx.strokeRect(
    col.left + hw,
    row.top + hw,
    col.width - theme.focusRingWidth,
    row.height - theme.focusRingWidth,
  );
  ctx.restore();
}
