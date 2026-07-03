import type { CachedContext2D } from '../gc';
import { drawIcon, hasIcon } from '../icons';
import { wrapHeaderLines, fontPxSize, HEADER_LINE_HEIGHT_FACTOR } from './headerWrap';
import { paintCellBorders } from '../painters/cellBordersPainter';
import { paintCellDecorators } from '../painters/cellDecoratorsPainter';
import type { CellContent } from '../../types';

export interface CellPaintConfig {
  // Cell content
  value: unknown;
  valueFormatted: string;
  // Geometry — reuse the same nested bounds object across cells (mutated in place)
  bounds: { x: number; y: number; w: number; h: number };
  // Layered visual props (theme → colDef.cellStyle → cell-specific)
  font: string;
  fg: string;
  bg: string;
  borderColor: string;
  halign: 'left' | 'right' | 'center';
  /** Cycle 27 / Task 1 — vertical alignment of text content. `'middle'`
   *  (default when undefined) preserves the existing behavior; `'top'` /
   *  `'bottom'` shift the text baseline to the cell's top / bottom edge. */
  valign?: 'top' | 'middle' | 'bottom';
  /** Cycle 27 / Task 1 — text transform applied to `valueFormatted` by
   *  `applyCellProps` before the painter reads it. Painters do NOT need to
   *  re-apply this — the transform is already baked into `valueFormatted`. */
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** Cycle 27 / Task 1 — extra CSS-px spacing between glyphs. Painters
   *  forward to `ctx.letterSpacing = '<N>px'` (default `0`). */
  letterSpacing?: number;
  /** Cycle 27 / Task 1 — line-height multiplier for wrap-text cells.
   *  `wrapTextCell` reads this; default `1.2`. */
  lineHeight?: number;
  /** Cycle 27 / Task 1 — per-side content padding. Painters read the
   *  per-side value if set, otherwise fall back to their built-in
   *  default. Normalized to a per-side object by `applyOverridePatch`
   *  (a uniform number becomes `{ top, right, bottom, left }` with the
   *  same value on all sides). */
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Cycle 27 / Task 2 — per-side border override. When set, painters
   *  call `paintCellBorders` after content paint so the borders sit on
   *  top of the cell. Undefined leaves the default grid lines in
   *  charge. */
  border?: import('../../types').BorderSpec;
  /** Cycle 27 / Task 3 — content slot override. When set, painters render
   *  this instead of `valueFormatted`. */
  content?: import('../../types').CellContent;
  /** Cycle 27 / Task 3 — decorators overlaid after content. */
  decorators?: import('../../types').CellDecorator[];
  /** Cycle 21e / Task 11 — see ColCellOverrides.textDecoration. */
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** Cycle 21e / Task 11 — rule-engine indicator for this cell, stored by
   *  the applyCellProps fold; painted by byRows (Task 14). */
  ruleIndicator?: { iconName: string; color: string; target: string; position: string } | null;
  // What's already painted under this cell (bundle bg). Skip the bg fill
  // when bg === prefillColor (already done by the bundle pass).
  prefillColor: string;
  // Per-cell state
  isFocused: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isHeader: boolean;
  // Header-only adornments (ignored by data renderers)
  iconColor?: string;
  /** Cycle 21i / Phase 1 — wrap header text to the column width. */
  wrapHeader?: boolean;
  sortDirection?: 'asc' | 'desc';
  /** Cycle 8 / Task 1 — 1-indexed sort position when the cell's column
   *  participates in a multi-column sort (e.g. `2` means "second sort
   *  key"). `0` / `undefined` for single-column or unsorted columns. */
  sortIndex?: number;
  /** Cycle 8 / Task 1 — total number of columns in the current sort
   *  model. Used by the header painter to decide whether to render the
   *  badge at all (no badge for `sortTotal <= 1`). */
  sortTotal?: number;
  /** Cycle 8 / Task 5 — when `true` and `sortDirection` is unset, the
   *  header painter draws a faint up/down chevron pair so the user can
   *  see at a glance that the column is sortable. The color resolves
   *  from `unSortIconColor` (theme's `--cg-unsort-icon-color`) and the
   *  icon paints at 50% alpha so it never competes with the active
   *  sort chevron on other columns. */
  unSortIcon?: boolean;
  /** Cycle 8 / Task 5 — resolved color for the faint chevron pair.
   *  Threaded from `ResolvedTheme.unsortIconColor` (default: 40% alpha
   *  black/white depending on the active theme). Only meaningful when
   *  `unSortIcon === true`. */
  unSortIconColor?: string;
  /** Cycle 18 / Task 4 — pivot column-group expand/collapse affordance.
   *  Set ONLY on synthesized pivot column-group headers that own a
   *  `columnGroupShow:'closed'` "group total" leaf (i.e. branch pivot
   *  groups). `'open'` paints a chevron-down to indicate the group is
   *  expanded; `'closed'` paints a chevron-right. The header click
   *  already routes through `toggleColumnGroup(groupId)` —
   *  `interaction/features/headerClick.ts` — so the chevron is the
   *  visual cue for the existing hit-testable group region. Design note:
   *  `docs/superpowers/plans/notes/cycle-18-pivoting-design.md` (Task 4). */
  pivotGroupExpand?: 'open' | 'closed';
  /** Row-select header checkbox state, set ONLY on the header cell of
   *  columns declaring `headerCheckboxSelection: true`. `undefined`
   *  on every other header. Values mirror the body checkbox's three
   *  states:
   *    `'none'`    — no rows selected
   *    `'partial'` — at least one but not all rows selected
   *    `'all'`     — every row selected
   *  The header painter renders a centered 14×14 checkbox + matching
   *  glyph (none = empty, partial = dash, all = check) in place of
   *  the column's headerName text. */
  headerCheckboxState?: 'none' | 'partial' | 'all';
  // Flash overlay (Cycle 4 / Task 11 — `flashAlpha` is the per-cell
  // alpha drained from FlashRegistry; `flashFromColor` is the theme's
  // current --cg-flash-from-color so light + dark themes both paint
  // their declared color instead of a hard-coded swatch).
  flashAlpha?: number;
  flashFromColor?: string;
  /**
   * Cycle 14 / Task 5 — muted foreground used by the polished `'totals'`
   * renderer when the cell value is empty / null / undefined. Populated by
   * `applyCellProps` from `theme.totalsFgMuted` only when `ctx.isTotals ===
   * true`; left undefined for data and header cells so non-totals renderers
   * never accidentally pick up a muted color. The totals renderer falls
   * back to `fg` when this is unset.
   */
  emptyFg?: string;
  /**
   * Cycle 15 / Task 4 — auto-group column theme tokens, threaded straight
   * onto every cell config so the `'group'` cell renderer reads chevron
   * color, count suffix color, and the indent unit without reaching into
   * the theme directly. Populated by `applyCellProps` from
   * `theme.groupChevronColor / groupCountColor / groupIndent`. Other
   * renderers (text / number / totals / header) ignore them at zero
   * runtime cost. Design plan:
   * `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 4.
   */
  groupChevronColor?: string;
  groupCountColor?: string;
  groupIndent?: number;
  /**
   * Cycle 15 / Task 8 — tri-state checkbox tokens for the `'group'`
   * cell renderer. Threaded onto every cell config so the renderer
   * reads colors without reaching into the theme. All four default to
   * `var(--cg-fg-color)` so the box reads exactly like the existing
   * `checkboxCell` painter (one checkbox vocabulary across the grid).
   * Apps that want a filled brand-accent checkbox override
   * `groupCheckboxFill + groupCheckboxCheckColor` via the theme.
   * Design plan: `docs/superpowers/plans/notes/cycle-15-grouping-design.md`
   * § Task 8.
   */
  groupCheckboxBorderColor?: string;
  groupCheckboxCheckColor?: string;
  groupCheckboxIndeterminateColor?: string;
  /** When set to a non-`'transparent'` color string, the tri-state
   *  checkbox fills its 14×14 box before painting the border + interior
   *  glyph. Defaults to `'transparent'` (outlined-only). */
  groupCheckboxFill?: string;
  /**
   * Cycle 22 / Task 1 — accent fill for the body `'checkbox'` cell
   * renderer when the value is truthy. When set to a non-
   * `'transparent'` color the painter fills the 14×14 box with this
   * color BEFORE drawing the check, and the check itself uses
   * `checkboxCheckedFg`. `'transparent'` (default) ships the existing
   * outlined-only look so themes that opt out get no visual change.
   */
  checkboxCheckedBg?: string;
  /** Cycle 22 / Task 1 — companion to `checkboxCheckedBg`. Controls the
   *  stroke color of the checkmark itself. Defaults to `fg` so an
   *  outlined-only checkbox still reads in the body text color. */
  checkboxCheckedFg?: string;
  /**
   * Opaque per-cell params forwarded by the painter. Set from either the
   * resolved column's static `cellRendererParams` or — when a column has a
   * `cellRendererSelector` that returned `{ params }` — that per-cell
   * override. Custom painters interpret the shape.
   */
  params?: unknown;
  /**
   * Cycle 21c / Task 13 — compiled composite format program for
   * `type: 'composite'` ColDefs. Threaded by `applyCellProps` from
   * `ResolvedColDef._compositeProgram`; read ONLY by the `'composite'`
   * cell renderer. `undefined` on every non-composite cell.
   */
  compositeProgram?: import('../../types/formatProgramShape').FormatProgramShape;
  /** Cycle 21c / Task 13 — composite fragment-run alignment. Default `'left'`. */
  compositeAlign?: 'left' | 'center' | 'right';
  /** Cycle 21c / Task 13 — composite overflow behavior. Default `'ellipsis'`. */
  compositeOverflow?: 'ellipsis' | 'clip';
  /**
   * Cycle 21c / Task 13 — row-data snapshot + colId for renderers that
   * re-evaluate per-row programs at paint time (composite fragments).
   * Populated only when the column carries a composite program; other
   * cells leave them `undefined` (zero cost on the hot path).
   */
  rowData?: Record<string, unknown>;
  colId?: string;
  /**
   * Cycle 21e / final-review fix — cell identity + theme kind so the
   * composite painter can thread `resolveRuleRef` into
   * `program.resolveFragments` (rule:<ruleId> fragment colors).
   * Populated alongside `compositeProgram`; `undefined` everywhere else
   * (zero cost on the hot path).
   */
  rowId?: string;
  themeKind?: 'light' | 'dark';
}

