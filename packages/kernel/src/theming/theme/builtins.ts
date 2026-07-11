/**
 * Built-in `CgTheme` objects — thin wrappers around the two existing
 * `--cg-*` CSS classes (`tokens.css`) so consumers get `withParams`/
 * `withPart` chaining "for free" without writing any CSS themselves.
 *
 * Both built-ins start with empty param layers, so `compile(mode).vars` is
 * `{}` — every token falls straight through to the base CSS class, making
 * the object-theme path byte-identical to the plain string-class path
 * (`theme: 'cg-theme-quartz'`) until a consumer actually calls `withParams`.
 * This only holds because `compileParams` (Task 5, Part A) gates its 7
 * auto-derived tokens on a dependency being explicitly present — see
 * `params.ts`'s `AUTO_DERIVE`/`compileParams` docs.
 */

import { createTheme } from './themeObject';

/** The quartz theme as a `CgTheme`, wrapping `cg-theme-quartz[-dark]`. */
export const themeQuartz = createTheme({
  baseClass: { light: 'cg-theme-quartz', dark: 'cg-theme-quartz-dark' },
});

/** The StarUI theme as a `CgTheme`, wrapping `cg-theme-starui[-dark]`. */
export const themeStarui = createTheme({
  baseClass: { light: 'cg-theme-starui', dark: 'cg-theme-starui-dark' },
});

/** The Cursor theme as a `CgTheme`, wrapping `cg-theme-cursor[-dark]` —
 *  the Cursor IDE (Anysphere) palette: recessed chrome under a brighter
 *  data plane, fg-alpha hairlines, nordic-blue accent, flat 2px radius. */
export const themeCursor = createTheme({
  baseClass: { light: 'cg-theme-cursor', dark: 'cg-theme-cursor-dark' },
});

/** Alias for `themeQuartz` — the neutral starting point most consumers
 *  should `withParams`/`withPart` from. */
export const baseTheme = themeQuartz;
