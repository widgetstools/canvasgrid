/**
 * Cycle 15 / Task 12 — per-group footer cell renderer.
 *
 * Two surfaces share this painter:
 *   1. The auto-group column on a footer row (`rowKind === 3` AND
 *      `isAutoGroupColumnId(colId)`) — paints `Total ${groupValue}`
 *      at the parent group's depth indent so the synthesis stripe is
 *      anchored to its source bucket. Grand-total footer (groupKey
 *      empty) paints just `Total`.
 *   2. Any non-auto-group column on a footer row — delegates to the
 *      polished `'totals'` painter so the per-group total value reads
 *      with the same em-dash placeholder + right-alignment vocabulary
 *      the grand-total row uses.
 *
 * Both branches inherit the totals "lift" treatment (bg + top border +
 * weight bump) via `applyCellProps` flipping `isGroupFooter: true` —
 * the painter itself doesn't paint chrome; it just lays down text.
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md § Task 12.
 */

import type { CachedContext2D } from '../gc';
import type { CellPainter, CellPaintConfig } from './registry';
import { totalsCell } from './totals';

const PADDING = 6;
/** Mirrors the `'group'` cell renderer's indent unit (`--cg-group-indent`).
 *  Falls back to the design-plan canonical 14 when `groupIndent` isn't
 *  threaded onto the config (defensive — should always be present). */
const DEFAULT_INDENT_UNIT = 14;

/** Shape the painter expects on `p.value` for footer-row auto-group
 *  cells. Mirrors `GroupCellValue` from `'group'`. Kept structural here
 *  to avoid a circular dependency with `group.ts`. */
interface GroupFooterPayload {
  /** Discriminator the `'group'` renderer also uses. */
  kind: 'group';
  /** 3 for footer rows. The renderer keys off this. */
  rowKind: number;
  /** PARENT group's depth (Task 12 — the slicer sets
   *  `groupDepth[i] = entry.depth - 1` for footers so the label sits
   *  at the parent's indent column). */
  depth: number;
  /** Parent group's formatted value (empty for the grand-total
   *  footer — the renderer detects empty and paints just `Total`). */
  valueFormatted: string;
}

function asFooterPayload(value: unknown): GroupFooterPayload | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Partial<GroupFooterPayload>;
  if (v.kind !== 'group') return null;
  if (typeof v.rowKind !== 'number') return null;
  if (typeof v.depth !== 'number') return null;
  if (typeof v.valueFormatted !== 'string') return null;
  return v as GroupFooterPayload;
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

export const groupFooterCell: CellPainter = {
  paint(gc, p) {
    const payload = asFooterPayload(p.value);
    // Non-auto-group cell: delegate to the totals painter for the
    // em-dash + right-alignment + lift vocabulary. The footer's
    // per-group total value already lives on `p.valueFormatted` (cgrid
    // resolved it via `totalsCellLookup`); `totalsCell` handles the
    // rest.
    if (payload === null) {
      totalsCell.paint(gc, p);
      return;
    }
    // Auto-group column on a footer row. Paint `Total ${groupValue}`
    // at the parent depth's indent. Grand-total footer (empty group
    // value) reads as just `Total`.
    paintBackground(gc, p);
    const indentUnit = p.groupIndent ?? DEFAULT_INDENT_UNIT;
    const indentX = payload.depth * indentUnit;
    const label = payload.valueFormatted === ''
      ? 'Total'
      : `Total ${payload.valueFormatted}`;
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    gc.cache.textAlign = 'left';
    const cy = p.bounds.y + p.bounds.h / 2;
    gc.fillText(label, p.bounds.x + PADDING + indentX, cy);
  },
};
