/**
 * CgTheme wide semantic parameter vocabulary + derivation engine.
 *
 * `CgThemeParams` is the AG-Grid-style "params" surface: a wide set of named,
 * typed knobs (colors/lengths/fonts) that compile down to the `--cg-*` CSS
 * custom-property vocabulary `tokens.css` already defines. `compileParams`
 * folds a param set into a flat `{ '--cg-*': cssExpression }` map — pure
 * data in, pure data out, zero DOM.
 *
 * Every named param maps to one or more `--cg-*` tokens verified against
 * `theming/tokens.css` (grep the token literally before trusting a mapping
 * here — see `.superpowers/sdd/theme-task2-report.md` for the full audit).
 * A handful of tokens auto-derive a live `color-mix()` default when their
 * param is unset, so setting only `accentColor`/`backgroundColor` re-tints
 * dependents without any extra JS color math (resolution happens in the
 * browser's CSS engine, same as `tokens.css`'s own derivations).
 *
 * Precedence (later wins): auto-derivations -> explicit named params (in
 * `SCALAR_PARAMS` canonical order, so a more specific param like
 * `chipRadius` always wins over a fan-out from a more general one like
 * `borderRadius`, regardless of the object-literal key order the caller
 * used) -> record params (`statusColors`/`ratingColors`/`venueColors`) ->
 * `vars` (verbatim escape hatch, highest precedence, applied last).
 */

import {
  compileColor,
  compileLength,
  compileFontFamily,
  compileFontWeight,
  type ColorValue,
  type LengthValue,
  type FontFamilyValue,
  type FontWeightValue,
} from './values';

// ─────────────────────────────────────────────────────────────────────────
// Wide param vocabulary
// ─────────────────────────────────────────────────────────────────────────

/** One `--cg-status-<state>-*` entry. All three sub-keys optional — unset
 *  sub-keys are skipped (no fallback token is emitted for them). */
export interface StatusColorEntry {
  bg?: ColorValue;
  fg?: ColorValue;
  border?: ColorValue;
}

export interface CgThemeParams {
  // Foundational
  backgroundColor?: ColorValue;
  foregroundColor?: ColorValue;
  accentColor?: ColorValue;

  // Geometry / rhythm
  rowHeight?: LengthValue;
  headerHeight?: LengthValue;
  borderRadius?: LengthValue;
  scrollbarThickness?: LengthValue;
  groupIndent?: LengthValue;
  cellPaddingX?: LengthValue;

  // Typography
  fontFamily?: FontFamilyValue;
  cellFontFamily?: FontFamilyValue;
  fontSize?: LengthValue;
  fontSizeSmall?: LengthValue;

  // Borders / lines
  borderColor?: ColorValue;
  gridLineColor?: ColorValue;
  cellHorizontalBorderColor?: ColorValue;

  // Rows
  oddRowBackgroundColor?: ColorValue;
  rowHoverColor?: ColorValue;
  selectedRowBackgroundColor?: ColorValue;

  // Header
  headerBackgroundColor?: ColorValue;
  headerTextColor?: ColorValue;

  // Focus / range
  focusRingColor?: ColorValue;
  focusRingWidth?: LengthValue;
  rangeBorderColor?: ColorValue;
  rangeFillColor?: ColorValue;
  quickFilterMatchColor?: ColorValue;
  unsortIconColor?: ColorValue;

  // Inputs / tooltip / popup / menu / checkbox
  inputBackgroundColor?: ColorValue;
  inputBorderColor?: ColorValue;
  inputFocusBorderColor?: ColorValue;
  inputDisabledBackgroundColor?: ColorValue;
  tooltipBackgroundColor?: ColorValue;
  tooltipTextColor?: ColorValue;
  tooltipBorderColor?: ColorValue;
  popupBackgroundColor?: ColorValue;
  popupBorderColor?: ColorValue;
  menuHoverColor?: ColorValue;
  checkboxCheckedBackgroundColor?: ColorValue;
  checkboxCheckedCheckColor?: ColorValue;

