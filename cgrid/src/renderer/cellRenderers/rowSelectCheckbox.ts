/**
 * Row-select checkbox cell renderer.
 *
 * Paints a centered 14×14 checkbox whose state mirrors the row's
 * membership in the selection set — `p.isSelected` is the source of
 * truth (set by `applyCellProps` from
 * `selection.selectedRowIndices.has(rowIndex)`). The renderer never
 * reads `p.value` and the row-data field is meaningless for this
 * column.
 *
 * Wired by setting `CColDef.checkboxSelection: true`. `propertyChain`
 * resolves such columns to this renderer regardless of `cellDataType`.
 */
import type { CellPainter } from './registry';

const SIZE = 14;

export const rowSelectCheckboxCell: CellPainter = {
  paint(gc, p) {
    if (p.bg !== p.prefillColor) {
      gc.cache.fillStyle = p.bg;
      gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    }
    const cx = p.bounds.x + p.bounds.w / 2 - SIZE / 2;
    const cy = p.bounds.y + p.bounds.h / 2 - SIZE / 2;

    // Optional accent fill when the row is selected AND the theme
    // declared a non-transparent `--cg-checkbox-checked-bg`. Mirrors
    // the existing `checkboxCell` painter so the two surfaces stay
    // visually unified.
    const accent = p.isSelected
      && p.checkboxCheckedBg
      && p.checkboxCheckedBg !== 'transparent'
      ? p.checkboxCheckedBg
      : null;
    if (accent) {
      gc.cache.fillStyle = accent;
      gc.fillRect(cx, cy, SIZE, SIZE);
    }

    gc.cache.strokeStyle = p.fg;
    gc.cache.lineWidth = 1;
    gc.strokeRect(cx + 0.5, cy + 0.5, SIZE, SIZE);

    if (p.isSelected) {
      gc.cache.strokeStyle = accent ? (p.checkboxCheckedFg ?? p.fg) : p.fg;
      gc.beginPath();
      gc.moveTo(cx + 3, cy + SIZE / 2);
      gc.lineTo(cx + SIZE / 2 - 1, cy + SIZE - 3);
      gc.lineTo(cx + SIZE - 2, cy + 3);
      gc.stroke();
    }
  },
};
