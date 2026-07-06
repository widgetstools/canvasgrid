/**
 * `CgTheme` — the immutable, chainable programmatic theme object.
 *
 * `CgTheme` wraps a stack of param "layers" (each produced by `withParams`,
 * or — in Task 4 — by `withPart`) and folds them, mode-aware, into a flat
 * `--cg-*` CSS variable map via `compileParams` (Task 2, `./params`). It is
 * pure data: no DOM access, no side effects, every method returns a new
 * `CgTheme` rather than mutating `this`.
 *
 * The internal `ThemeLayer` shape is deliberately general (a `mode` tag +
 * `params` + an optional `feature` label) so Task 4's `withPart`/`withoutPart`
 * can push/filter layers through the exact same fold in `compile()` without
 * any refactor here — a part is just a layer with `feature` set.
 */

import { compileParams, type CgThemeParams, type StatusColorEntry } from './params';

/** Light/dark theme mode, as picked at compile time. */
export type ThemeMode = 'light' | 'dark';

/** The pair of structural base CSS classes a theme applies, one per mode. */
export interface BaseClassPair {
  readonly light: string;
  readonly dark: string;
}

/**
 * One layer of the theme's param stack.
 *
 * `mode: 'base'` means the layer's params apply regardless of which mode is
 * being compiled; `mode: 'light' | 'dark'` scopes the layer to that mode
 * only. `feature` is unused by `withParams` (always `undefined`) and is
 * reserved for Task 4's `withPart`, which will tag a layer with the part's
 * feature name so `withoutPart(feature)` can filter it back out.
 */
interface ThemeLayer {
  readonly mode: 'base' | ThemeMode;
  readonly params: CgThemeParams;
  readonly feature?: string;
}

/** The result of `CgTheme.compile(mode)`: a flat `--cg-*` map plus the
 *  structural base class pair to apply alongside it. */
export interface CompiledTheme {
  readonly vars: Record<string, string>;
  readonly baseClass: BaseClassPair;
}

const DEFAULT_BASE_CLASS: BaseClassPair = {
  light: 'cg-theme-quartz',
  dark: 'cg-theme-quartz-dark',
};

/** Keys of `CgThemeParams` whose value is a `Record<string, X>` that should
 *  be deep-merged (one level) across layers, rather than replaced wholesale
 *  by shallow object spread. */
const RECORD_PARAM_KEYS = ['statusColors', 'ratingColors', 'venueColors', 'vars'] as const;
type RecordParamKey = (typeof RECORD_PARAM_KEYS)[number];

/**
 * Shallow-merges two `CgThemeParams` objects: scalar params from `next` win
 * over `prev` outright, but the record-shaped params (`statusColors`,
 * `ratingColors`, `venueColors`, `vars`) are merged key-by-key so a later
 * layer can add/override individual sub-keys without clobbering the ones an
 * earlier layer set.
 */
function mergeParams(prev: CgThemeParams, next: CgThemeParams): CgThemeParams {
  const merged: CgThemeParams = { ...prev, ...next };

  for (const key of RECORD_PARAM_KEYS) {
    const prevRecord = prev[key as RecordParamKey];
    const nextRecord = next[key as RecordParamKey];
    if (prevRecord === undefined && nextRecord === undefined) continue;
    (merged as Record<RecordParamKey, unknown>)[key] = {
      ...(prevRecord ?? {}),
      ...(nextRecord ?? {}),
    };
  }

  return merged;
}

/** Options accepted by `createTheme` / used internally to construct a
 *  `CgTheme` from an existing layer set (e.g. for built-ins or `withParams`). */
export interface CreateThemeOptions {
  baseClass?: BaseClassPair;
  layers?: readonly ThemeLayer[];
}

export class CgTheme {
  private readonly layers: readonly ThemeLayer[];
  readonly baseClass: BaseClassPair;

  constructor(baseClass: BaseClassPair, layers: readonly ThemeLayer[]) {
    this.baseClass = baseClass;
    this.layers = layers;
  }

  /**
   * Returns a NEW `CgTheme` with `params` appended as a new layer. `mode`
   * omitted (or not passed) tags the layer `'base'`, applying it in both
   * light and dark compiles; passing `'light'`/`'dark'` scopes it to that
   * mode only. Never mutates `this`.
   */
  withParams(params: CgThemeParams, mode?: ThemeMode): CgTheme {
    const layer: ThemeLayer = { mode: mode ?? 'base', params };
    return new CgTheme(this.baseClass, [...this.layers, layer]);
  }

  /**
   * Folds all layers applicable to `mode` (i.e. `mode === 'base'` or
   * `mode === layer.mode`) left-to-right into one merged `CgThemeParams`,
   * then compiles that into a flat `--cg-*` map via `compileParams`.
   */
  compile(mode: ThemeMode): CompiledTheme {
    let merged: CgThemeParams = {};
    for (const layer of this.layers) {
      if (layer.mode === 'base' || layer.mode === mode) {
        merged = mergeParams(merged, layer.params);
      }
    }
    return { vars: compileParams(merged), baseClass: this.baseClass };
  }
}

/**
 * Creates a new `CgTheme`. With no options, an empty theme with the default
 * quartz light/dark base class and no layers (compiles to `{}` vars). Pass
 * `layers` to construct from an existing layer stack (used internally by
 * `withParams` and, in later tasks, `withPart`/built-ins).
 */
export function createTheme(opts?: CreateThemeOptions): CgTheme {
  return new CgTheme(opts?.baseClass ?? DEFAULT_BASE_CLASS, opts?.layers ?? []);
}

// Re-exported for convenience so consumers of `themeObject.ts` don't also
// need to import from `./params` directly for these shared types.
export type { CgThemeParams, StatusColorEntry };
