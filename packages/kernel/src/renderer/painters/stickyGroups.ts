/**
 * Cycle 15 / Task 16 — `paintStickyGroups`.
 *
 * Pins the ancestor group band to the top of the body area when the
 * user has scrolled past one or more group rows. Each band row mirrors
 * the layout of a regular group row (indent + chevron + value + child-
 * count badge) and is interactive via `hitTestStickyChevron` in cgrid.ts.
 *
 * Layout:
 *   bodyTop + 0 × rowH  → ancestor at depth 0 (top-level group)
 *   bodyTop + 1 × rowH  → ancestor at depth 1 (child group)
 *   ...
 *
 * Push-off: when a sibling group row (same depth, different key) scrolls
 * up into the band, the sticky row slides upward:
 *   pushOff = clamp(sibling.top − bandBottom, −rowH, 0)
 *
 * Z-order: painted AFTER `paintGridLines` (band bg occludes body
 * gridlines) and BEFORE `paintOverlay` (focus rings + range selections
 * clip on top of the band).
 */

import type { PainterCtx } from './types';
import type { CachedContext2D } from '../gc';
import { drawIcon } from '../icons';

// Shared constants — must agree with `renderer/cellRenderers/group.ts`.
const PADDING = 6;
const CHEVRON_SIZE = 12;
const CHEVRON_GAP = 6;
const INDENT_UNIT = 14;
const COUNT_GAP = 4;
const EMPTY_GLYPH = '—';
const SHADOW_HEIGHT = 6;

export function paintStickyGroups(gc: CachedContext2D, p: PainterCtx): void {
  // Cycle 15.5 / Task 4 — groupHideOpenParents force-disables sticky
  // (a hidden parent can't be pinned at the top; no group rows to stick).
  if (p.groupHideOpenParents) return;
  const ancestors = p.stickyAncestors;
  if (!ancestors || ancestors.length === 0) return;

  const { bodyTop, bodyLeft, bodyRight } = p.viewport;
  const theme = p.theme;
  const rowH = theme.rowHeight;
  // Cycle 21i — the group label lives in the auto-group column, which is
  // pinned-left (index 0) by default. Anchor the band + label to THAT
  // column's left, not `bodyLeft` (the start of the scrolling body): with
  // a second pinned-left column present, `bodyLeft` sits past the group
  // column and the label would render out in the value columns.
  const autoGroupCol = p.viewport.visibleColumns.find((c) =>
    c.colId.startsWith('ag-Grid-AutoColumn'));
  const bandLeft = autoGroupCol ? Math.min(autoGroupCol.left, bodyLeft) : bodyLeft;
  const bandW = bodyRight - bandLeft;
  const totalH = ancestors.length * rowH + SHADOW_HEIGHT;

  // Clip to the band + shadow zone.
  gc.cache.save();
  gc.beginPath();
  gc.rect(bandLeft, bodyTop, bandW, totalH);
  gc.clip();

  // Track the bottom edge of the last painted row for the shadow.
  let lastRowBottom = bodyTop;

  for (let bandIdx = 0; bandIdx < ancestors.length; bandIdx++) {
    const ancestor = ancestors[bandIdx]!;
    const bandTop = bodyTop + bandIdx * rowH;
    const bandBottom = bandTop + rowH;

    // Push-off: find the first sibling group at the same depth in the
    // visible rows. When it has entered the band region, translate the
    // sticky row upward proportionally.
    let pushOff = 0;
    if (p.rowKindAt && p.groupDepthAt && p.groupKeyAt) {
      for (const vr of p.viewport.visibleRows) {
        if (!vr.subgrid.isData) continue;
        if (p.rowKindAt(vr.localRowIndex) !== 1) continue;
        const depth = p.groupDepthAt(vr.localRowIndex);
        if (depth !== ancestor.depth) continue;
        const key = p.groupKeyAt(vr.localRowIndex);
        if (key === ancestor.key || key === '') continue;
        if (vr.top < bandBottom) {
          pushOff = Math.max(-rowH, vr.top - bandBottom);
        }
        break;
      }
    }

    const paintY = bandTop + pushOff;
    lastRowBottom = paintY + rowH;

    // Background.
    gc.cache.fillStyle = theme.groupRowBg ?? theme.bg;
    gc.fillRect(bandLeft, paintY, bandW, rowH);

    // Bottom separator (hairline gridline).
    gc.cache.fillStyle = theme.gridLineColor;
    gc.fillRect(bandLeft, paintY + rowH - 1, bandW, 1);

    // Chevron icon.
    const cy = paintY + rowH / 2;
    const indentX = ancestor.depth * INDENT_UNIT;
    const left = bandLeft + PADDING + indentX;
    const chevronCx = left + CHEVRON_SIZE / 2;
    drawIcon(
      gc,
      ancestor.isExpanded ? 'chevron-down' : 'chevron-right',
      chevronCx,
      cy,
      CHEVRON_SIZE,
      { color: theme.groupChevronColor, strokeWidth: 2 },
    );

    // Value text (bypasses gc.cache — drawIcon's save/restore can leave
    // the proxy stale, so write directly as in group.ts).
    const textX = left + CHEVRON_SIZE + CHEVRON_GAP;
    const valueText = ancestor.value === '' ? EMPTY_GLYPH : ancestor.value;
    gc.fillStyle = theme.fg;
    gc.font = theme.font;
    gc.textBaseline = 'middle';
    gc.textAlign = 'left';
    gc.fillText(valueText, textX, cy);

    if (ancestor.childCount > 0) {
      const countText = `(${ancestor.childCount.toLocaleString()})`;
      const countX = textX + gc.measureText(valueText).width + COUNT_GAP;
      gc.fillStyle = theme.groupCountColor ?? theme.fg;
      gc.fillText(countText, countX, cy);
    }

    // Cycle 15.5 — paint per-column aggregate values for non-auto-group columns.
    if (p.getStickyGroupTotals) {
      for (const col of p.viewport.visibleColumns) {
        if (col.colId.startsWith('ag-Grid-AutoColumn')) continue;
        const entry = p.getStickyGroupTotals(ancestor.key, col.colId);
        if (!entry || entry.valueFormatted === '') continue;
        // Clip each value to its own column before painting. A group sum can
        // be far wider than its column (e.g. a trillion-scale Notional total
        // in a narrow column); right-aligned, the excess extends LEFT and,
        // without this clip, bleeds over the previous column's value. The
        // body painter clips every cell the same way (byRows.ts) — mirror it
        // so sticky aggregates never overflow into a neighbour. The band
        // clip already established above bounds the vertical extent.
        gc.cache.save();
        gc.beginPath();
        gc.rect(col.left, paintY, col.width, rowH);
        gc.clip();
        const colRight = col.right - PADDING;
        gc.fillStyle = theme.fg;
        // Aggregate value text reads as data — use the cell font so
        // numbers stay column-aligned with the body cells below.
        gc.font = theme.cellFont ?? theme.font;
        gc.textBaseline = 'middle';
        gc.textAlign = 'right';
        gc.fillText(entry.valueFormatted, colRight, cy);
        gc.cache.restore();
      }
      gc.textAlign = 'left';
    }
  }

  // Drop shadow below the band.
  const gradient = gc.createLinearGradient(
    0, lastRowBottom, 0, lastRowBottom + SHADOW_HEIGHT,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0.10)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  gc.cache.fillStyle = gradient;
  gc.fillRect(bandLeft, lastRowBottom, bandW, SHADOW_HEIGHT);

  gc.cache.restore();
}