export interface CellPainter {
  paint(gc: CachedContext2D, p: CellPaintConfig): void;
}

export class CellRendererRegistry {
  private map = new Map<string, CellPainter>();
  register(name: string, painter: CellPainter): void {
    this.map.set(name, painter);
  }
  get(name: string): CellPainter {
    const p = this.map.get(name);
    if (!p) throw new Error(`[cgrid] unknown cellRenderer '${name}'`);
    return p;
  }
}

const PADDING = 6;
const HEADER_PADDING = 8;
const SORT_ICON_SIZE = 14;
const SORT_ICON_PAD = 8;
/** Cycle 18 / Task 4 — pivot column-group chevron sizing. Matches the
 *  sort chevron size + padding so pivot headers don't introduce a new
 *  visual rhythm. */
const PIVOT_CHEVRON_SIZE = 14;
const PIVOT_CHEVRON_GAP = 4;

export function paintBackground(gc: CachedContext2D, p: CellPaintConfig): void {
  // Skip the per-cell bg fill when the bundle already painted this bg.
  if (p.bg !== p.prefillColor) {
    gc.cache.fillStyle = p.bg;
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
  }
  if (p.flashAlpha && p.flashAlpha > 0) {
    gc.cache.save();
    gc.cache.globalAlpha = p.flashAlpha;
    // Cycle 4 / Task 11 — theme-driven flash color. Falls back to the
    // ag-grid yellow so the painter still renders something useful
    // when the theme variable hasn't been resolved (defensive).
    gc.cache.fillStyle = p.flashFromColor ?? '#fef3c7';
    gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
    gc.cache.restore();
  }
}

