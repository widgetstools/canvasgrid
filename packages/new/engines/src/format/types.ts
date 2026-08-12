/**
 * Shared format vocabulary consumed by the grid's column contract
 * (`ResolvedColDef.cellIcon` / `headerIcon`, composite cell fragments).
 *
 * These live in the engines package rather than the grid so the grid's public
 * column types have a single owner for icon/fragment shapes.
 */

/** A drawable glyph. Exactly one of `name` / `emoji` is set. */
export interface IconRef {
  /** Registered icon name (icon-set registry / Lucide). */
  name?: string;
  /** Unicode emoji glyph, drawn via `fillText`. */
  emoji?: string;
  /** Tint for `Path2D` icons. Ignored for emoji. */
  color?: string;
  position?: 'leading' | 'trailing';
}

export interface FragmentStyle {
  color?: string;
  weight?: 'normal' | 'bold' | number;
  style?: 'normal' | 'italic';
  size?: number;
  background?: string;
}

/** One run inside a composite cell — literal text or an evaluated expression. */
export type Fragment =
  | { text: string }
  | { expr: string; format?: string; style?: FragmentStyle };

export interface ResolvedFragment {
  text: string;
  style: FragmentStyle;
  icon?: IconRef;
}
