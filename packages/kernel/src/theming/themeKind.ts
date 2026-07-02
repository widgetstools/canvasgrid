// Cycle 21e / Task 10 — derive a binary light/dark "kind" for the active
// theme. The kernel has no stored kind: shipped themes signal darkness by
// class-name convention (`cg-theme-quartz-dark`, `cg-theme-high-contrast-dark`),
// `cg-theme-auto` follows the OS preference, and custom themes fall back to
// the relative luminance of the resolved background color.

/** Parse `#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)` into [r,g,b] 0-255.
 *  Returns null for anything else (named colors, hsl — fallback = light). */
function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** True when the color reads as dark (relative luminance < 0.5).
 *  Unparseable colors return false (treat as light — matches the
 *  kernel default theme). */
export function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  // Perceptual luma (ITU-R BT.601) — good enough for a binary split.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/** Resolve the theme kind from the grid root's classList + resolved bg. */
export function resolveThemeKind(
  classList: Iterable<string>,
  resolvedBg: string,
): 'light' | 'dark' {
  let themeClass: string | undefined;
  for (const c of classList) {
    if (c.startsWith('cg-theme-')) { themeClass = c; break; }
  }
  if (themeClass === 'cg-theme-auto') {
    return typeof matchMedia === 'function'
      && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (themeClass !== undefined) {
    return themeClass.endsWith('-dark') ? 'dark' : 'light';
  }
  return isDarkColor(resolvedBg) ? 'dark' : 'light';
}