export const textCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    applyLetterSpacing(gc, p);
    const cy = resolveTextY(gc, p);
    const padLeft = p.padding?.left ?? PADDING;
    const padRight = p.padding?.right ?? PADDING;
    // Cycle 27 / Task 3 — content slot dispatch. When `p.content` is set,
    // render the slot's payload (text / icon / emoji / icon+text) instead
    // of `valueFormatted`. Otherwise fall through to the default text
    // path which uses `valueFormatted`.
    if (p.content) {
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else if (p.halign === 'right') {
      gc.cache.textAlign = 'right';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w - padRight, cy);
      paintTextDecoration(gc, p, p.bounds.x + p.bounds.w - padRight, cy);
    } else if (p.halign === 'center') {
      gc.cache.textAlign = 'center';
      gc.fillText(p.valueFormatted, p.bounds.x + p.bounds.w / 2, cy);
      paintTextDecoration(gc, p, p.bounds.x + p.bounds.w / 2, cy);
    } else {
      gc.cache.textAlign = 'left';
      gc.fillText(p.valueFormatted, p.bounds.x + padLeft, cy);
      paintTextDecoration(gc, p, p.bounds.x + padLeft, cy);
    }
    // Cycle 27 / Task 2 — per-cell border overlay (after content so it
    // sits on top). No-op when p.border is undefined.
    if (p.border) paintCellBorders(gc, p.bounds, p.border);
    // Cycle 27 / Task 3 — decorator overlay layer (after borders so
    // badges sit on the very top).
    if (p.decorators && p.decorators.length > 0) {
      paintCellDecorators(gc, p.bounds, p.decorators);
    }
  },
};

