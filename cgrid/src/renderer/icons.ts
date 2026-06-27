/**
 * Lucide icon paths, redrawn as canvas Path2D objects.
 *
 * Each icon is a Lucide SVG path string in a 24x24 viewBox. `drawIcon` scales
 * and translates so the icon paints at the requested (x, y, size) with the
 * configured stroke color and width.
 *
 * Why redraw the paths inline rather than importing `lucide`:
 *  - cgrid is vanilla TS + no DOM nodes per cell. Lucide ships React/SVG by default.
 *  - Hardcoding the small set of paths the renderer actually needs keeps the
 *    library zero-dep and the bundle small.
 *
 * To add another icon: copy its `<path d="…">` from lucide.dev and add a
 * `new Path2D(d)` entry below.
 */

export type IconName =
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevrons-up-down'
  | 'filter'
  | 'menu'
  | 'x';

const PATHS: Record<IconName, string> = {
  // Sort ascending
  'chevron-up': 'M18 15l-6-6-6 6',
  // Sort descending
  'chevron-down': 'M6 9l6 6 6-6',
  // Cycle 15 / Task 4 — auto-group column chevron, collapsed state
  // (right-pointing). Lucide `chevron-right` path. Vocabulary continuity
  // with the existing sort chevrons: same stroke / line-cap.
  'chevron-right': 'M9 18l6-6-6-6',
  // Unsorted indicator (two stacked chevrons)
  'chevrons-up-down': 'M7 15l5 5 5-5 M7 9l5-5 5 5',
  // Filter funnel (catalog filter area, future)
  'filter': 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  // Menu (hamburger)
  'menu': 'M4 6h16 M4 12h16 M4 18h16',
  // Close
  'x': 'M18 6L6 18 M6 6l12 12',
};

const cache = new Map<IconName, Path2D>();

function getPath(name: IconName): Path2D {
  let p = cache.get(name);
  if (!p) { p = new Path2D(PATHS[name]); cache.set(name, p); }
  return p;
}

/**
 * Draw an icon centered at (cx, cy) at the given size in CSS pixels.
 *
 * The 24x24 viewBox is scaled by (size / 24) and translated so the icon's
 * center aligns with (cx, cy).
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  opts: { color: string; strokeWidth?: number } = { color: 'currentColor' },
): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = (opts.strokeWidth ?? 2) / scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(getPath(name));
  ctx.restore();
}
