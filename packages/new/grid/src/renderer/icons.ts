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

import type { CachedContext2D } from './gc';

export type IconName =
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevrons-up-down'
  | 'filter'
  | 'menu'
  | 'group'
  | 'x'
  | 'layout-grid'
  | 'list-filter'
  | 'sigma'
  | 'columns-3'
  | 'sliders-horizontal';

const PATHS: Record<IconName, string> = {
  // Sort ascending
  'chevron-up': 'M18 15l-6-6-6 6',
  // Sort descending
  'chevron-down': 'M6 9l6 6 6-6',
  // Cycle 15 / Task 4 — auto-group column chevron, collapsed state
  // (right-pointing). Lucide `chevron-right` path. Vocabulary continuity
  // with the existing sort chevrons: same stroke / line-cap.
  'chevron-right': 'M9 18l6-6-6-6',
  // Task 10 — column-group header caret, expanded state (left-pointing;
  // click collapses). Lucide `chevron-left` path.
  'chevron-left': 'M15 18l-6-6 6-6',
  // Unsorted indicator (two stacked chevrons)
  'chevrons-up-down': 'M7 15l5 5 5-5 M7 9l5-5 5 5',
  // Filter funnel (catalog filter area, future)
  'filter': 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  // Menu (hamburger)
  'menu': 'M4 6h16 M4 12h16 M4 18h16',
  // Row-group / column-drop icon — indented bars matching AG Grid's
  // `ag-icon-group` (hierarchy / group-by affordance on the top strip
  // and Columns → Row Groups section header).
  'group': 'M4 6h16 M8 12h12 M12 18h8',
  // Close
  'x': 'M18 6L6 18 M6 6l12 12',
  // 2x2 grid — used for the Columns tool-panel sidebar tab (Lucide layout-grid)
  'layout-grid': 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  // Three narrowing bars — used for the Filters tool-panel sidebar tab (Lucide list-filter)
  'list-filter': 'M3 6h18 M7 12h10 M11 18h2',
  // Sigma / summation — used for the Values section header (Lucide sigma)
  'sigma': 'M18 3H6l8 9-8 9h12',
  // Three vertical columns — used for the Column Labels section header
  // (Cycle 18 / Task 5). Lucide `columns-3` path: a frame with two
  // inner vertical dividers (echoes "column headers / pivot labels").
  'columns-3': 'M21 4H3v16h18V4z M15 4v16 M9 4v16',
  // Mixer sliders — used for the Grid Options tool-panel sidebar tab
  // (Cycle 21i / Phase 1). Lucide `sliders-horizontal`.
  'sliders-horizontal':
    'M21 4L14 4 M10 4L3 4 M21 12L12 12 M8 12L3 12 M21 20L16 20 M12 20L3 20 M14 2L14 6 M8 10L8 14 M16 18L16 22',
};

/** Cycle 27 / Task 3 — runtime-registered icons. Layered ON TOP of the
 *  built-in PATHS so users can extend without touching the source map.
 *  `registerIcon` / `registerIcons` add entries; `hasIcon` queries; a
 *  test-only unregister helper drains state between tests. */
const CUSTOM_PATHS = new Map<string, string>();
const cache = new Map<string, Path2D>();

function lookupPath(name: string): string | undefined {
  // Custom registrations win, so users CAN override a built-in by name.
  return CUSTOM_PATHS.get(name) ?? (PATHS as Record<string, string>)[name];
}

function getPath(name: string): Path2D {
  let p = cache.get(name);
  if (!p) {
    const d = lookupPath(name);
    if (d === undefined) throw new Error(`[velocity-grid] unknown icon '${name}'`);
    p = new Path2D(d);
    cache.set(name, p);
  }
  return p;
}

/** Cycle 27 / Task 3 — register a custom icon by name + SVG path data
 *  (the `d` attribute of an SVG `<path>`, in a 24×24 viewBox). Subsequent
 *  `drawIcon(name, ...)` calls render this icon. Custom registrations
 *  win over built-in names. */
export function registerIcon(name: string, path: string): void {
  CUSTOM_PATHS.set(name, path);
  cache.delete(name); // invalidate cached Path2D so the new path takes effect
}

/** Cycle 27 / Task 3 — batch helper for `registerIcon`. Apps can ship
 *  their whole icon set at init time. */
export function registerIcons(map: Record<string, string>): void {
  for (const [name, path] of Object.entries(map)) registerIcon(name, path);
}

/** Cycle 27 / Task 3 — true when an icon (built-in OR custom) is known
 *  for `name`. */
export function hasIcon(name: string): boolean {
  return lookupPath(name) !== undefined;
}

/** Cycle 27 / Task 3 — test-only. Drains a single custom registration.
 *  Not exposed via the public VelocityGrid API. */
export function unregisterIconForTest(name: string): void {
  CUSTOM_PATHS.delete(name);
  cache.delete(name);
}

/**
 * Create an `<svg>` DOM element for `name` sized to `sizePx × sizePx`.
 * Stroke color inherits from CSS `currentColor` so callers don't need to
 * pass a color — the icon picks up the button/label text color automatically.
 * Use for DOM contexts (sidebar tabs, panel section headers) rather than
 * the canvas surface.
 */
export function iconSvg(name: IconName, sizePx = 16): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as SVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(sizePx));
  svg.setAttribute('height', String(sizePx));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.flexShrink = '0';
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.appendChild(path);
  return svg;
}

/**
 * THE canvas icon-drawing primitive, shared by every `gc`-based icon site:
 * byRows' inline cell / header icons and cellDecoratorsPainter's positional
 * decorators. Both used to carry their own copy of this six-line sequence,
 * which is how the decorator path silently missed catalog icons for a while.
 *
 * `left`/`top` anchor the icon's 24×24 box (NOT its center — centered callers
 * pass `cx - size/2`). Caller owns save/restore: every call site already wraps
 * a broader region, and nesting another pair here would change the recorded
 * call sequence the renderer tests lock.
 */
export function strokeIconPath(
  gc: CachedContext2D,
  path: Path2D,
  left: number,
  top: number,
  size: number,
  color: string,
  strokeWidth = 2,
): void {
  gc.translate(left, top);
  const scale = size / 24; // Lucide viewBox is 24×24
  gc.scale(scale, scale);
  gc.cache.strokeStyle = color;
  gc.cache.lineWidth = strokeWidth / scale;
  gc.cache.lineCap = 'round';
  gc.cache.lineJoin = 'round';
  gc.stroke(path);
}

/**
 * THE canvas glyph primitive (emoji / short text label) — the non-Path2D half
 * of the same two icon pipelines. `color` is optional because byRows' inline
 * emoji deliberately inherits the ambient fill (the cell's resolved `fg`,
 * already set by the painter) while a decorator carries its own.
 */
export function fillGlyph(
  gc: CachedContext2D,
  glyph: string,
  cx: number,
  cy: number,
  size: number,
  color?: string,
): void {
  if (color !== undefined) gc.cache.fillStyle = color;
  gc.cache.font = `${size}px sans-serif`;
  gc.cache.textAlign = 'center';
  gc.cache.textBaseline = 'middle';
  gc.fillText(glyph, cx, cy);
}

/**
 * Draw an icon centered at (cx, cy) at the given size in CSS pixels.
 *
 * The 24x24 viewBox is scaled by (size / 24) and translated so the icon's
 * center aligns with (cx, cy).
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName | string,
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