/** Cycle 27 / Task 1 — set the canvas `letterSpacing` from the cell
 *  config. Always writes (defaults to `'0px'`) so the painter never
 *  inherits stale state from a previous cell. */
function applyLetterSpacing(gc: CachedContext2D, p: CellPaintConfig): void {
  const ls = p.letterSpacing ?? 0;
  // The DOM property accepts a CSS length string.
  (gc.cache as any).letterSpacing = `${ls}px`;
}

/** Cycle 21e / Task 11 — draw underline / line-through for the default
 *  text path. 1px line in the current fg, sized by measureText. Called
 *  after fillText with the same x/alignment the text used. */
function paintTextDecoration(
  gc: CachedContext2D,
  p: CellPaintConfig,
  textX: number,
  cy: number,
): void {
  if (!p.textDecoration || p.textDecoration === 'none' || !p.valueFormatted) return;
  const w = gc.measureText(p.valueFormatted).width;
  const x0 = p.halign === 'right' ? textX - w
    : p.halign === 'center' ? textX - w / 2
    : textX;
  const y = p.textDecoration === 'underline' ? cy + 2 : cy - 3;
  gc.cache.save();
  gc.cache.strokeStyle = p.fg;
  gc.cache.lineWidth = 1;
  gc.beginPath();
  gc.moveTo(x0, y);
  gc.lineTo(x0 + w, y);
  gc.stroke();
  gc.cache.restore();
}

/** Cycle 27 / Task 3 — render the content-slot payload. Picks renderer
 *  based on `content.kind`. The default text path (rendering
 *  `valueFormatted`) lives in the painters themselves and is NOT
 *  invoked when a content slot is set. */