  // Totals / group / pinned / footer
  totalsBackgroundColor?: ColorValue;
  totalsTextColor?: ColorValue;
  totalsMutedTextColor?: ColorValue;
  totalsBorderColor?: ColorValue;
  totalsFontWeight?: FontWeightValue;
  groupRowBackgroundColor?: ColorValue;
  groupChevronColor?: ColorValue;
  groupCountColor?: ColorValue;
  pinnedRowBackgroundColor?: ColorValue;
  pinnedRowTextColor?: ColorValue;
  pinnedRowBorderColor?: ColorValue;
  groupFooterBackgroundColor?: ColorValue;
  groupFooterTextColor?: ColorValue;
  groupFooterBorderColor?: ColorValue;
  groupFooterFontWeight?: FontWeightValue;

  // Status-bar chrome
  statusBarBackgroundColor?: ColorValue;
  statusBarTextColor?: ColorValue;
  statusBarMutedTextColor?: ColorValue;
  statusBarHeight?: LengthValue;
  statusBarFontSize?: LengthValue;
  statusBarGap?: LengthValue;
  statusBarPaddingX?: LengthValue;
  statusBarBorderColor?: ColorValue;

  // Filter / flash
  floatingFilterBackgroundColor?: ColorValue;
  floatingFilterBorderColor?: ColorValue;
  floatingFilterPlaceholderColor?: ColorValue;
  flashColor?: ColorValue;

  // Renderer palette
  positiveColor?: ColorValue;
  negativeColor?: ColorValue;
  warningColor?: ColorValue;
  infoColor?: ColorValue;
  mutedColor?: ColorValue;
  barHeight?: LengthValue;
  chipHeight?: LengthValue;
  chipRadius?: LengthValue;
  statusColors?: Record<string, StatusColorEntry>;
  ratingColors?: Record<string, ColorValue>;
  venueColors?: Record<string, ColorValue>;

  // Escape hatch — applied last, verbatim, highest precedence.
  vars?: Record<`--cg-${string}`, string>;
}

// ─────────────────────────────────────────────────────────────────────────
// Scalar param table (everything except the 3 records + `vars`)
//
// Order is canonical/deterministic: it is NOT the order keys happen to
// appear in a caller's object literal. This is what lets a more specific
// param (`chipRadius`) reliably win over a more general fan-out
// (`borderRadius` -> `--cg-chip-radius`) regardless of how the caller wrote
// their params object.
// ─────────────────────────────────────────────────────────────────────────

type ParamKind = 'color' | 'length' | 'fontFamily' | 'fontWeight';

/** `tokens` lists every `--cg-*` token the param fans out to, primary
 *  (used for `{ref}`/`{onto}` resolution) first. A non-empty tuple type
 *  (rather than `string[]`) so `tokens[0]` is provably defined under
 *  `noUncheckedIndexedAccess` without a runtime guard. */
interface ScalarParamSpec {
  name: keyof CgThemeParams;
  tokens: readonly [string, ...string[]];
  kind: ParamKind;
}

