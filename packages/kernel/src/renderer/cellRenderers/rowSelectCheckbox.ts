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
import {
  CHECKBOX_GLYPH_SIZE,
  paintCheckboxBox,
  paintCheckboxCheck,
} from './checkboxGlyph';

const SIZE = CHECKBOX_GLYPH_SIZE;

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
    // the boolean `checkboxCell` painter so the two surfaces stay
    // visually unified.
    const accent = p.isSelected
      && p.checkboxCheckedBg
      && p.checkboxCheckedBg !== 'transparent'
      ? p.checkboxCheckedBg
      : null;
    paintCheckboxBox(gc, cx, cy, SIZE, { borderColor: p.fg, fill: accent });

    if (p.isSelected) {
      paintCheckboxCheck(
        gc,
        cx,
        cy,
        SIZE,
        accent ? (p.checkboxCheckedFg ?? p.fg) : p.fg,
      );
    }
  },
};