function renderContentSlot(
  gc: CachedContext2D,
  p: CellPaintConfig,
  content: CellContent,
  cy: number,
  padLeft: number,
  padRight: number,
): void {
  switch (content.kind) {
    case 'text': {
      // Same alignment logic as the default text path; just substitutes
      // the text value.
      gc.cache.fillStyle = p.fg;
      gc.cache.font = p.font;
      if (p.halign === 'right') {
        gc.cache.textAlign = 'right';
        gc.fillText(content.value, p.bounds.x + p.bounds.w - padRight, cy);
      } else if (p.halign === 'center') {
        gc.cache.textAlign = 'center';
        gc.fillText(content.value, p.bounds.x + p.bounds.w / 2, cy);
      } else {
        gc.cache.textAlign = 'left';
        gc.fillText(content.value, p.bounds.x + padLeft, cy);
      }
      return;
    }
    case 'emoji': {
      const size = content.size ?? Math.max(12, fontSizePx(p.font));
      gc.cache.fillStyle = p.fg;
      gc.cache.font = `${size}px sans-serif`;
      gc.cache.textAlign = 'center';
      gc.cache.textBaseline = 'middle';
      gc.fillText(content.value, p.bounds.x + p.bounds.w / 2, cy);
      return;
    }
    case 'icon': {
      const size = content.size ?? 16;
      const color = content.color ?? p.fg;
      drawIcon(gc as unknown as CanvasRenderingContext2D, content.icon,
        p.bounds.x + p.bounds.w / 2, cy, size, { color, strokeWidth: 2 });
      return;
    }
    case 'icon-text': {
      const iconSize = content.iconSize ?? 14;
      const iconColor = content.iconColor ?? p.fg;
      const gap = content.gap ?? 4;
      const before = (content.iconPosition ?? 'before') === 'before';
      const textWidth = gc.measureText(content.text).width;
      const totalWidth = iconSize + gap + textWidth;
      // Center the icon+text cluster horizontally based on halign.
      let startX: number;
      if (p.halign === 'right') startX = p.bounds.x + p.bounds.w - padRight - totalWidth;
      else if (p.halign === 'center') startX = p.bounds.x + (p.bounds.w - totalWidth) / 2;
      else startX = p.bounds.x + padLeft;

      const iconX = before ? startX + iconSize / 2 : startX + textWidth + gap + iconSize / 2;
      const textX = before ? startX + iconSize + gap : startX;
      drawIcon(gc as unknown as CanvasRenderingContext2D, content.icon, iconX, cy, iconSize,
        { color: iconColor, strokeWidth: 2 });
      gc.cache.fillStyle = p.fg;
      gc.cache.font = p.font;
      gc.cache.textAlign = 'left';
      gc.cache.textBaseline = (gc.cache as any).textBaseline ?? 'middle';
      gc.fillText(content.text, textX, cy);
      return;
    }
  }
}

/** Parse the px size out of a CSS font shorthand. Defensive default 13. */
function fontSizePx(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]!) : 13;
}

/** Cycle 27 / Task 1 — sets `textBaseline` on the canvas and returns the
 *  matching y coordinate based on `p.valign`. Centralised so every renderer
 *  picks up valign uniformly. Undefined valign keeps the historical
 *  `'middle'` baseline behaviour. */
function resolveTextY(gc: CachedContext2D, p: CellPaintConfig): number {
  const valign = p.valign ?? 'middle';
  if (valign === 'top') {
    gc.cache.textBaseline = 'top';
    return p.bounds.y + PADDING / 2;
  }
  if (valign === 'bottom') {
    gc.cache.textBaseline = 'alphabetic';
    return p.bounds.y + p.bounds.h - PADDING / 2;
  }
  gc.cache.textBaseline = 'middle';
  return p.bounds.y + p.bounds.h / 2;
}