const SCALAR_PARAMS: readonly ScalarParamSpec[] = [
  // Foundational
  { name: 'backgroundColor', tokens: ['--cg-bg-color'], kind: 'color' },
  { name: 'foregroundColor', tokens: ['--cg-fg-color'], kind: 'color' },
  { name: 'accentColor', tokens: ['--cg-chrome-accent'], kind: 'color' },

  // Geometry / rhythm
  { name: 'rowHeight', tokens: ['--cg-row-height'], kind: 'length' },
  { name: 'headerHeight', tokens: ['--cg-header-height'], kind: 'length' },
  {
    name: 'borderRadius',
    tokens: ['--cg-radius', '--cg-modal-radius', '--cg-chip-radius'],
    kind: 'length',
  },
  { name: 'scrollbarThickness', tokens: ['--cg-scrollbar-thickness'], kind: 'length' },
  { name: 'groupIndent', tokens: ['--cg-group-indent'], kind: 'length' },
  { name: 'cellPaddingX', tokens: ['--cg-cell-padding-x'], kind: 'length' },

  // Typography
  { name: 'fontFamily', tokens: ['--cg-font-family'], kind: 'fontFamily' },
  { name: 'cellFontFamily', tokens: ['--cg-cell-font-family'], kind: 'fontFamily' },
  { name: 'fontSize', tokens: ['--cg-font-size'], kind: 'length' },
  { name: 'fontSizeSmall', tokens: ['--cg-font-size-sm'], kind: 'length' },

  // Borders / lines
  { name: 'borderColor', tokens: ['--cg-border-color'], kind: 'color' },
  { name: 'gridLineColor', tokens: ['--cg-grid-line-color'], kind: 'color' },
  {
    name: 'cellHorizontalBorderColor',
    tokens: ['--cg-cell-horizontal-border-color'],
    kind: 'color',
  },

  // Rows
  { name: 'oddRowBackgroundColor', tokens: ['--cg-row-alt-bg'], kind: 'color' },
  { name: 'rowHoverColor', tokens: ['--cg-row-hover-bg'], kind: 'color' },
  { name: 'selectedRowBackgroundColor', tokens: ['--cg-row-selected-bg'], kind: 'color' },

  // Header
  { name: 'headerBackgroundColor', tokens: ['--cg-header-bg'], kind: 'color' },
  { name: 'headerTextColor', tokens: ['--cg-header-fg'], kind: 'color' },

  // Focus / range
  { name: 'focusRingColor', tokens: ['--cg-focus-ring-color'], kind: 'color' },
  { name: 'focusRingWidth', tokens: ['--cg-focus-ring-width'], kind: 'length' },
  { name: 'rangeBorderColor', tokens: ['--cg-range-border-color'], kind: 'color' },
  { name: 'rangeFillColor', tokens: ['--cg-range-fill-color'], kind: 'color' },
  { name: 'quickFilterMatchColor', tokens: ['--cg-quick-filter-match-bg'], kind: 'color' },
  { name: 'unsortIconColor', tokens: ['--cg-unsort-icon-color'], kind: 'color' },

  // Inputs / tooltip / popup / menu / checkbox
  { name: 'inputBackgroundColor', tokens: ['--cg-input-bg'], kind: 'color' },
  { name: 'inputBorderColor', tokens: ['--cg-input-border'], kind: 'color' },
  { name: 'inputFocusBorderColor', tokens: ['--cg-input-focus-border'], kind: 'color' },
  { name: 'inputDisabledBackgroundColor', tokens: ['--cg-input-disabled-bg'], kind: 'color' },
  { name: 'tooltipBackgroundColor', tokens: ['--cg-tooltip-bg'], kind: 'color' },
  { name: 'tooltipTextColor', tokens: ['--cg-tooltip-fg'], kind: 'color' },
  { name: 'tooltipBorderColor', tokens: ['--cg-tooltip-border'], kind: 'color' },
  {
    name: 'popupBackgroundColor',
    tokens: ['--cg-popup-bg', '--cg-modal-bg'],
    kind: 'color',
  },
  {
    name: 'popupBorderColor',
    tokens: ['--cg-popup-border', '--cg-modal-border'],
    kind: 'color',
  },
  { name: 'menuHoverColor', tokens: ['--cg-menu-hover-bg'], kind: 'color' },
  {
    name: 'checkboxCheckedBackgroundColor',
    tokens: ['--cg-checkbox-checked-bg'],
    kind: 'color',
  },
  { name: 'checkboxCheckedCheckColor', tokens: ['--cg-checkbox-checked-fg'], kind: 'color' },

  // Totals / group / pinned / footer
  { name: 'totalsBackgroundColor', tokens: ['--cg-totals-bg'], kind: 'color' },
  { name: 'totalsTextColor', tokens: ['--cg-totals-fg'], kind: 'color' },
  { name: 'totalsMutedTextColor', tokens: ['--cg-totals-fg-muted'], kind: 'color' },
  { name: 'totalsBorderColor', tokens: ['--cg-totals-border-top'], kind: 'color' },
  { name: 'totalsFontWeight', tokens: ['--cg-totals-font-weight'], kind: 'fontWeight' },
  { name: 'groupRowBackgroundColor', tokens: ['--cg-group-row-bg'], kind: 'color' },
  { name: 'groupChevronColor', tokens: ['--cg-group-chevron-color'], kind: 'color' },
  { name: 'groupCountColor', tokens: ['--cg-group-count-color'], kind: 'color' },
  { name: 'pinnedRowBackgroundColor', tokens: ['--cg-pinned-row-bg'], kind: 'color' },
  { name: 'pinnedRowTextColor', tokens: ['--cg-pinned-row-fg'], kind: 'color' },
  { name: 'pinnedRowBorderColor', tokens: ['--cg-pinned-row-border'], kind: 'color' },
  { name: 'groupFooterBackgroundColor', tokens: ['--cg-group-footer-bg'], kind: 'color' },
  { name: 'groupFooterTextColor', tokens: ['--cg-group-footer-fg'], kind: 'color' },
  { name: 'groupFooterBorderColor', tokens: ['--cg-group-footer-border-top'], kind: 'color' },
  {
    name: 'groupFooterFontWeight',
    tokens: ['--cg-group-footer-font-weight'],
    kind: 'fontWeight',
  },

  // Status-bar chrome
  { name: 'statusBarBackgroundColor', tokens: ['--cg-status-bar-bg'], kind: 'color' },
  { name: 'statusBarTextColor', tokens: ['--cg-status-bar-fg'], kind: 'color' },
  { name: 'statusBarMutedTextColor', tokens: ['--cg-status-bar-fg-muted'], kind: 'color' },
  { name: 'statusBarHeight', tokens: ['--cg-status-bar-height'], kind: 'length' },
  { name: 'statusBarFontSize', tokens: ['--cg-status-bar-font-size'], kind: 'length' },
  { name: 'statusBarGap', tokens: ['--cg-status-bar-gap'], kind: 'length' },
  { name: 'statusBarPaddingX', tokens: ['--cg-status-bar-padding-x'], kind: 'length' },
  { name: 'statusBarBorderColor', tokens: ['--cg-status-bar-border'], kind: 'color' },

  // Filter / flash
  {
    name: 'floatingFilterBackgroundColor',
    tokens: ['--cg-floating-filter-bg'],
    kind: 'color',
  },
  {
    name: 'floatingFilterBorderColor',
    tokens: ['--cg-floating-filter-border'],
    kind: 'color',
  },
  {
    name: 'floatingFilterPlaceholderColor',
    tokens: ['--cg-floating-filter-placeholder'],
    kind: 'color',
  },
  {
    name: 'flashColor',
    tokens: ['--cg-flash-from-color', '--cg-flash-to-color'],
    kind: 'color',
  },

  // Renderer palette
  { name: 'positiveColor', tokens: ['--cg-pos-color'], kind: 'color' },
  { name: 'negativeColor', tokens: ['--cg-neg-color'], kind: 'color' },
  { name: 'warningColor', tokens: ['--cg-warning-color'], kind: 'color' },
  { name: 'infoColor', tokens: ['--cg-info-color'], kind: 'color' },
  { name: 'mutedColor', tokens: ['--cg-muted-color'], kind: 'color' },
  { name: 'barHeight', tokens: ['--cg-bar-height'], kind: 'length' },
  { name: 'chipHeight', tokens: ['--cg-chip-height'], kind: 'length' },
  { name: 'chipRadius', tokens: ['--cg-chip-radius'], kind: 'length' },
];

