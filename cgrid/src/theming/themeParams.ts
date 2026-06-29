/**
 * Cycle 22 / Task 3 — runtime theme-parameter overrides.
 *
 * Apps tune individual `--cg-*` tokens without writing CSS:
 *
 *   grid.setThemeParams({
 *     '--cg-row-height': '36px',
 *     '--cg-header-bg': '#0f172a',
 *   });
 *
 * Each call writes the variables to the grid root's inline style, so
 * `getComputedStyle` resolves them ahead of the theme class's
 * declarations. A subsequent `cssReader.read()` picks up the new
 * values and a single repaint paints with the new tokens. No worker
 * round-trip; no class swap.
 *
 * `setThemeParams` is additive — keys not in the patch are left
 * alone. Passing an empty string for a key REMOVES the inline
 * override (the token falls back to the active theme's declared
 * value). `getThemeParams()` returns the currently-set overrides,
 * NOT the resolved tokens (use `getComputedStyle(root)` for that).
 */

/** Internal state — keyed by element so multiple grids on the page
 *  each track their own override set. */
const STATE = new WeakMap<HTMLElement, Map<string, string>>();

/** Apply a patch of `--cg-*` overrides to `root`. Returns the merged
 *  override map after the patch has been applied (the same map the
 *  next `getThemeParams(root)` would return). */
export function setThemeParams(
  root: HTMLElement,
  patch: Readonly<Record<string, string>>,
): Record<string, string> {
  const map = STATE.get(root) ?? new Map<string, string>();
  for (const [key, value] of Object.entries(patch)) {
    if (value === '' || value === null || value === undefined) {
      root.style.removeProperty(key);
      map.delete(key);
    } else {
      root.style.setProperty(key, value);
      map.set(key, value);
    }
  }
  STATE.set(root, map);
  return Object.fromEntries(map);
}

/** Read the current override map for `root`. Returns a defensive copy
 *  — mutating it does NOT affect the live overrides on the element. */
export function getThemeParams(root: HTMLElement): Record<string, string> {
  const map = STATE.get(root);
  return map ? Object.fromEntries(map) : {};
}

/** Remove every override managed by this module for `root`. Used by
 *  `CGrid.destroy()` to keep the WeakMap entry's cleanup explicit
 *  (the WeakMap itself will gc when the host element is detached,
 *  but the inline styles linger on the DOM node until removed). */
export function clearThemeParams(root: HTMLElement): void {
  const map = STATE.get(root);
  if (!map) return;
  for (const key of map.keys()) root.style.removeProperty(key);
  STATE.delete(root);
}