export const numberCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    applyLetterSpacing(gc, p);
    const align: CanvasTextAlign = p.halign === 'left' || p.halign === 'center'
      ? p.halign
      : 'right';
    gc.cache.textAlign = align;
    const cy = resolveTextY(gc, p);
    const padLeft = p.padding?.left ?? PADDING;
    const padRight = p.padding?.right ?? PADDING;
    const x = align === 'right' ? p.bounds.x + p.bounds.w - padRight
            : align === 'center' ? p.bounds.x + p.bounds.w / 2
            : p.bounds.x + padLeft;
    if (p.content) {
      renderContentSlot(gc, p, p.content, cy, padLeft, padRight);
    } else {
      gc.fillText(p.valueFormatted, x, cy);
      paintTextDecoration(gc, p, x, cy);
    }
    // Cycle 27 / Task 2 — per-cell border overlay.
    if (p.border) paintCellBorders(gc, p.bounds, p.border);
    // Cycle 27 / Task 3 — decorator overlay layer.
    if (p.decorators && p.decorators.length > 0) {
      paintCellDecorators(gc, p.bounds, p.decorators);
    }
  },
};

export const checkboxCell: CellPainter = {
  paint(gc, p) {
    paintBackground(gc, p);
    // Three-state indicator for boolean columns:
    //   true  → outlined 14×14 box + checkmark (accent fill when
    //           `--cg-checkbox-checked-bg` opts in);
    //   false → outlined 14×14 empty box;
    //   null / undefined / '' → centered em-dash at 50% alpha of `fg`,
    //           no box — the absence of the box IS the "no value" signal.
    // Shape carries meaning without color so the indicator stays legible
    // for colorblind readers + both themes. All colors resolve from the
    // theme tokens the painter already reads (`fg`, `bg`, checkboxChecked*).
    //
    // Value coercion follows the same widened rules `columnDefsMap` will
    // eventually derive for `cellDataType: 'boolean'`, but stays inside
    // the painter for now so no worker-side changes are needed:
    //   • real booleans (true / false) → their state
    //   • strings 'true' / 'false' (case-insensitive) → parsed state
    //     (the worker packs `String(row.confirmed)` when it ships a text
    //     column, so `false` arrives as `"false"` — treating that
    //     `"false"` string as truthy would flip the visual state)
    //   • '' / null / undefined → the null path
    //   • anything else numeric — 0 → false, non-zero → true
    const state = resolveTriState(p.value);
    if (state === 'null') {
      // Muted em-dash centered in the cell's box region. Alpha 0.5 sits
      // below the outlined box's visual weight so a column mixing false
      // and null reads with the trader's eye pulled to the concrete "no"
      // first and the "unknown" second.
      const prevAlpha = gc.cache.globalAlpha;
      gc.cache.globalAlpha = prevAlpha * 0.5;
      gc.cache.fillStyle = p.fg;
      gc.cache.font = p.font;
      gc.cache.textAlign = 'center';
      gc.cache.textBaseline = 'middle';
      gc.fillText('—', p.bounds.x + p.bounds.w / 2, p.bounds.y + p.bounds.h / 2);
      gc.cache.globalAlpha = prevAlpha;
      return;
    }
    const isTrue = state === 'true';
    const size = 14;
    const cx = p.bounds.x + p.bounds.w / 2 - size / 2;
    const cy = p.bounds.y + p.bounds.h / 2 - size / 2;
    // Cycle 22 / Task 1 — accent fill when the theme opted in AND the
    // value is truthy. Outlined-only otherwise (the default path —
    // matches the look the renderer has shipped since Cycle 3).
    const accent = isTrue && p.checkboxCheckedBg && p.checkboxCheckedBg !== 'transparent'
      ? p.checkboxCheckedBg
      : null;
    if (accent) {
      gc.cache.fillStyle = accent;
      gc.fillRect(cx, cy, size, size);
    }
    gc.cache.strokeStyle = p.fg;
    gc.cache.lineWidth = 1;
    gc.strokeRect(cx + 0.5, cy + 0.5, size, size);
    if (isTrue) {
      gc.cache.strokeStyle = accent ? (p.checkboxCheckedFg ?? p.fg) : p.fg;
      gc.beginPath();
      gc.moveTo(cx + 3, cy + size / 2);
      gc.lineTo(cx + size / 2 - 1, cy + size - 3);
      gc.lineTo(cx + size - 2, cy + 3);
      gc.stroke();
    }
  },
};

