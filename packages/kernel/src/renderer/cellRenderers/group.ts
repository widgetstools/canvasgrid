import type { CachedContext2D } from '../gc';
import { drawIcon } from '../icons';
import type { CellPainter, CellPaintConfig } from './registry';
import {
  CHECKBOX_GLYPH_SIZE,
  paintCheckboxBox,
  paintCheckboxCheck,
  paintCheckboxDash,
} from './checkboxGlyph';

/**
 * Cycle 15 / Task 4 + Task 5 — polished `'group'` cell renderer.
 *
 * Task 4 shipped the singleColumn variant: one auto-group column at
 * index 0; each cell on a group row paints chevron + indent + value +
 * (count). Task 5 extends the same renderer with two switches:
 *
 *   1. **`groupColumnDepth` filter (multipleColumns mode).** When the
 *      cell's `params.groupColumnDepth` is a non-negative number, the
 *      renderer paints chrome ONLY when the row's group depth matches
 *      that column's slot AND `rowKind === 1`. Cells at other depths
 *      (data rows, group rows owned by a different column) paint only
 *      the background. Indent inside the column is 0 — the column
 *      ORDER carries the hierarchy, so the chevron sits flush at
 *      PADDING.
 *
 *   2. **Full-row strip (groupRows / custom modes).** When the cell
 *      paint config carries `isGroupRowStrip === true`, the renderer
 *      paints across the strip's full bounds (allocated by the body
 *      painter to span every band). Indent is `depth × groupIndent`
 *      from the strip's left edge — same unit as Task 4 — so a nested
 *      group strip visibly indents.
 *
 * Design plan:
 *   `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
 *   § Task 4 (singleColumn) + § Task 5 (multipleColumns / groupRows / custom).
 *
 * Responsibilities:
 *   - Read the row's group context from `CellPaintConfig.value` —
 *     populated by `cgrid.cellAt()` when the column is an auto-group
 *     column OR by the body painter when allocating a full-row strip.
 *     The value is either a `GroupCellValue` object OR the empty-string
 *     sentinel `''` (data row → no group context).
 *   - On data rows (rowKind === 0): paint background only.
 *   - On group rows (rowKind === 1): paint indent + chevron + value +
 *     optional `(count)`. In multipleColumns mode, only on the column
 *     that owns the row's depth.
 *
 * Renderer chrome decisions (design plan):
 *   - Indent: `depth × groupIndent` in singleColumn / groupRows; 0 in
 *     multipleColumns (each column owns one depth).
 *   - Chevron: 12 px Lucide icon, `chevron-right` collapsed /
 *     `chevron-down` expanded. Painted in `groupChevronColor`.
 *   - Value: body fg, body weight. Null / undefined value renders as
 *     em-dash (`—`) — matches Cycle 14 / Task 5.
 *   - Count: `(${childCount.toLocaleString()})` in `groupCountColor`,
 *     body weight. Zero child count omits the suffix entirely.
 *
 * What this renderer EXPLICITLY does NOT do:
 *   - No row bg shift, top border, or weight bump in singleColumn /
 *     multipleColumns. The grouped grid reads as one cohesive page;
 *     row chrome is reserved for synthesis rows (totals / per-group
 *     footers).
 *   - No chevron hover hint, no chevron hit-test. Task 7
 *     (`groupExpand` interaction) wires those.
 *   - No tri-state checkbox. Task 8 (`groupSelectsChildren`) extends
 *     this renderer with the checkbox path.
 *   - `isGroupRowStrip === true` cells do NOT paint their own bg shift —
 *     the body painter (`byRows.ts`) handles the strip's bg before
 *     calling this renderer, so cgrid stays the single source of
 *     truth for the strip's row-level chrome.
 */

const PADDING = 6;
const CHEVRON_SIZE = 12;
const CHEVRON_GAP = 6;
const COUNT_GAP = 4;
const EMPTY_GLYPH = '';
/** Cycle 15 / Task 8 — tri-state checkbox geometry. Identical to the
 *  existing `checkboxCell` painter's box size so a `confirmed`-column
 *  checkbox and a group-row checkbox read as the same control. The
 *  GAP below sits between the chevron's right edge and the checkbox's
 *  left edge AND between the checkbox's right edge and the value text. */
