/**
 * CgTheme wide semantic parameter vocabulary + derivation engine.
 *
 * `CgThemeParams` is the AG-Grid-style "params" surface: a wide set of named,
 * typed knobs (colors/lengths/fonts) that compile down to the `--vg-*` CSS
 * custom-property vocabulary `tokens.css` already defines. `compileParams`
 * folds a param set into a flat `{ '--vg-*': cssExpression }` map — pure
 * data in, pure data out, zero DOM.
 *
 * Every named param maps to one or more `--vg-*` tokens verified against
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

/** One `--vg-status-<state>-*` entry. All three sub-keys optional — unset
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
  vars?: Record<`--vg-${string}`, string>;
}

// ─────────────────────────────────────────────────────────────────────────
// Scalar param table (everything except the 3 records + `vars`)
//
// Order is canonical/deterministic: it is NOT the order keys happen to
// appear in a caller's object literal. This is what lets a more specific
// param (`chipRadius`) reliably win over a more general fan-out
// (`borderRadius` -> `--vg-chip-radius`) regardless of how the caller wrote
// their params object.
// ─────────────────────────────────────────────────────────────────────────

type ParamKind = 'color' | 'length' | 'fontFamily' | 'fontWeight';

/** `tokens` lists every `--vg-*` token the param fans out to, primary
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
  { name: 'backgroundColor', tokens: ['--vg-bg-color'], kind: 'color' },
  { name: 'foregroundColor', tokens: ['--vg-fg-color'], kind: 'color' },
  { name: 'accentColor', tokens: ['--vg-chrome-accent'], kind: 'color' },

  // Geometry / rhythm
  { name: 'rowHeight', tokens: ['--vg-row-height'], kind: 'length' },
  { name: 'headerHeight', tokens: ['--vg-header-height'], kind: 'length' },
  {
    name: 'borderRadius',
    tokens: ['--vg-radius', '--vg-modal-radius', '--vg-chip-radius'],
    kind: 'length',
  },
  { name: 'scrollbarThickness', tokens: ['--vg-scrollbar-thickness'], kind: 'length' },
  { name: 'groupIndent', tokens: ['--vg-group-indent'], kind: 'length' },
  { name: 'cellPaddingX', tokens: ['--vg-cell-padding-x'], kind: 'length' },

  // Typography
  { name: 'fontFamily', tokens: ['--vg-font-family'], kind: 'fontFamily' },
  { name: 'cellFontFamily', tokens: ['--vg-cell-font-family'], kind: 'fontFamily' },
  { name: 'fontSize', tokens: ['--vg-font-size'], kind: 'length' },
  { name: 'fontSizeSmall', tokens: ['--vg-font-size-sm'], kind: 'length' },

  // Borders / lines
  { name: 'borderColor', tokens: ['--vg-border-color'], kind: 'color' },
  { name: 'gridLineColor', tokens: ['--vg-grid-line-color'], kind: 'color' },
  {
    name: 'cellHorizontalBorderColor',
    tokens: ['--vg-cell-horizontal-border-color'],
    kind: 'color',
  },

  // Rows
  { name: 'oddRowBackgroundColor', tokens: ['--vg-row-alt-bg'], kind: 'color' },
  { name: 'rowHoverColor', tokens: ['--vg-row-hover-bg'], kind: 'color' },
  { name: 'selectedRowBackgroundColor', tokens: ['--vg-row-selected-bg'], kind: 'color' },

  // Header
  { name: 'headerBackgroundColor', tokens: ['--vg-header-bg'], kind: 'color' },
  { name: 'headerTextColor', tokens: ['--vg-header-fg'], kind: 'color' },

  // Focus / range
  { name: 'focusRingColor', tokens: ['--vg-focus-ring-color'], kind: 'color' },
  { name: 'focusRingWidth', tokens: ['--vg-focus-ring-width'], kind: 'length' },
  { name: 'rangeBorderColor', tokens: ['--vg-range-border-color'], kind: 'color' },
  { name: 'rangeFillColor', tokens: ['--vg-range-fill-color'], kind: 'color' },
  { name: 'quickFilterMatchColor', tokens: ['--vg-quick-filter-match-bg'], kind: 'color' },
  { name: 'unsortIconColor', tokens: ['--vg-unsort-icon-color'], kind: 'color' },

  // Inputs / tooltip / popup / menu / checkbox
  { name: 'inputBackgroundColor', tokens: ['--vg-input-bg'], kind: 'color' },
  { name: 'inputBorderColor', tokens: ['--vg-input-border'], kind: 'color' },
  { name: 'inputFocusBorderColor', tokens: ['--vg-input-focus-border'], kind: 'color' },
  { name: 'inputDisabledBackgroundColor', tokens: ['--vg-input-disabled-bg'], kind: 'color' },
  { name: 'tooltipBackgroundColor', tokens: ['--vg-tooltip-bg'], kind: 'color' },
  { name: 'tooltipTextColor', tokens: ['--vg-tooltip-fg'], kind: 'color' },
  { name: 'tooltipBorderColor', tokens: ['--vg-tooltip-border'], kind: 'color' },
  {
    name: 'popupBackgroundColor',
    tokens: ['--vg-popup-bg', '--vg-modal-bg'],
    kind: 'color',
  },
  {
    name: 'popupBorderColor',
    tokens: ['--vg-popup-border', '--vg-modal-border'],
    kind: 'color',
  },
  { name: 'menuHoverColor', tokens: ['--vg-menu-hover-bg'], kind: 'color' },
  {
    name: 'checkboxCheckedBackgroundColor',
    tokens: ['--vg-checkbox-checked-bg'],
    kind: 'color',
  },
  { name: 'checkboxCheckedCheckColor', tokens: ['--vg-checkbox-checked-fg'], kind: 'color' },

  // Totals / group / pinned / footer
  { name: 'totalsBackgroundColor', tokens: ['--vg-totals-bg'], kind: 'color' },
  { name: 'totalsTextColor', tokens: ['--vg-totals-fg'], kind: 'color' },
  { name: 'totalsMutedTextColor', tokens: ['--vg-totals-fg-muted'], kind: 'color' },
  { name: 'totalsBorderColor', tokens: ['--vg-totals-border-top'], kind: 'color' },
  { name: 'totalsFontWeight', tokens: ['--vg-totals-font-weight'], kind: 'fontWeight' },
  { name: 'groupRowBackgroundColor', tokens: ['--vg-group-row-bg'], kind: 'color' },
  { name: 'groupChevronColor', tokens: ['--vg-group-chevron-color'], kind: 'color' },
  { name: 'groupCountColor', tokens: ['--vg-group-count-color'], kind: 'color' },
  { name: 'pinnedRowBackgroundColor', tokens: ['--vg-pinned-row-bg'], kind: 'color' },
  { name: 'pinnedRowTextColor', tokens: ['--vg-pinned-row-fg'], kind: 'color' },
  { name: 'pinnedRowBorderColor', tokens: ['--vg-pinned-row-border'], kind: 'color' },
  { name: 'groupFooterBackgroundColor', tokens: ['--vg-group-footer-bg'], kind: 'color' },
  { name: 'groupFooterTextColor', tokens: ['--vg-group-footer-fg'], kind: 'color' },
  { name: 'groupFooterBorderColor', tokens: ['--vg-group-footer-border-top'], kind: 'color' },
  {
    name: 'groupFooterFontWeight',
    tokens: ['--vg-group-footer-font-weight'],
    kind: 'fontWeight',
  },

  // Status-bar chrome
  { name: 'statusBarBackgroundColor', tokens: ['--vg-status-bar-bg'], kind: 'color' },
  { name: 'statusBarTextColor', tokens: ['--vg-status-bar-fg'], kind: 'color' },
  { name: 'statusBarMutedTextColor', tokens: ['--vg-status-bar-fg-muted'], kind: 'color' },
  { name: 'statusBarHeight', tokens: ['--vg-status-bar-height'], kind: 'length' },
  { name: 'statusBarFontSize', tokens: ['--vg-status-bar-font-size'], kind: 'length' },
  { name: 'statusBarGap', tokens: ['--vg-status-bar-gap'], kind: 'length' },
  { name: 'statusBarPaddingX', tokens: ['--vg-status-bar-padding-x'], kind: 'length' },
  { name: 'statusBarBorderColor', tokens: ['--vg-status-bar-border'], kind: 'color' },

  // Filter / flash
  {
    name: 'floatingFilterBackgroundColor',
    tokens: ['--vg-floating-filter-bg'],
    kind: 'color',
  },
  {
    name: 'floatingFilterBorderColor',
    tokens: ['--vg-floating-filter-border'],
    kind: 'color',
  },
  {
    name: 'floatingFilterPlaceholderColor',
    tokens: ['--vg-floating-filter-placeholder'],
    kind: 'color',
  },
  {
    name: 'flashColor',
    tokens: ['--vg-flash-from-color', '--vg-flash-to-color'],
    kind: 'color',
  },

  // Renderer palette
  { name: 'positiveColor', tokens: ['--vg-pos-color'], kind: 'color' },
  { name: 'negativeColor', tokens: ['--vg-neg-color'], kind: 'color' },
  { name: 'warningColor', tokens: ['--vg-warning-color'], kind: 'color' },
  { name: 'infoColor', tokens: ['--vg-info-color'], kind: 'color' },
  { name: 'mutedColor', tokens: ['--vg-muted-color'], kind: 'color' },
  { name: 'barHeight', tokens: ['--vg-bar-height'], kind: 'length' },
  { name: 'chipHeight', tokens: ['--vg-chip-height'], kind: 'length' },
  { name: 'chipRadius', tokens: ['--vg-chip-radius'], kind: 'length' },
];

/** Primary token per param name, used by `resolveTokenName` for `{ref}`/
 *  `{onto}` resolution. Built once from `SCALAR_PARAMS` so the two tables
 *  can never drift. */
