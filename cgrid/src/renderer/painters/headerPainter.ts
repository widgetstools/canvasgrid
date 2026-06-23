import type { PainterCtx } from './types';

const PADDING = 8;

export function paintHeader(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs } = p;
  const { headerHeight } = theme;

  // Fill the entire header band.
  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, vs.bodyRight, headerHeight);

  // Draw one label per visible column.
  ctx.fillStyle = theme.headerFg;
  ctx.font = theme.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const cy = headerHeight / 2;

  for (const col of vs.visibleColumns) {
    const def = columnDefs.get(col.colId);
    if (!def) continue;
    const label = def.headerName;
    const x = col.left + PADDING;
    ctx.fillText(label, x, cy);
  }
}
