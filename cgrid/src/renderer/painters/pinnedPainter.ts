import type { PainterCtx } from './types';

export function paintPinned(
  ctx: CanvasRenderingContext2D,
  p: PainterCtx,
  side: 'left' | 'right',
): void {
  const { viewport: vs, theme, columnDefs, cellRenderers, cellData, selection } = p;

  // Collect columns for this pinned side.
  const pinnedCols = vs.visibleColumns.filter((c) => c.pinned === side);
  if (pinnedCols.length === 0) return;

  // Compute clip rect for the pinned band.
  const bandLeft = Math.min(...pinnedCols.map((c) => c.left));
  const bandRight = Math.max(...pinnedCols.map((c) => c.right));
  const bandTop = vs.bodyTop;
  const bandBottom = vs.bodyBottom;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bandLeft, bandTop, bandRight - bandLeft, bandBottom - bandTop);
  ctx.clip();

  for (const row of vs.visibleRows) {
    const rowBg = selection.selectedRowIndices.has(row.rowIndex)
      ? theme.rowSelectedBg
      : row.rowIndex % 2 === 1
        ? theme.rowAltBg
        : theme.bg;

    for (const col of pinnedCols) {
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