/** Primary token per param name, used by `resolveTokenName` for `{ref}`/
 *  `{onto}` resolution. Built once from `SCALAR_PARAMS` so the two tables
 *  can never drift. */
const TOKEN_BY_PARAM: ReadonlyMap<string, string> = new Map(
  SCALAR_PARAMS.map((spec) => [spec.name, spec.tokens[0]])
);

/**
 * Maps a param name to its primary `--cg-*` token, for `{ref}`/`{onto}`
 * resolution inside `ColorValue`/`LengthValue`. Typed `(param: string)` —
 * not `keyof CgThemeParams` — so it satisfies the `resolveTokenName`
 * parameter type `values.ts`'s compilers expect (`(p: string) => string`);
 * in normal use it is only ever called with `keyof CgThemeParams` names.
 *
 * A name outside the vocabulary (typo, or one of the 3 record params /
 * `vars`, which have no single token) resolves to `''` — `values.ts`'s own
 * compilers already fall back to `var(--<paramName>)` for that case, so
 * this function never needs a second fallback layer of its own.
 */
export function resolveTokenName(param: string): string {
  return TOKEN_BY_PARAM.get(param) ?? '';
}

/**
 * `PARAM_DERIVATIONS[name]` takes the already-compiled CSS-expression
 * string for a param and returns the `--cg-*` token map to merge into the
 * output. Built from `SCALAR_PARAMS` (most are 1:1); `flashColor` is
 * special-cased afterward since its second token's value is a
 * `color-mix(... 0%, transparent)` wrapper around the first, not a literal
 * copy.
 */