const CHECKBOX_SIZE = CHECKBOX_GLYPH_SIZE;
const CHECKBOX_GAP = 6;

/** Exported chrome geometry — sole source of truth for the auto-group
 *  column autosize path (`cgrid.autoSizeColumns` builds an
 *  `AutosizeGroupContext` from these). Any width term the paint formula
 *  adds MUST be reflected in the autosize's `chromeBase` / `countGap`
 *  computation, or the auto-sized column truncates the paint. Keep the
 *  named constants private above so nothing else in the paint drifts,
 *  but publish the aggregate the autosize needs. */
export const GROUP_CELL_GEOMETRY = {
  /** Static per-cell chrome floor: two horizontal paddings + the
   *  chevron glyph + its gap. Autosize adds the optional checkbox slot
   *  on top when the group cell paints a tri-state checkbox. */
  chromeBaseNoCheckbox: 2 * PADDING + CHEVRON_SIZE + CHEVRON_GAP,
  /** Extra width the tri-state checkbox slot contributes. Added when
   *  the auto-group column shows checkboxes (`checkboxLocation ===
   *  'autoGroupColumn'` AND a group-selects mode is active). */
  checkboxSlot: CHECKBOX_SIZE + CHECKBOX_GAP,
  /** Gap between value text and `(count)` suffix. */
  countGap: COUNT_GAP,
} as const;

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
   *  top-level group, etc. Drives the indent unit (and the
   *  multipleColumns own-depth filter). */
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
  /** Cycle 18 / Task 9 follow-up — when `true` the chevron is NOT
   *  painted at all. Set by the cgrid layer when expanding would
   *  reveal nothing visible — e.g. the group sits at the deepest
   *  row-group level AND pivot mode is active (leaf data rows are
   *  suppressed under pivot, so the user has nothing to drill into).
   *  Indent + value + count badge still paint per the standard
   *  layout; only the caret is omitted. */
  readonly suppressChevron?: boolean;
  /** Cycle 15 / Task 8 — when present, the renderer paints a tri-state
   *  checkbox between the chevron and the value text. Three states
   *  differentiated by interior shape only (empty / horizontal dash /
   *  check √) — no color shift, no fill, no row-level chrome.
   *  Omit (or `undefined`) to suppress the checkbox entirely; this is
   *  the default when `groupSelectsChildren` is off. */
  readonly selectionState?: 'none' | 'partial' | 'all';
  /** Cycle 15.5 / Task 7 — when `true`, the `(N)` child-count suffix is
   *  suppressed regardless of `childCount`. Threaded from
   *  `VelocityGridOptions.suppressCount` by `velocityGrid.ts`'s `groupCellContextAt`. */
  readonly suppressCount?: boolean;
  /** Cycle 15.5 / Task 7 — custom inner renderer name. When set, the
   *  renderer looks up the named cell renderer for the value portion
   *  only (chevron + indent stay native). The inner renderer receives
   *  `{ value: valueFormatted, depth, childCount, key }` as its `params`
   *  and the call's return string replaces the value text. Omit to use
   *  the default text path. */
  readonly innerRenderer?: string;
  /** Master / detail — `true` when this column carries the master row's
   *  expand toggle (`masterDetail: true` and this is a `'group'`-rendered
   *  column). Set on EVERY data row, master or not, so the chevron slot is
   *  reserved and values stay aligned down the column — the same thing
   *  ag-grid's `agGroupCellRenderer` does with its hidden expand icon. */
  readonly masterDetail?: boolean;
  /** Master / detail — `true` when THIS row can be expanded (`isRowMaster`
   *  did not veto it). Only then does a chevron paint. */
  readonly isMaster?: boolean;
  /** Master / detail — `true` when this master row's detail is open;
   *  chooses `chevron-down` over `chevron-right`. */
  readonly masterExpanded?: boolean;
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