const TOKEN_BY_PARAM: ReadonlyMap<string, string> = new Map(
  SCALAR_PARAMS.map((spec) => [spec.name, spec.tokens[0]])
);

/**
 * Maps a param name to its primary `--vg-*` token, for `{ref}`/`{onto}`
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
 * string for a param and returns the `--vg-*` token map to merge into the
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
  '--vg-flash-from-color': compiledValue,
  '--vg-flash-to-color': `color-mix(in srgb, ${compiledValue} 0%, transparent)`,
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
    token: '--vg-border-color',
    css: 'color-mix(in srgb, var(--vg-fg-color) 15%, var(--vg-bg-color))',
    deps: ['backgroundColor', 'foregroundColor'],
  },
  {
    paramName: 'gridLineColor',
    token: '--vg-grid-line-color',
    css: 'color-mix(in srgb, var(--vg-fg-color) 9%, var(--vg-bg-color))',
    deps: ['backgroundColor', 'foregroundColor'],
  },
  {
    paramName: 'rowHoverColor',
    token: '--vg-row-hover-bg',
    css: 'color-mix(in srgb, var(--vg-chrome-accent) 7%, var(--vg-bg-color))',
    deps: ['accentColor', 'backgroundColor'],
  },
  {
    paramName: 'selectedRowBackgroundColor',
    token: '--vg-row-selected-bg',
    css: 'color-mix(in srgb, var(--vg-chrome-accent) 12%, var(--vg-bg-color))',
    deps: ['accentColor', 'backgroundColor'],
  },
  {
    paramName: 'headerBackgroundColor',
    token: '--vg-header-bg',
    css: 'color-mix(in srgb, var(--vg-fg-color) 4%, var(--vg-bg-color))',
    deps: ['backgroundColor', 'foregroundColor'],
  },
  {
    paramName: 'rangeBorderColor',
    token: '--vg-range-border-color',
    css: 'var(--vg-chrome-accent)',
    deps: ['accentColor'],
  },
  {
    paramName: 'rangeFillColor',
    token: '--vg-range-fill-color',
    css: 'color-mix(in srgb, var(--vg-range-border-color) 22%, transparent)',
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
      if (entry.bg !== undefined) out[`--vg-status-${slug}-bg`] = compileColor(entry.bg, resolveTokenName);
      if (entry.fg !== undefined) out[`--vg-status-${slug}-fg`] = compileColor(entry.fg, resolveTokenName);
      if (entry.border !== undefined) {
        out[`--vg-status-${slug}-border`] = compileColor(entry.border, resolveTokenName);
      }
    }
  }

  if (params.ratingColors) {
    for (const [key, value] of Object.entries(params.ratingColors)) {
      out[`--vg-rating-${key.toLowerCase()}-color`] = compileColor(value, resolveTokenName);
    }
  }

  if (params.venueColors) {
    for (const [key, value] of Object.entries(params.venueColors)) {
      out[`--vg-venue-${key.toLowerCase()}-color`] = compileColor(value, resolveTokenName);
    }
  }
}

/**
 * Compiles a `CgThemeParams` set into a flat `{ '--vg-*': cssExpression }`
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
