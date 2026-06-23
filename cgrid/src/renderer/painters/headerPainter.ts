import type { PainterCtx } from './types';
import { drawIcon } from '../icons';

const PADDING = 8;
const SORT_ICON_SIZE = 14;
const SORT_ICON_PAD = 8;

export function paintHeader(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, sortModel } = p;
  const { headerHeight } = theme;

  // Header band spans the full container width (bodyLeft..bodyRight + pinned regions).
  // Use the rightmost edge of any visible column as the right boundary.
  const rightEdge = vs.visibleColumns.length === 0
    ? vs.bodyRight
    : Math.max(...vs.visibleColumns.map((c) => c.right), vs.bodyRight);

  // Fill the entire header band.
  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, rightEdge, headerHeight);

  // Bottom border separating header from body.
  ctx.strokeStyle = theme.borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerHeight - 0.5);
  ctx.lineTo(rightEdge, headerHeight - 0.5);
  ctx.stroke();

  // Build a sort lookup: colId -> { direction, index }.
  const sortIndex = new Map<string, { direction: 'asc' | 'desc'; index: number }>();
  for (let i = 0; i < sortModel.length; i++) {
    const entry = sortModel[i]!;
    sortIndex.set(entry.colId, { direction: entry.direction, index: i });
  }

  // Per-column divider lines and labels.
  ctx.fillStyle = theme.headerFg;
  ctx.font = theme.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const cy = headerHeight / 2;

  for (const col of vs.visibleColumns) {
    const def = columnDefs.get(col.colId);
    if (!def) continue;
    const label = def.headerName;

    // Right-edge divider line.
    ctx.strokeStyle = theme.borderColor;
    ctx.beginPath();
    ctx.moveTo(col.right - 0.5, 0);
    ctx.lineTo(col.right - 0.5, headerHeight);
    ctx.stroke();

    ctx.fillStyle = theme.headerFg;
    ctx.fillText(label, col.left + PADDING, cy);

    // Sort indicator
    const sort = sortIndex.get(col.colId);
    if (sort) {
      const iconCx = col.right - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
      const iconCy = cy;
      drawIcon(
        ctx,
        sort.direction === 'asc' ? 'chevron-up' : 'chevron-down',
        iconCx,
        iconCy,
        SORT_ICON_SIZE,
        { color: theme.focusRingColor, strokeWidth: 2 },
      );
    }
  }
}
