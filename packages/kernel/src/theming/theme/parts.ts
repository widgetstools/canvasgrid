/**
 * Example `Part`s demonstrating the shape of a labelled, pluggable theme
 * bundle (see `Part` in `./themeObject` for the full contract). These are
 * intentionally trivial and param-only — a `Part` may also carry `mode` and
 * `css`, but neither is needed to demonstrate the mechanism.
 *
 * `Part` itself is defined in `./themeObject` (not here) to avoid a circular
 * import: a standalone `parts.ts` declaring `Part` would need to import
 * `ThemeMode` from `./themeObject`, while `themeObject.ts` needs `Part` for
 * `CgTheme.withPart`'s signature — colocating `Part` with `CgTheme` breaks
 * that cycle. This module just re-exports the type for convenience and adds
 * concrete instances.
 */

import type { Part } from './themeObject';

export type { Part };

/**
 * A compact-input variant: inputs pick up the grid's border color instead of
 * a dedicated input border, tightening the visual footprint of editors and
 * filter fields without introducing any new color.
 */
export const compactInputs: Part = {
  feature: 'inputStyle',
  params: {
    inputBorderColor: { ref: 'borderColor' },
    inputBackgroundColor: { ref: 'backgroundColor' },
  },
};

/**
 * An accent-tinted input variant: the input border picks up the theme's
 * accent color, echoing the focus ring color even before an input is
 * focused.
 */
export const accentInputs: Part = {
  feature: 'inputStyle',
  params: {
    inputBorderColor: { ref: 'accentColor' },
  },
};
