import type { PainterCtx } from './types';
import type { ViewportColumn } from '../../core/viewport';
import type { ResolvedTheme } from '../../theming/cssReader';
import type { ResolvedColDef } from '../../core/propertyChain';
import type { SortModel } from '../../types';
import { drawIcon } from '../icons';

const PADDING = 8;
const SORT_ICON_SIZE = 14;
const SORT_ICON_PAD = 8;

export function paintHeader(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, sortModel } = p;
  const { headerHeight } = theme;

  // Header band spans the full container width.
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

  ctx.font = theme.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const centerCols = vs.visibleColumns.filter((c) => !c.pinned);
  const leftPinned = vs.visibleColumns.filter((c) => c.pinned === 'left');
  const rightPinned = vs.visibleColumns.filter((c) => c.pinned === 'right');

  // Center column headers, clipped to body band so scrolled columns don't
  // bleed under the pinned bands.
  ctx.save();
  ctx.beginPath();
  ctx.rect(vs.bodyLeft, 0, vs.bodyRight - vs.bodyLeft, headerHeight);
  ctx.clip();
  for (const col of centerCols) {
    paintColumnHeader(ctx, col, columnDefs, theme, sortIndex);
  }
  ctx.restore();

  // Pinned-left headers — paint after center so they overlay any leakage,
  // clipped to their own band (0..bodyLeft).
  if (leftPinned.length > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, vs.bodyLeft, headerHeight);
    ctx.clip();
    // Repaint pinned band background to mask anything that might have leaked.
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(0, 0, vs.bodyLeft, headerHeight);
    // Bottom border within pinned band.
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight - 0.5);
    ctx.lineTo(vs.bodyLeft, headerHeight - 0.5);
    ctx.stroke();
    for (const col of leftPinned) {
      paintColumnHeader(ctx, col, columnDefs, theme, sortIndex);
    }
    ctx.restore();
  }

  // Pinned-right headers — same treatment on the right band.
  if (rightPinned.length > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(vs.bodyRight, 0, rightEdge - vs.bodyRight, headerHeight);
    ctx.clip();
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(vs.bodyRight, 0, rightEdge - vs.bodyRight, headerHeight);
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vs.bodyRight, headerHeight - 0.5);
    ctx.lineTo(rightEdge, headerHeight - 0.5);
    ctx.stroke();
    for (const col of rightPinned) {
      paintColumnHeader(ctx, col, columnDefs, theme, sortIndex);
    }
    ctx.restore();
  }
}

function paintColumnHeader(
  ctx: CanvasRenderingContext2D,
  col: ViewportColumn,
  columnDefs: Map<string, ResolvedColDef>,
  theme: ResolvedTheme,
  sortIndex: Map<string, { direction: 'asc' | 'desc'; index: number }>,
): void {
  const def = columnDefs.get(col.colId);
  if (!def) return;
  const { headerHeight } = theme;
  const cy = headerHeight / 2;

  // Right-edge divider line.
  ctx.strokeStyle = theme.borderColor;
  ctx.beginPath();
  ctx.moveTo(col.right - 0.5, 0);
  ctx.lineTo(col.right - 0.5, headerHeight);
  ctx.stroke();

  ctx.fillStyle = theme.headerFg;
  ctx.fillText(def.headerName, col.left + PADDING, cy);

  const sort = sortIndex.get(col.colId);
  if (sort) {
    const iconCx = col.right - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
    drawIcon(
      ctx,
      sort.direction === 'asc' ? 'chevron-up' : 'chevron-down',
      iconCx,
      cy,
      SORT_ICON_SIZE,
      { color: theme.focusRingColor, strokeWidth: 2 },
    );
  }
}