/** Read the multipleColumns own-depth slot from
 *  `CellPaintConfig.params`. Returns the slot index when set, or
 *  `null` for singleColumn / groupRows / cells that don't carry the
 *  param. Defensive: a malformed `params` (non-object, missing field)
 *  produces `null` — the renderer falls through to the singleColumn
 *  "paint any depth" behaviour. */
function readGroupColumnDepth(params: unknown): number | null {
  if (params === null || typeof params !== 'object') return null;
  if (!('groupColumnDepth' in params)) return null;
  const v = (params as { groupColumnDepth: unknown }).groupColumnDepth;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
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

    // Cycle 15 / Task 5 — multipleColumns own-depth filter. A non-null
    // `groupColumnDepth` from `cellRendererParams` means this cell is
    // one of the per-level auto-group columns; paint chrome ONLY when
    // the row's group depth matches this column's slot. Other group
    // rows (a deeper / shallower depth than this column owns) stay
    // blank — the column that owns THAT depth carries their chrome.
    // The check sits BEFORE the rowKind branch so a data row in
    // multipleColumns mode never paints the opened-group echo
    // (each column owns one depth; echoing the leaf-parent's label
    // across every column would compete with the column ownership
    // rule — Task 10 design § showOpenedGroup).
    const ownDepth = readGroupColumnDepth(p.params);
    if (ownDepth !== null && ownDepth !== groupValue.depth) return;

    // Cycle 15 / Task 10 — `showOpenedGroup`. Data rows (rowKind === 0)
    // normally paint nothing; when the worker has populated
    // `valueFormatted` for a data row (only happens when
    // `showOpenedGroup: true` AND the row has a leaf-parent group
    // entry preceding it in flatOrder), paint a MUTED echo of that
    // value at the leaf group's indent. No chevron, no checkbox, no
    // count — the data row is not a toggle target and the count is
    // group metadata, not data-row metadata. Only paints in
    // singleColumn mode; the ownDepth check above already returned for
    // multipleColumns + data rows.
    if (groupValue.rowKind !== 1) {
      if (ownDepth !== null) return;
      // Master / detail — a DATA row in a master-detail grid paints its own
      // value behind a chevron slot. This runs before the opened-group echo
      // because a master-detail grid without row grouping has no group label
      // to echo, and one WITH grouping wants the master toggle, not the echo.
      if (groupValue.masterDetail) {
        paintMasterCell(gc, p, groupValue);
        return;
      }
      if (groupValue.valueFormatted === '') return;
      paintOpenedGroupLabel(gc, p, groupValue);
      return;
    }

    // Theme tokens are threaded onto `CellPaintConfig` by `applyCellProps`
    // (see Cycle 15 / Task 4 design notes). Defensive defaults match the
    // shipped tokens so a renderer invoked outside the standard pipeline
    // (unit tests, ad-hoc paint calls) still produces a legible cell.
    const indentUnit = p.groupIndent ?? 14;
    const chevronColor = p.groupChevronColor ?? p.fg;
    const countColor = p.groupCountColor ?? p.fg;

    // Cycle 15 / Task 5 — indent rule per mode:
    //   - multipleColumns (ownDepth !== null): indent = 0. The column
    //     ORDER carries the hierarchy; padding the chevron right
    //     inside the column would degrade to uniform per-column noise.
    //   - singleColumn (ownDepth === null, not full-row): indent =
    //     depth × groupIndent. Chevrons stack within the single
    //     column.
    //   - groupRows / custom (full-row, ownDepth === null): same as
    //     singleColumn — the chevron indents from the strip's left
    //     edge so nested groups read as nested.
    const indentX = ownDepth !== null ? 0 : groupValue.depth * indentUnit;

    const cy = p.bounds.y + p.bounds.h / 2;
    const left = p.bounds.x + PADDING + indentX;
    const chevronCx = left + CHEVRON_SIZE / 2;
    // Cycle 18 / Task 9 follow-up — under pivot mode the deepest
    // row-group level has no expandable children (leaf data rows are
    // hidden). cgrid stamps `suppressChevron: true` on those rows so
    // the caret doesn't paint a misleading "click to expand" hint.
    if (!groupValue.suppressChevron) {
      drawIcon(
        gc,
        groupValue.isExpanded ? 'chevron-down' : 'chevron-right',
        chevronCx,
        cy,
        CHEVRON_SIZE,
        { color: chevronColor, strokeWidth: 2 },
      );
    }

    // Cycle 15 / Task 8 — tri-state checkbox slot. Paints when
    // `groupSelectsChildren` is on (cgrid.cellAt threads
    // `selectionState`); omitted entirely otherwise. The chevron
    // geometry above is load-bearing — velocityGrid.ts mirrors it for the
    // chevron click hit-test (`computeChevronHit`). Drift the chevron
    // x and the hit-test breaks; the checkbox slot sits AFTER the
    // chevron so adding it doesn't disturb chevron geometry.
    //
    // Layout (with checkbox):
    //   [indent: depth × indentUnit] [chevron 12] [GAP 6]
    //   [checkbox 14] [GAP 6] [value] [GAP 4] [(count)]
    //
    // Layout (without checkbox — checkbox slot is zero width):
    //   [indent: depth × indentUnit] [chevron 12] [GAP 6]
    //   [value] [GAP 4] [(count)]
    let textX = left + CHEVRON_SIZE + CHEVRON_GAP;
    if (groupValue.selectionState !== undefined) {
      const checkboxX = textX;
      const checkboxY = cy - CHECKBOX_SIZE / 2;
      paintTriStateCheckbox(gc, checkboxX, checkboxY, p, groupValue.selectionState);
      textX = checkboxX + CHECKBOX_SIZE + CHECKBOX_GAP;
    }

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
    gc.fillStyle = p.fg;
    gc.font = p.font;
    gc.textBaseline = 'middle';
    gc.textAlign = 'left';
    gc.fillText(valueText, textX, cy);

    // Count suffix. Zero count omits the suffix. `suppressCount: true`
    // (Cycle 15.5 / Task 7) suppresses it regardless of childCount.
    if (groupValue.childCount > 0 && !groupValue.suppressCount) {
      const valueWidth = gc.measureText(valueText).width;
      const countText = `(${groupValue.childCount.toLocaleString()})`;
      const countX = textX + valueWidth + COUNT_GAP;
      gc.fillStyle = countColor;
      gc.fillText(countText, countX, cy);
    }
  },
};

