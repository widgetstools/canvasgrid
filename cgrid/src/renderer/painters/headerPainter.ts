import type { PainterCtx } from './types';
import type { ViewportColumn } from '../../core/viewport';
import type { ResolvedTheme } from '../../theming/cssReader';
import type { ResolvedColDef } from '../../core/propertyChain';
import type { CachedContext2D } from '../gc';
import { drawIcon } from '../icons';

const PADDING = 8;
const SORT_ICON_SIZE = 14;
const SORT_ICON_PAD = 8;

export function paintHeader(gc: CachedContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, sortModel } = p;
  const { headerHeight } = theme;

  // Header band spans the full container width.
  const rightEdge = vs.visibleColumns.length === 0
    ? vs.bodyRight
    : Math.max(...vs.visibleColumns.map((c) => c.right), vs.bodyRight);

  // Fill the entire header band.
  gc.cache.fillStyle = theme.headerBg;
  gc.fillRect(0, 0, rightEdge, headerHeight);

  // Bottom border separating header from body.
  gc.cache.strokeStyle = theme.borderColor;
  gc.cache.lineWidth = 1;
  gc.beginPath();
  gc.moveTo(0, headerHeight - 0.5);
  gc.lineTo(rightEdge, headerHeight - 0.5);
  gc.stroke();

  // Build a sort lookup: colId -> { direction, index }.
  const sortIndex = new Map<string, { direction: 'asc' | 'desc'; index: number }>();
  for (let i = 0; i < sortModel.length; i++) {
    const entry = sortModel[i]!;
    sortIndex.set(entry.colId, { direction: entry.direction, index: i });
  }

  gc.cache.font = theme.font;
  gc.cache.textBaseline = 'middle';
  gc.cache.textAlign = 'left';

  const centerCols = vs.visibleColumns.filter((c) => !c.pinned);
  const leftPinned = vs.visibleColumns.filter((c) => c.pinned === 'left');
  const rightPinned = vs.visibleColumns.filter((c) => c.pinned === 'right');

  // Center column headers, clipped to body band so scrolled columns don't
  // bleed under the pinned bands.
  gc.cache.save();
  gc.beginPath();
  gc.rect(vs.bodyLeft, 0, vs.bodyRight - vs.bodyLeft, headerHeight);
  gc.clip();
  for (const col of centerCols) {
    paintColumnHeader(gc, col, columnDefs, theme, sortIndex);
  }
  gc.cache.restore();

  // Pinned-left headers — paint after center so they overlay any leakage,
  // clipped to their own band (0..bodyLeft).
  if (leftPinned.length > 0) {
    gc.cache.save();
    gc.beginPath();
    gc.rect(0, 0, vs.bodyLeft, headerHeight);
    gc.clip();
    // Repaint pinned band background to mask anything that might have leaked.
    gc.cache.fillStyle = theme.headerBg;
    gc.fillRect(0, 0, vs.bodyLeft, headerHeight);
    // Bottom border within pinned band.
    gc.cache.strokeStyle = theme.borderColor;
    gc.cache.lineWidth = 1;
    gc.beginPath();
    gc.moveTo(0, headerHeight - 0.5);
    gc.lineTo(vs.bodyLeft, headerHeight - 0.5);
    gc.stroke();
    for (const col of leftPinned) {
      paintColumnHeader(gc, col, columnDefs, theme, sortIndex);
    }
    gc.cache.restore();
  }

  // Pinned-right headers — same treatment on the right band.
  if (rightPinned.length > 0) {
    gc.cache.save();
    gc.beginPath();
    gc.rect(vs.bodyRight, 0, rightEdge - vs.bodyRight, headerHeight);
    gc.clip();
    gc.cache.fillStyle = theme.headerBg;
    gc.fillRect(vs.bodyRight, 0, rightEdge - vs.bodyRight, headerHeight);
    gc.cache.strokeStyle = theme.borderColor;
    gc.cache.lineWidth = 1;
    gc.beginPath();
    gc.moveTo(vs.bodyRight, headerHeight - 0.5);
    gc.lineTo(rightEdge, headerHeight - 0.5);
    gc.stroke();
    for (const col of rightPinned) {
      paintColumnHeader(gc, col, columnDefs, theme, sortIndex);
    }
    gc.cache.restore();
  }
}

function paintColumnHeader(
  gc: CachedContext2D,
  col: ViewportColumn,
  columnDefs: Map<string, ResolvedColDef>,
  theme: ResolvedTheme,
  sortIndex: Map<string, { direction: 'asc' | 'desc'; index: number }>,
): void {
  const def = columnDefs.get(col.colId);
  if (!def) return;
  const { headerHeight } = theme;
  const cy = headerHeight / 2;

  gc.cache.fillStyle = theme.headerFg;
  gc.fillText(def.headerName, col.left + PADDING, cy);

  const sort = sortIndex.get(col.colId);
  if (sort) {
    const iconCx = col.right - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
    drawIcon(
      gc,
      sort.direction === 'asc' ? 'chevron-up' : 'chevron-down',
      iconCx,
      cy,
      SORT_ICON_SIZE,
      { color: theme.focusRingColor, strokeWidth: 2 },
    );
  }
}
