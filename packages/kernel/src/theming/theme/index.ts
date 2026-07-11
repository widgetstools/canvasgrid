/**
 * Barrel for the programmatic theme object module. `cgrid.ts` (the public
 * package entry) re-exports the public subset of this barrel; internal
 * modules (`cgrid.ts`'s DOM integration) import directly from here rather
 * than reaching into `./themeObject` / `./params` / `./values` individually.
 */

export { CgTheme, createTheme } from './themeObject';
export type {
  ThemeMode,
  BaseClassPair,
  Part,
  CompiledTheme,
  CreateThemeOptions,
  CgThemeParams,
  StatusColorEntry,
} from './themeObject';

export { themeQuartz, themeStarui, themeCursor, baseTheme } from './builtins';

export { compactInputs, accentInputs } from './parts';

export type {
  ColorValue,
  LengthValue,
  BorderValue,
  FontFamilyValue,
  FontWeightValue,
} from './values';
