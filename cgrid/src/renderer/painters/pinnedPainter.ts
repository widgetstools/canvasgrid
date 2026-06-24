import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';

export function paintPinned(
  gc: CachedContext2D,
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

  gc.cache.save();
  gc.beginPath();
  gc.rect(bandLeft, bandTop, bandRight - bandLeft, bandBottom - bandTop);
  gc.clip();

  for (const row of vs.visibleRows) {
    if (!row.subgrid.isData) continue; // header / totals / footer handled elsewhere
    const dataIdx = row.localRowIndex;
    const rowBg = selection.selectedRowIndices.has(dataIdx)
      ? theme.rowSelectedBg
      : dataIdx % 2 === 1
        ? theme.rowAltBg
        : theme.bg;

    for (const col of pinnedCols) {
      const def = columnDefs.get(col.colId);
      if (!def) continue;
      const data = cellData(dataIdx, col.colId);
      cellRenderers.get(def.cellRenderer).paint(gc, {
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
          selection.focusedRowIndex === dataIdx &&
          selection.focusedColId === col.colId,
        isSelected: selection.selectedRowIndices.has(dataIdx),
        isHovered: false,
      });
    }
  }

  gc.cache.restore();
}
