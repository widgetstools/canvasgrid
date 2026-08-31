/**
 * The title bar's left-to-right order, declared in one place.
 *
 * Order used to be an emergent property of two invisible things:
 *
 *  1. Which slot an extension happened to mount into first. `ShellLayout`
 *     created slot containers lazily, so the default bundle's `primary-right`
 *     buttons created that slot before any `primary-left` item existed — which
 *     put the whole utility cluster to the LEFT of the caption.
 *  2. Where an id first landed in the registry. `ExtensionRegistry.register`
 *     keeps an id's original index when a later spec replaces it, so the title
 *     bar's `settings-launcher` inherited the default bundle's index 0 and
 *     rendered at the head of the cluster no matter where its factory sat in
 *     `titleBarExtensions()`.
 *
 * Neither is visible from an item factory, so the bar re-scrambled whenever the
 * default bundle or a consumer's spec list changed. Items now declare `order`
 * and the shell places them by it; these numbers are the spec.
 *
 * Gaps of 10 leave room to slot a new control in without renumbering.
 */
export const TITLE_BAR_ORDER = {
  // primary-left — caption, then the saved-filter pills.
  brand: 10,
  savedFilters: 20,

  // primary-right — search, alerts, layout selector (with its dirty-aware
  // save), date, the toolbar selector (sliders: Columns / toolbars / theme),
  // and finally the overflow menu.
  search: 10,
  notifications: 20,
  layouts: 30,
  layoutSave: 40,
  date: 50,
  settingsLauncher: 60,
  overflow: 70,
} as const;
