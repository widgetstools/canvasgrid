/**
 * CgTheme value-type compiler.
 *
 * Pure value-type unions + compiler functions that turn a semantic theme
 * value into a CSS expression string (`var(...)`, `color-mix(...)`,
 * `calc(...)`, or a verbatim literal). This module performs ZERO colour
 * math and touches no DOM: every "resolved colour" is actually just a CSS
 * expression string that the browser resolves at paint time via
 * `getComputedStyle` (see `theming/cssReader.ts`). This keeps the compiler
 * tiny, tree-shakeable, and side-effect free.
 *
 * `resolveTokenName` maps a *param* name (e.g. `'accentColor'`) to its
 * primary `--cg-*` custom-property name (e.g. `'--cg-chrome-accent'`). It is
 * supplied by `theming/theme/params.ts` (Task 2) — this module has no
 * knowledge of the param vocabulary itself, so it stays independently
 * testable and reusable.
 */

/** A colour value: a verbatim CSS colour, a token reference, or a color-mix expression. */
export type ColorValue =
  | string
  | { ref: string }
  | { ref: string; mix: number; onto: string };

/** A length value: a px number, a verbatim CSS length, a token reference, or a calc() expression. */
export type LengthValue = number | string | { ref: string } | { calc: string };

/** A border value: a verbatim CSS border shorthand, or a boolean (v1 — object form deferred). */
export type BorderValue = string | boolean;

/** A font-family value: a verbatim CSS font-family string, or a list of family names. */
export type FontFamilyValue = string | string[];

/** A font-weight value: a numeric weight or a verbatim keyword (e.g. `'bold'`). */
export type FontWeightValue = number | string;

const DEFAULT_BORDER_COLOR_TOKEN = '--cg-border-color';

/**
 * Resolve a param name to `var(--cg-*)`, using `resolveTokenName`. If the
 * resolver can't find a token for the param (typo, unknown param), we don't
 * throw — the compiler's job is to emit a CSS expression, not to validate
 * the param vocabulary (that's Task 2's job, at compile-time in `params.ts`).
 * As a defensive fallback we emit `var(--<paramName>)` so the failure is at
 * least visible/greppable in the DOM instead of silently producing `var()`.
 */
function refToVar(paramName: string, resolveTokenName: (p: string) => string): string {
  const token = resolveTokenName(paramName);
  return `var(${token || `--${paramName}`})`;
}

/** Format a 0–1 fraction as a CSS percentage, clamped, with no trailing `.0`. */
function toPercent(mix: number): string {
  const clamped = Math.min(1, Math.max(0, mix));
  const pct = clamped * 100;
  // Drop a trailing ".0" (or more precisely, any trailing zeros + dot) e.g. 25 not 25.0, 7.5 stays 7.5.
  const rounded = Math.round(pct * 1000) / 1000;
  return `${rounded}%`;
}

export function compileColor(
  v: ColorValue,
  resolveTokenName: (p: string) => string
): string {
  if (typeof v === 'string') {
    return v;
  }
  if ('mix' in v && 'onto' in v) {
    const from = refToVar(v.ref, resolveTokenName);
    const onto = v.onto === 'transparent' ? 'transparent' : refToVar(v.onto, resolveTokenName);
    return `color-mix(in srgb, ${from} ${toPercent(v.mix)}, ${onto})`;
  }
  return refToVar(v.ref, resolveTokenName);
}

export function compileLength(
  v: LengthValue,
  resolveTokenName: (p: string) => string
): string {
  if (typeof v === 'number') {
    return `${v}px`;
  }
  if (typeof v === 'string') {
    return v;
  }
  if ('calc' in v) {
    const expr = v.calc.trim();
    return expr.startsWith('calc(') ? expr : `calc(${expr})`;
  }
  return refToVar(v.ref, resolveTokenName);
}

export function compileBorder(
  v: BorderValue,
  borderColorToken: string = DEFAULT_BORDER_COLOR_TOKEN
): string {
  if (typeof v === 'string') {
    return v;
  }
  return v ? `1px solid var(${borderColorToken})` : 'none';
}

export function compileFontFamily(v: FontFamilyValue): string {
  if (typeof v === 'string') {
    return v;
  }
  return v
    .map((name) => {
      const trimmed = name.trim();
      const alreadyQuoted =
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'));
      if (alreadyQuoted) {
        return trimmed;
      }
      return /\s/.test(trimmed) ? `'${trimmed}'` : trimmed;
    })
    .join(', ');
}

export function compileFontWeight(v: FontWeightValue): string {
  return String(v);
}
