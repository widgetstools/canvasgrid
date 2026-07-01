// Cell-styling primitives — typography, borders, padding, content slots,
// decorators, and the per-cell override patch + class/style callback shapes.
// Cycle 27 introduced the families; this file extracted them from the
// monolithic types.ts under cycle 19 / Task 1 (refactor hygiene). Leaf
// module — no intra-types dependencies.

/** Cycle 27 / Task 1 — vertical alignment of cell content. */
export type VAlign = 'top' | 'middle' | 'bottom';

/** Cycle 27 / Task 1 — CSS font-weight values accepted in style overrides. */
export type FontWeight =
  | 'normal' | 'bold' | 'lighter' | 'bolder'
  | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/** Cycle 27 / Task 1 — italic switch. */
export type FontStyle = 'normal' | 'italic';

/** Cycle 27 / Task 1 — text transform applied to `valueFormatted` before
 *  the painter reads it. */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

/** Cycle 27 / Task 1 — per-side padding override for cell content area.
 *  Missing sides fall back to the painter's default (typically 6px). */
export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Cycle 27 / Task 2 — line style of a cell border side. */
export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double';

/** Cycle 27 / Task 2 — per-side border definition. A side with no `width`
 *  (or `width: 0`) is invisible. `style` defaults to `'solid'`. */
export interface BorderSide {
  width?: number;
  color?: string;
  style?: BorderStyle;
}

/** Cycle 27 / Task 2 — per-cell border override. Each side can be set
 *  independently; `all` provides a fallback for sides not explicitly
 *  listed (explicit side wins). */
export interface BorderSpec {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
  /** Fallback for any side NOT explicitly set above. */
  all?: BorderSide;
}

/** Cycle 27 / Task 3 — cell content slot. When set on `cellStyle.content`,
 *  the painter renders this instead of `valueFormatted` (the default text
 *  path). Use `'text'` to override the rendered string, `'icon'` to render
 *  a registered icon, `'emoji'` to render a Unicode glyph at a custom
 *  size, or `'icon-text'` to render both. */
export type CellContent =
  | { kind: 'text'; value: string }
  | { kind: 'icon'; icon: string; color?: string; size?: number }
  | { kind: 'emoji'; value: string; size?: number }
  | {
      kind: 'icon-text';
      icon: string;
      text: string;
      /** Default `'before'` (icon left of text). */
      iconPosition?: 'before' | 'after';
      /** CSS-pixel gap between icon and text. Default `4`. */
      gap?: number;
      iconColor?: string;
      iconSize?: number;
    };

/** Cycle 27 / Task 3 — decorator anchor positions. */
export type DecoratorPosition =
  | 'tl' | 'tr' | 'bl' | 'br'   // four corners
  | 'ml' | 'mr';                 // middle-left, middle-right

/** Cycle 27 / Task 3 — small decorator (icon / emoji / dot / short text
 *  label) anchored to one of six positions inside a cell. Decorators
 *  overlay the cell content; they don't shrink the content area. */
export type CellDecorator =
  | {
      position: DecoratorPosition;
      kind: 'icon';
      icon: string;        // registered icon name
      color?: string;
      size?: number;       // CSS pixels, default 12
      inset?: number;      // distance from cell edge, default 2
      bg?: string;         // optional badge background (circle)
    }
  | {
      position: DecoratorPosition;
      kind: 'emoji' | 'text';
      value: string;
      color?: string;
      size?: number;       // CSS pixels (font size), default 12
      inset?: number;
      bg?: string;
    }
  | {
      position: DecoratorPosition;
      kind: 'dot';
      color: string;       // required for dot
      size?: number;       // diameter; default 6
      inset?: number;
      bg?: string;         // optional ring
    };

export interface ColCellOverrides {
  // ── Colors ────────────────────────────────────────────────────────────────
  fg?: string;
  bg?: string;

  // ── Alignment ─────────────────────────────────────────────────────────────
  halign?: 'left' | 'right' | 'center';
  /** Cycle 27 / Task 1 — `'middle'` (default) preserves the centered
   *  baseline; `'top'` / `'bottom'` shift the text baseline to the cell's
   *  top / bottom edge. */
  valign?: VAlign;