export const PARAM_DERIVATIONS: Record<string, (compiledValue: string) => Record<string, string>> =
  Object.fromEntries(
    SCALAR_PARAMS.map((spec) => [
      spec.name,
      (compiledValue: string): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const token of spec.tokens) out[token] = compiledValue;
        return out;
      },
    ])
  );

PARAM_DERIVATIONS.flashColor = (compiledValue: string): Record<string, string> => ({
  '--cg-flash-from-color': compiledValue,
  '--cg-flash-to-color': `color-mix(in srgb, ${compiledValue} 0%, transparent)`,
});

// ─────────────────────────────────────────────────────────────────────────
// Auto-derivations — emitted only when their own param is unset in `params`
// ─────────────────────────────────────────────────────────────────────────

interface AutoDerivation {
  paramName: keyof CgThemeParams;
  token: string;
  css: string;
  /** At least one of these params must be explicitly present in the input
   *  `CgThemeParams` for this derivation to be emitted — otherwise the base
   *  CSS class's own default governs (see Task 5 report / params-task5). */
  deps: readonly (keyof CgThemeParams)[];
}

const AUTO_DERIVE: readonly AutoDerivation[] = [
  {
    paramName: 'borderColor',
    token: '--cg-border-color',
    css: 'color-mix(in srgb, var(--cg-fg-color) 15%, var(--cg-bg-color))',
    deps: ['backgroundColor', 'foregroundColor'],
  },
  {
    paramName: 'gridLineColor',
    token: '--cg-grid-line-color',
    css: 'color-mix(in srgb, var(--cg-fg-color) 9%, var(--cg-bg-color))',
    deps: ['backgroundColor', 'foregroundColor'],
  },
  {
    paramName: 'rowHoverColor',
    token: '--cg-row-hover-bg',
    css: 'color-mix(in srgb, var(--cg-chrome-accent) 7%, var(--cg-bg-color))',
    deps: ['accentColor', 'backgroundColor'],
  },
  {
    paramName: 'selectedRowBackgroundColor',
    token: '--cg-row-selected-bg',
    css: 'color-mix(in srgb, var(--cg-chrome-accent) 12%, var(--cg-bg-color))',
    deps: ['accentColor', 'backgroundColor'],
  },
  {
    paramName: 'headerBackgroundColor',
    token: '--cg-header-bg',
    css: 'color-mix(in srgb, var(--cg-fg-color) 4%, var(--cg-bg-color))',
    deps: ['backgroundColor', 'foregroundColor'],
  },
  {
    paramName: 'rangeBorderColor',
    token: '--cg-range-border-color',
    css: 'var(--cg-chrome-accent)',
    deps: ['accentColor'],
  },
  {
    paramName: 'rangeFillColor',
    token: '--cg-range-fill-color',
    css: 'color-mix(in srgb, var(--cg-range-border-color) 22%, transparent)',
    deps: ['accentColor'],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────

function compileScalar(kind: ParamKind, value: unknown): string {
  switch (kind) {
    case 'color':
      return compileColor(value as ColorValue, resolveTokenName);
    case 'length':
      return compileLength(value as LengthValue, resolveTokenName);
    case 'fontFamily':
      return compileFontFamily(value as FontFamilyValue);
    case 'fontWeight':
      return compileFontWeight(value as FontWeightValue);
  }
}

function compileRecords(params: CgThemeParams, out: Record<string, string>): void {
  if (params.statusColors) {
    for (const [key, entry] of Object.entries(params.statusColors)) {
      const slug = key.toLowerCase();
      if (entry.bg !== undefined) out[`--cg-status-${slug}-bg`] = compileColor(entry.bg, resolveTokenName);
      if (entry.fg !== undefined) out[`--cg-status-${slug}-fg`] = compileColor(entry.fg, resolveTokenName);
      if (entry.border !== undefined) {
        out[`--cg-status-${slug}-border`] = compileColor(entry.border, resolveTokenName);
      }
    }
  }

  if (params.ratingColors) {
    for (const [key, value] of Object.entries(params.ratingColors)) {
      out[`--cg-rating-${key.toLowerCase()}-color`] = compileColor(value, resolveTokenName);
    }
  }

  if (params.venueColors) {
    for (const [key, value] of Object.entries(params.venueColors)) {
      out[`--cg-venue-${key.toLowerCase()}-color`] = compileColor(value, resolveTokenName);
    }
  }
}

/**
 * Compiles a `CgThemeParams` set into a flat `{ '--cg-*': cssExpression }`
 * map, ready to hand to `setThemeParams` (see `theming/themeParams.ts`).
 *
 * Order (later overrides earlier):
 *   1. Auto-derivations for the fixed 7-token set, each emitted only when
 *      BOTH (a) its own param is absent from `params`, AND (b) at least one
 *      of its `deps` (the foundational params its `color-mix()` formula
 *      references) is explicitly present in `params`. Without a dependency
 *      present there is nothing to re-derive from, so the token is omitted
 *      entirely and the base CSS class's own default governs — this is what
 *      makes `compileParams({})` compile to `{}` (byte-identical to a plain
 *      class theme) while `compileParams({ accentColor: '#f00' })` still
 *      re-tints hover/selection/range without the caller repeating those
 *      tokens by hand.
 *   2. Explicit scalar params, in `SCALAR_PARAMS` canonical order (not
 *      object-literal key order) — this is what makes a specific override
 *      (`chipRadius`) reliably beat a general fan-out (`borderRadius`).
 *   3. The 3 record params (`statusColors`/`ratingColors`/`venueColors`).
 *   4. `params.vars`, verbatim, highest precedence.
 */
export function compileParams(params: CgThemeParams): Record<string, string> {
  const out: Record<string, string> = {};

  for (const derivation of AUTO_DERIVE) {
    if (params[derivation.paramName] !== undefined) continue;
    const hasDep = derivation.deps.some((dep) => params[dep] !== undefined);
    if (hasDep) out[derivation.token] = derivation.css;
  }

  for (const spec of SCALAR_PARAMS) {
    const value = params[spec.name];
    if (value === undefined) continue;
    const compiled = compileScalar(spec.kind, value);
    const derive = PARAM_DERIVATIONS[spec.name];
    if (derive) Object.assign(out, derive(compiled));
  }

  compileRecords(params, out);

  if (params.vars) Object.assign(out, params.vars);

  return out;
}