/**
 * Master / detail — paint a data row's cell in the column that carries the
 * expand toggle.
 *
 * Layout, matching the group-row path so the two read as one column:
 *
 *   [PADDING] [chevron 12 | blank] [GAP 6] [value]
 *
 * The chevron slot is reserved whether or not the row is a master. A grid
 * where some rows expand and some do not would otherwise show its values
 * stepping left and right down the column, which reads as a rendering bug
 * rather than as "this row has nothing to open".
 *
 * The chevron's x geometry is mirrored by `VelocityGrid.hitTestDetailChevron`
 * — the same load-bearing duplication the group chevron already carries.
 */
function paintMasterCell(
  gc: CachedContext2D,
  p: CellPaintConfig,
  groupValue: GroupCellValue,
): void {
  const cy = p.bounds.y + p.bounds.h / 2;
  const left = p.bounds.x + PADDING;
  if (groupValue.isMaster) {
    drawIcon(
      gc,
      groupValue.masterExpanded ? 'chevron-down' : 'chevron-right',
      left + CHEVRON_SIZE / 2,
      cy,
      CHEVRON_SIZE,
      { color: p.groupChevronColor ?? p.fg, strokeWidth: 2 },
    );
  }
  const text = groupValue.valueFormatted;
  if (text === '') return;
  // Same `gc.cache` bypass as the group-row text path — `drawIcon` leaves the
  // proxy's value tracker stale against the restored ctx.
  gc.fillStyle = p.fg;
  gc.font = p.font;
  gc.textBaseline = 'middle';
  gc.textAlign = 'left';
  gc.fillText(text, left + CHEVRON_SIZE + CHEVRON_GAP, cy);
}