/** Coerce an arbitrary cell value into the tri-state the checkbox painter
 *  understands. Kept outside the painter so both the painter + tests share
 *  one source of truth for the boolean-column coercion rules — same rules
 *  a future `cellDataType: 'boolean'` would apply at the worker boundary. */
function resolveTriState(v: unknown): 'true' | 'false' | 'null' {
  if (v === null || v === undefined || v === '') return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true') return 'true';
    if (s === 'false') return 'false';
    return 'null';
  }
  if (typeof v === 'number') return v === 0 ? 'false' : 'true';
  return 'null';
}

export const headerCell: CellPainter = {
  paint(gc, p) {
    // Bundle already painted headerBg for the entire header row; skip per-cell bg
    // unless the cell bg differs (e.g., a column override).
    paintBackground(gc, p);
    gc.cache.fillStyle = p.fg;
    gc.cache.font = p.font;
    gc.cache.textBaseline = 'middle';
    gc.cache.textAlign = 'left';
    const cy = p.bounds.y + p.bounds.h / 2;
    // Cycle 18 / Task 4 — pivot column-group chevron. Painted at the
    // LEFT of the header text when the cell belongs to a branch pivot
    // group; chevron-down when expanded, chevron-right when collapsed.
    // The whole group-header rect is already hit-testable via
    // `interaction/features/headerClick.ts` → `toggleColumnGroup` so the
    // chevron is purely a visual affordance — the click target is the
    // entire group-header band, matching how Cycle 4 column groups
    // already work.
    // Row-select header checkbox — paints CENTERED in the column,
    // suppresses the headerName text. Apps that want both should use
    // a custom column header (deferred to a later cycle).
    if (p.headerCheckboxState !== undefined) {
      const size = 14;
      const cx = p.bounds.x + p.bounds.w / 2 - size / 2;
      const cy2 = p.bounds.y + p.bounds.h / 2 - size / 2;
      const checked = p.headerCheckboxState === 'all';
      const partial = p.headerCheckboxState === 'partial';
      const accent = (checked || partial)
        && p.checkboxCheckedBg
        && p.checkboxCheckedBg !== 'transparent'
        ? p.checkboxCheckedBg
        : null;
      if (accent) {
        gc.cache.fillStyle = accent;
        gc.fillRect(cx, cy2, size, size);
      }
      gc.cache.strokeStyle = p.fg;
      gc.cache.lineWidth = 1;
      gc.strokeRect(cx + 0.5, cy2 + 0.5, size, size);
      if (checked) {
        gc.cache.strokeStyle = accent ? (p.checkboxCheckedFg ?? p.fg) : p.fg;
        gc.beginPath();
        gc.moveTo(cx + 3, cy2 + size / 2);
        gc.lineTo(cx + size / 2 - 1, cy2 + size - 3);
        gc.lineTo(cx + size - 2, cy2 + 3);
        gc.stroke();
      } else if (partial) {
        gc.cache.strokeStyle = accent ? (p.checkboxCheckedFg ?? p.fg) : p.fg;
        gc.beginPath();
        gc.moveTo(cx + 3, cy2 + size / 2);
        gc.lineTo(cx + size - 3, cy2 + size / 2);
        gc.stroke();
      }
      return;
    }
    let textX = p.bounds.x + HEADER_PADDING;
    if (p.pivotGroupExpand !== undefined) {
      const iconCx = p.bounds.x + HEADER_PADDING + PIVOT_CHEVRON_SIZE / 2;
      drawIcon(
        gc,
        p.pivotGroupExpand === 'open' ? 'chevron-down' : 'chevron-right',
        iconCx, cy, PIVOT_CHEVRON_SIZE,
        { color: p.iconColor ?? p.fg, strokeWidth: 2 },
      );
      textX = p.bounds.x + HEADER_PADDING + PIVOT_CHEVRON_SIZE + PIVOT_CHEVRON_GAP;
    }
    // Cycle 21i / Phase 1 — wrapped multi-line header. Lines share the
    // exact wrap algorithm the auto-header-height computation uses
    // (headerWrap.ts) so painted lines always fit the measured height.
    if (p.wrapHeader) {
      const maxW = Math.max(8, p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE - textX);
      const lines = wrapHeaderLines((t) => gc.measureText(t).width, p.valueFormatted, maxW);
      if (lines.length > 1) {
        const lineH = Math.round(fontPxSize(p.font) * HEADER_LINE_HEIGHT_FACTOR);
        const blockH = lines.length * lineH;
        let ly = p.bounds.y + Math.max(0, (p.bounds.h - blockH) / 2) + lineH / 2;
        const maxY = p.bounds.y + p.bounds.h - lineH / 2 + 1;
        for (const line of lines) {
          if (ly > maxY) break; // clip: header row shorter than the block
          gc.fillText(line, textX, ly);
          ly += lineH;
        }
      } else {
        gc.fillText(p.valueFormatted, textX, cy);
      }
    } else {
      gc.fillText(p.valueFormatted, textX, cy);
    }
    if (p.sortDirection) {
      const iconCx = p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
      drawIcon(
        gc,
        p.sortDirection === 'asc' ? 'chevron-up' : 'chevron-down',
        iconCx, cy, SORT_ICON_SIZE,
        { color: p.iconColor ?? p.fg, strokeWidth: 2 },
      );
      // Cycle 8 / Task 1 — sort-order badge. Paints a tiny 1-indexed
      // number to the LEFT of the chevron when the cell participates
      // in a multi-column sort (sortTotal > 1). Drawn at 80% font size,
      // 75% alpha so the chevron stays the primary marker.
      if (p.sortTotal !== undefined && p.sortTotal > 1
          && p.sortIndex !== undefined && p.sortIndex > 0) {
        const badgeFont = scaleFontSize(p.font, 0.8);
        const baseColor = p.iconColor ?? p.fg;
        gc.cache.save();
        gc.cache.globalAlpha = 0.75;
        gc.cache.fillStyle = baseColor;
        gc.cache.font = badgeFont;
        gc.cache.textAlign = 'right';
        gc.cache.textBaseline = 'middle';
        const badgeX = p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE - 2;
        gc.fillText(String(p.sortIndex), badgeX, cy);
        gc.cache.restore();
      }
    } else if (p.unSortIcon) {
      // Cycle 8 / Task 5 — faint up/down chevron pair on sortable
      // columns that aren't currently sorted. Slotted in the same slot
      // the active chevron would take so the icon never reflows when
      // a sort lands on the column. Paints at 50% alpha so it stays a
      // hint, not a focal point.
      const iconCx = p.bounds.x + p.bounds.w - SORT_ICON_PAD - SORT_ICON_SIZE / 2;
      gc.cache.save();
      gc.cache.globalAlpha = 0.5;
      drawIcon(
        gc,
        'chevrons-up-down',
        iconCx, cy, SORT_ICON_SIZE,
        { color: p.unSortIconColor ?? p.fg, strokeWidth: 2 },
      );
      gc.cache.restore();
    }
    // Cycle 27 / Task 2 — per-header border overlay (from
    // headerStyle.border or groupHeaderStyle.border).
    if (p.border) paintCellBorders(gc, p.bounds, p.border);
  },
};

/** Scale the numeric `px` size of a CSS font string by `factor`.
 *  Falls back to the original font when no `Npx` token is found —
 *  defensive against custom theme fonts that already use shorthand. */
function scaleFontSize(font: string, factor: number): string {
  return font.replace(/(\d+(?:\.\d+)?)px/, (_, n) => {
    const next = Math.max(8, Math.round(Number(n) * factor));
    return `${next}px`;
  });
}
