import type { CachedContext2D } from '../gc';
import { drawIcon } from '../icons';
import type { CellPainter, CellPaintConfig } from './registry';

/**
 * Cycle 15 / Task 4 — polished `'group'` cell renderer. Built-in
 * renderer painted into every cell of the auto-group column
 * (`'ag-Grid-AutoColumn'`).
 *
 * Design plan: docs/superpowers/plans/notes/cycle-15-grouping-design.md
 * § Task 4.
 *
 * Responsibilities:
 *   - Read the row's group context from `CellPaintConfig.value` —
 *     populated by `cgrid.cellAt()` when the column is the auto-group
 *     column. The value is either a `GroupCellValue` object OR the
 *     empty-string sentinel `''` (data row → no group context).
 *   - On data rows (rowKind === 0): paint background only. The
 *     auto-group column's data-row cells stay blank — group rows are
 *     the only ones carrying tree chrome.
 *   - On group rows (rowKind === 1): paint indent + chevron + value +
 *     optional `(count)`.
 *
 * Renderer chrome decisions (design plan):
 *   - Indent: one chevron-width (theme.groupIndent, default 14 px) per
 *     depth level.
 *   - Chevron: 12 px Lucide icon, `chevron-right` collapsed /
 *     `chevron-down` expanded. Painted in `theme.groupChevronColor`.
 *   - Value: body fg, body weight (no +1 stop). Null / undefined value
 *     renders as em-dash (`—`) — matches Cycle 14 / Task 5 empty glyph.
 *   - Count: `(${childCount.toLocaleString()})` in
 *     `theme.groupCountColor`, body weight. Zero child count omits the
 *     suffix entirely.
 *
 * What this renderer EXPLICITLY does NOT do:
 *   - No row bg shift, no top / bottom border. The grouped grid reads
 *     as one cohesive page; row chrome is reserved for synthesis rows
 *     (totals / per-group footer rows).
 *   - No weight bump. Structural cue is the chevron + indent.
 *   - No chevron hover hint, no chevron hit-test. Task 7
 *     (`groupExpand` interaction) wires those.
 *   - No tri-state checkbox. Task 8 (`groupSelectsChildren`) extends
 *     this renderer with the checkbox path.
 */

const PADDING = 6;
const CHEVRON_SIZE = 12;
const CHEVRON_GAP = 6;
const COUNT_GAP = 4;
const EMPTY_GLYPH = '—';

/** Per-row group context threaded through `CellPaintConfig.value` for
 *  the auto-group column. Populated by `cgrid.cellAt()` from the
 *  current chunk's per-row group fields. Carries the row's `rowKind`
 *  so the renderer can short-circuit on data rows. */
export interface GroupCellValue {
  /** Tag so a downcast from `unknown` can be detected at runtime. */
  readonly kind: 'group';
  /** 0 = data row, 1 = group row, 2 = grandTotal, 3 = footer. The
   *  renderer only paints chrome for `rowKind === 1`. */
  readonly rowKind: number;
  /** 0-indexed group depth. 0 = top-level group, 1 = child of a
   *  top-level group, etc. Drives the indent unit. */
  readonly depth: number;
  /** Pre-formatted group value (the source column's `valueFormatter`
   *  output applied to the raw group key). Null / undefined renders as
   *  the em-dash placeholder. */
  readonly valueFormatted: string;
  /** Descendant leaf-row count for this group. Zero omits the suffix. */
  readonly childCount: number;
  /** `true` if the group is currently expanded; chevron paints
   *  down-pointing. `false` paints right-pointing. Data rows are
   *  always "expanded" (no chevron paints anyway). */
  readonly isExpanded: boolean;
}

/** Type-narrow `value` to a `GroupCellValue`. Defensive — the painter
 *  must not crash when fed an unexpected shape from a malformed
 *  `cellAt`. Returns `null` for any non-group-row payload (including
 *  `''`, the data-row sentinel). */
function asGroupCellValue(value: unknown): GroupCellValue | null {
  if (value === null || typeof value !== 'object') return null;
  if (!('kind' in value)) return null;
  const tagged = value as { kind: unknown };
  if (tagged.kind !== 'group') return null;
  return value as GroupCellValue;
}

function paintBackground(gc: CachedContext2D, p: CellPaintConfig): void {
  if (p.bg !== p.prefillColor) {
    gc.cache.fillStyle = p.bg;
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
  }
  if (p.flashAlpha && p.flashAlpha > 0) {
    gc.cache.save();
    gc.cache.globalAlpha = p.flashAlpha;
    gc.cache.fillStyle = p.flashFromColor ?? '#fef3c7';
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    gc.cache.restore();
  }
}

export const groupCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);

    const groupValue = asGroupCellValue(p.value);
    // Data rows (no group context) — bg only, no chrome.
    if (groupValue === null) return;
    // Defensive: render chrome ONLY for group rows. `rowKind` of 0
    // (data) reaches here when cellAt synthesised a value for a data
    // row inside a grouped grid — the auto-group cell stays blank.
    if (groupValue.rowKind !== 1) return;

    // Theme tokens are threaded onto `CellPaintConfig` by `applyCellProps`
    // (see Cycle 15 / Task 4 design notes). Defensive defaults match the
    // shipped tokens so a renderer invoked outside the standard pipeline
    // (unit tests, ad-hoc paint calls) still produces a legible cell.
    const indent = p.groupIndent ?? 14;
    const chevronColor = p.groupChevronColor ?? p.fg;
    const countColor = p.groupCountColor ?? p.fg;

    const cy = p.bounds.y + p.bounds.h / 2;
    const left = p.bounds.x + PADDING + groupValue.depth * indent;
    const chevronCx = left + CHEVRON_SIZE / 2;
    drawIcon(
      gc,
      groupValue.isExpanded ? 'chevron-down' : 'chevron-right',
      chevronCx,
      cy,
      CHEVRON_SIZE,
      { color: chevronColor, strokeWidth: 2 },
    );

    // Value text. Empty / null renders the em-dash sentinel so a
    // group with a null key still paints chrome.
    //
    // We deliberately bypass `gc.cache.*` here: `drawIcon` writes
    // `strokeStyle / lineWidth / lineCap / lineJoin / transform`
    // directly on the raw ctx and pairs them with ctx.save/restore,
    // which leaves the `gc.cache` value tracker stale relative to the
    // restored ctx. Subsequent `gc.cache.fillStyle = …` writes are then
    // suppressed by the proxy's "skip equal value" check while the live
    // ctx state may differ — so the text never paints in the intended
    // colour. Writing directly to the underlying ctx properties
    // sidesteps the stale comparison entirely.
    const valueText = groupValue.valueFormatted === '' ? EMPTY_GLYPH : groupValue.valueFormatted;
    const textX = left + CHEVRON_SIZE + CHEVRON_GAP;
    gc.fillStyle = p.fg;
    gc.font = p.font;
    gc.textBaseline = 'middle';
    gc.textAlign = 'left';
    gc.fillText(valueText, textX, cy);

    // Count suffix. Zero count omits the suffix entirely — empty
    // groups shouldn't read as "(0)".
    if (groupValue.childCount > 0) {
      const valueWidth = gc.measureText(valueText).width;
      const countText = `(${groupValue.childCount.toLocaleString()})`;
      const countX = textX + valueWidth + COUNT_GAP;
      gc.fillStyle = countColor;
      gc.fillText(countText, countX, cy);
    }
  },
};