  // ── Font (shorthand kept for back-compat; breakouts compose into it) ──────
  font?: string;
  /** Cycle 27 / Task 1 — font family. Wins over the family in the fallback
   *  shorthand. */
  fontFamily?: string;
  /** Cycle 27 / Task 1 — font size in CSS pixels. Wins over the size in the
   *  fallback shorthand. */
  fontSize?: number;
  /** Cycle 27 / Task 1 — font weight. Numeric (100–900) or CSS keyword
   *  (`'normal'`, `'bold'`, `'lighter'`, `'bolder'`). */
  fontWeight?: FontWeight;
  /** Cycle 27 / Task 1 — italic / normal switch. */
  fontStyle?: FontStyle;

  // ── Text ──────────────────────────────────────────────────────────────────
  /** Cycle 27 / Task 1 — transform applied to `valueFormatted` before paint:
   *  `'uppercase'` / `'lowercase'` / `'capitalize'` / `'none'` (default). */
  textTransform?: TextTransform;
  /** Cycle 27 / Task 1 — extra spacing between characters in CSS pixels.
   *  Forwarded to `CanvasRenderingContext2D.letterSpacing` at paint time
   *  (Chromium 99+, Firefox 116+, Safari 16+). */
  letterSpacing?: number;
  /** Cycle 27 / Task 1 — line-height multiplier for wrap-text cells.
   *  Default `1.2`. Has no effect on single-line `textCell` / `numberCell`. */
  lineHeight?: number;
  /** Cycle 27 / Task 1 — content padding. Accepts a uniform number
   *  (applies to all four sides) or a per-side object. Missing sides
   *  fall back to the painter's default. */
  padding?: number | Padding;

  // ── Borders ───────────────────────────────────────────────────────────────
  /** Cycle 27 / Task 2 — per-side border override. Replaces any previous
   *  `border` patch wholesale (not deep-merged). Sides not listed in the
   *  patch are invisible unless `all` is set. */
  border?: BorderSpec;

  // ── Content + decorators ──────────────────────────────────────────────────
  /** Cycle 27 / Task 3 — override the cell's rendered content. When set,
   *  the painter renders this instead of `valueFormatted` (the default
   *  text path). Replaces wholesale on patch. */
  content?: CellContent;
  /** Cycle 27 / Task 3 — up to 6 decorators (one per position) overlaid
   *  on the cell after content paint. Each anchored to one of
   *  TL/TR/BL/BR/ML/MR. Replaces wholesale on patch. */
  decorators?: CellDecorator[];
}

/** Params passed to `cellClass`, `cellClassRules`, and `cellStyle` callbacks. */
export interface CellClassParams<TRow = any, TValue = any> {
  data: TRow;
  value: TValue;
  colId: string;
  rowIndex: number;
}

/**
 * Per-column cell class. Applied to the cell before `cellClassRules`.
 * Resolves to one or more variant names looked up from the theme's
 * `cellClassVariants` map. Cycle 6 / Task 7.
 */
export type CellClass<TRow = any, TValue = any> =
  | string
  | string[]
  | ((params: CellClassParams<TRow, TValue>) => string | string[] | undefined);

/**
 * Map of class-name → predicate. The predicate is called per cell at paint
 * time; when it returns `true`, the class name is resolved through the theme's
 * `cellClassVariants` map and the resulting `ColCellOverrides` patch is applied.
 * Pre-compiled once in `resolveColDef`; zero allocation per paint.
 * Cycle 6 / Task 7.
 */
export type CellClassRules<TRow = any, TValue = any> = Record<
  string,
  (params: CellClassParams<TRow, TValue>) => boolean
>;

/**
 * Function-form `cellStyle`. Called per cell; its return value is a raw
 * `ColCellOverrides` patch applied AFTER class-driven variants (highest
 * precedence). Return `null` / `undefined` to apply no override.
 * Cycle 6 / Task 7.
 */
export type CellStyleFunc<TRow = any, TValue = any> = (
  params: CellClassParams<TRow, TValue>,
) => ColCellOverrides | null | undefined;

/**
 * Per-column header class. Resolves to one or more variant names looked up
 * from the theme's `headerClassVariants` map. Cycle 6 / Task 7.
 */
export type HeaderClass =
  | string
  | string[]
  | ((params: { colId: string }) => string | string[] | undefined);

/**
 * Function-form `headerStyle`. Cycle 27 / Task 1. Applied per header paint;
 * return value layers AFTER any class-driven variants.
 */
export type HeaderStyleFunc = (
  params: { colId: string },
) => ColCellOverrides | null | undefined;
