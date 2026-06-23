import type { PainterCtx } from './types';

export function paintBody(ctx: CanvasRenderingContext2D, p: PainterCtx): void {
  const { viewport: vs, theme, columnDefs, cellRenderers, cellData, selection } = p;

  // Clip to the body region so overscan rows don't paint into the header zone
  // and horizontally-scrolled body cells don't leak into the pinned bands.
  ctx.save();
  ctx.beginPath();
  ctx.rect(vs.bodyLeft, vs.bodyTop, vs.bodyRight - vs.bodyLeft, vs.bodyBottom - vs.bodyTop);
  ctx.clip();

  for (const row of vs.visibleRows) {
    const rowBg = selection.selectedRowIndices.has(row.rowIndex)
      ? theme.rowSelectedBg
      : row.rowIndex % 2 === 1
        ? theme.rowAltBg
        : theme.bg;

    for (const col of vs.visibleColumns) {
      if (col.pinned) continue; // pinnedPainter handles pinned columns
      const def = columnDefs.get(col.colId);
      if (!def) continue;
      const data = cellData(row.rowIndex, col.colId);
      cellRenderers.get(def.cellRenderer).paint(ctx, {
        value: data?.value ?? '',
        valueFormatted: data?.valueFormatted ?? '',
        bounds: { x: col.left, y: row.top, w: col.width, h: row.height },
        style: {
          font: theme.font,
          fg: theme.fg,
          bg: rowBg,
          borderColor: theme.gridLineColor,
          halign: def.type === 'number' ? 'right' : 'left',
        },
        flashAlpha: data?.flashAlpha,
        isFocused:
          selection.focusedRowIndex === row.rowIndex &&
          selection.focusedColId === col.colId,
        isSelected: selection.selectedRowIndices.has(row.rowIndex),
        isHovered: false,
      });
    }
  }

  ctx.restore();
}