/**
 * Cycle 15 / Task 8 — paint the tri-state checkbox at `(x, y)` (top-left
 * of the 14×14 box). Three states share the same outlined box; interior
 * shape carries the state distinction:
 *   - `'none'`     → border only.
 *   - `'partial'`  → border + horizontal dash through the middle.
 *   - `'all'`      → border + check polyline (same √ as `checkboxCell`).
 *
 * Color comes from the per-cell `groupCheckboxColor` token (resolved
 * from `--vg-group-checkbox-*-color` by `cssReader.ts`). Falls back to
 * the body `fg` when the token isn't wired so an ad-hoc paint call
 * (unit tests, custom themes that haven't declared the token) still
 * produces a legible box.
 */
function paintTriStateCheckbox(
  gc: CachedContext2D,
  x: number,
  y: number,
  p: CellPaintConfig,
  state: 'none' | 'partial' | 'all',
): void {
  const size = CHECKBOX_SIZE;
  const borderColor = p.groupCheckboxBorderColor ?? p.fg;
  const interiorColor = state === 'partial'
    ? (p.groupCheckboxIndeterminateColor ?? p.fg)
    : (p.groupCheckboxCheckColor ?? p.fg);
  // Outlined box — shared glyph helper (same √ / dash as boolean +
  // row-select cells). Optional fill paints under the border.
  const fill = p.groupCheckboxFill;
  paintCheckboxBox(gc, x, y, size, {
    borderColor,
    fill: fill !== undefined && fill !== 'transparent' ? fill : null,
  });
  if (state === 'all') {
    paintCheckboxCheck(gc, x, y, size, interiorColor);
  } else if (state === 'partial') {
    paintCheckboxDash(gc, x, y, size, interiorColor);
  }
  // 'none' → border only.
}

/**
 * Cycle 15 / Task 10 — paint the muted opened-group label on a data
 * row inside the auto-group column. Triggered when `showOpenedGroup: true`
 * is on AND the worker has populated `valueFormatted` for the data row
 * (its leaf-parent group's formatted value). Layout:
 *
 *   [indent: (depth − 1) × indentUnit] [value text, muted]
 *
 * - **Indent** mirrors the leaf group's indent — `(groupDepth − 1) × indentUnit`.
 *   Data rows ride at `groupDepth = rowGroupCols.length` (one deeper
 *   than the deepest group), so subtracting one lands at the leaf
 *   group's depth. The echo sits at the same x-coordinate the leaf
 *   group's value sits at, so the user reads down the column as a
 *   vertical echo of the parent group's label.
 * - **No chevron.** Data rows aren't toggle targets; painting a
 *   chevron glyph would falsely suggest interactivity.
 * - **No (count).** The count is metadata about the group's
 *   descendants — a data row IS one of those descendants; echoing the
 *   count on every descendant reads as visual noise.
 * - **Muted color** — reuses `groupCountColor` (the shared muted
 *   slate). The label is ambient orientation, not a primary value;
 *   painting body fg + body weight on every data row would make the
 *   group name shout down the column, exactly the visual noise the
 *   design wants to avoid.
 */
function paintOpenedGroupLabel(
  gc: CachedContext2D,
  p: CellPaintConfig,
  groupValue: GroupCellValue,
): void {
  const indentUnit = p.groupIndent ?? 14;
  // Data rows ride at `rowGroupCols.length`; the leaf group's depth
  // is one less. Clamp at 0 so a defensive payload with depth === 0
  // (e.g. a synthesised value outside the standard pipeline) doesn't
  // produce a negative indent.
  const leafIndentDepth = Math.max(0, groupValue.depth - 1);
  const indentX = leafIndentDepth * indentUnit;
  const cy = p.bounds.y + p.bounds.h / 2;
  const left = p.bounds.x + PADDING + indentX;
  const mutedColor = p.groupCountColor ?? p.fg;
  // Same `gc.cache` bypass as the group-row text path — drawIcon
  // doesn't run here so the cache tracker stays in sync, but match
  // the cell-renderer conventions for consistency with the existing
  // path.
  gc.fillStyle = mutedColor;
  gc.font = p.font;
  gc.textBaseline = 'middle';
  gc.textAlign = 'left';
  gc.fillText(groupValue.valueFormatted, left, cy);
}
