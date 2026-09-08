// @wellsfargo-starui/velocity-grid-ext/renderers — shared paint helpers.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md
//   §2.1 (paintUtils.ts scope), §2.2 (painter discipline — no per-paint allocation).
//
// `Gc` is extracted structurally from `CellPainter['paint']`'s first parameter
// rather than importing `CachedContext2D` directly — the latter isn't part of
// kernel's public export surface (only `CellPainter`/`CellPaintConfig` are).
// Type-only; erased at compile time (peer dep, matches format/rules precedent).

import type { CellPainter, CellPaintConfig } from '@wellsfargo-starui/velocity-grid';
import {
  applyLetterSpacing, paintCellBorders, paintCellDecorators, paintTextDecoration,
} from '@wellsfargo-starui/velocity-grid';

/** The canvas-context type every kernel `CellPainter.paint` receives. */
export type Gc = Parameters<CellPainter['paint']>[0];

// ─── Color utilities ─────────────────────────────────────────────────────────

/**
 * Converts a 6-digit hex color + alpha to a CSS `rgba(...)` string.
 * Consolidates the duplicated per-file helper in
 * `packages/kernel/src/renderer/cellRenderers/sparkline/{areaSparkline,pieSparkline}.ts`.
 */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Linear sRGB byte mix. `t` is clamped to `[0, 1]`. Returns `#rrggbb`.
 */
export function mixHex(a: string, b: string, t: number): string {
  const tc = Math.max(0, Math.min(1, t));
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * tc);
  const g = Math.round(ag + (bg - ag) * tc);
  const bl = Math.round(ab + (bb - ab) * tc);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

// ─── Lab interpolation internals ─────────────────────────────────────────────
// sRGB → CIE-Lab (D65, standard piecewise gamma + f(t) cube-root/linear branch
// at (6/29)^3) → lerp L*a*b* → Lab → sRGB.

/** D65 white point XYZ reference. */
const XN = 0.9504559;
const YN = 1.0;
const ZN = 1.0890578;

const DELTA = 6 / 29; // 0.2068966…
const DELTA3 = DELTA * DELTA * DELTA; // (6/29)^3 ≈ 0.008856

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** sRGB-channel to CIE linear-RGB then to XYZ (D65). */
function hexToXyz(hex: string): [number, number, number] {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

/** CIE Lab f() piecewise function (cube-root / linear branch). */
function labF(t: number): number {
  return t > DELTA3 ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29;
}

/** Inverse of labF. */
function labFInv(t: number): number {
  return t > DELTA ? t * t * t : 3 * DELTA * DELTA * (t - 4 / 29);
}

function xyzToLab(X: number, Y: number, Z: number): [number, number, number] {
  const fx = labF(X / XN);
  const fy = labF(Y / YN);
  const fz = labF(Z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToHex(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116;
  const X = XN * labFInv(a / 500 + fy);
  const Y = YN * labFInv(fy);
  const Z = ZN * labFInv(fy - b / 200);
  const lr = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const lg = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const lb = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const ri = Math.round(linearToSrgb(lr) * 255);
  const gi = Math.round(linearToSrgb(lg) * 255);
  const bi = Math.round(linearToSrgb(lb) * 255);
  return `#${ri.toString(16).padStart(2, '0')}${gi.toString(16).padStart(2, '0')}${bi.toString(16).padStart(2, '0')}`;
}

/**
 * LAB-space color interpolation (§2.6.2 HeatCell default).
 *
 * `curve:'lab'` (default): sRGB → CIE-Lab (D65) → lerp L*a*b* → Lab → sRGB.
 * `curve:'linear'`: lerps sRGB bytes directly (§2.6.2 opt-out, matches `mixHex`).
 * `t` is clamped to `[0, 1]`.
 */
export function labInterpolate(
  a: string,
  b: string,
  t: number,
  curve?: 'lab' | 'linear',
): string {
  const tc = Math.max(0, Math.min(1, t));
  if (curve === 'linear') return mixHex(a, b, tc);

  const [Xa, Ya, Za] = hexToXyz(a);
  const [Xb, Yb, Zb] = hexToXyz(b);
  const [La, aa, ba] = xyzToLab(Xa, Ya, Za);
  const [Lb, ab_, bb] = xyzToLab(Xb, Yb, Zb);

  const L = La + (Lb - La) * tc;
  const labA = aa + (ab_ - aa) * tc;
  const labB = ba + (bb - ba) * tc;
  return labToHex(L, labA, labB);
}

// ─── Primitive painters ───────────────────────────────────────────────────────

/**
 * Draws a rounded-rectangle pill shape.
 * Manual path via `beginPath` → `moveTo` → 4×`arcTo` corners → `closePath`
 * → `fill()`, then `stroke()` iff `border` is provided.
 * Does NOT use `CanvasRenderingContext2D.roundRect` (unavailable in fake-gc
 * harness and some targets), following existing sparkline-file precedent of
 * hand-built paths.
 */
export function pill(
  gc: Gc,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
  border?: string,
): void {
  gc.cache.fillStyle = fill;
  gc.beginPath();
  gc.moveTo(x + radius, y);
  gc.arcTo(x + w, y, x + w, y + h, radius);
  gc.arcTo(x + w, y + h, x, y + h, radius);
  gc.arcTo(x, y + h, x, y, radius);
  gc.arcTo(x, y, x + w, y, radius);
  gc.closePath();
  gc.fill();
  if (border !== undefined) {
    gc.cache.strokeStyle = border;
    gc.stroke();
  }
}

/**
 * Draws a filled circle. Catalog §3.3 — 8px filled circle used by
 * StatusDot/QuoteQualityDot/TrafficLightCell.
 */
export function dot(gc: Gc, cx: number, cy: number, r: number, color: string): void {
  gc.cache.fillStyle = color;
  gc.beginPath();
  gc.arc(cx, cy, r, 0, Math.PI * 2);
  gc.fill();
}

/**
 * Draws a full- or partial-cell horizontal bar. Catalog §3.5.
 *
 * Optional `trackColor` renders a full-width background bar first. The fill
 * bar is sized to `w * clamp(frac, 0, 1)`; if that width is zero, no fill
 * rect is emitted.
 */
export function miniBar(
  gc: Gc,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  fillColor: string,
  trackColor?: string,
): void {
  if (trackColor !== undefined) {
    gc.cache.fillStyle = trackColor;
    gc.fillRect(x, y, w, h);
  }
  const fillW = w * Math.max(0, Math.min(1, frac));
  if (fillW > 0) {
    gc.cache.fillStyle = fillColor;
    gc.fillRect(x, y, fillW, h);
  }
}

/**
 * Draws a single styled text fragment.
 *
 * Sets `font`/`fillStyle`/`textAlign` via `gc.cache`, then calls `fillText`.
 * When `maxWidth` is given and `gc.measureText(text).width` exceeds it,
 * truncates character-by-character from the end and appends `…`, mirroring
 * the ellipsis algorithm at
 * `packages/kernel/src/renderer/cellRenderers/composite.ts:106-145`.
 */
export function fragText(
  gc: Gc,
  text: string,
  x: number,
  y: number,
  opts?: { font?: string; color?: string; align?: CanvasTextAlign; maxWidth?: number },
): void {
  if (opts?.font !== undefined) gc.cache.font = opts.font;
  if (opts?.color !== undefined) gc.cache.fillStyle = opts.color;
  if (opts?.align !== undefined) gc.cache.textAlign = opts.align;

  let display = text;
  if (opts?.maxWidth !== undefined && gc.measureText(text).width > opts.maxWidth) {
    // Mirror composite.ts:106-145 ellipsis loop: trim from end until the
    // text + ellipsis glyph fits within maxWidth.
    let truncated = text;
    while (truncated.length > 0 && gc.measureText(truncated + '…').width > opts.maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    display = truncated + '…';
  }

  gc.fillText(display, x, y);
}

// ─── Cell-config passes every renderer owes the caller ───────────────────────
//
// A renderer decides how a value LOOKS; it does not get to decide which parts
// of the column's configuration apply. Every renderer in this catalog used to
// drop several: underline and strike-through, letter spacing, per-cell borders
// and decorator overlays were all painted by the kernel's built-in cells and by
// none of these. The symptom was narrow and baffling — formatting-toolbar
// buttons that worked on text columns and did nothing on numeric ones, because
// `number` is the one renderer here that REPLACES a kernel default and so is
// used by every numeric column automatically.
//
// The passes below are shared so that stays fixed. `paintCellChrome` runs from
// the bridge for every renderer; `paintValueText` is for the renderers whose
// output is a single value string, where the decoration line needs the text's
// own extents.

/** Reused so the per-paint no-allocation discipline (§2.2) holds. Only the
 *  five fields `paintTextDecoration` reads are ever set. */
const decoScratch = {
  textDecoration: undefined as CellPaintConfig['textDecoration'],
  valueFormatted: '',
  halign: 'left' as CellPaintConfig['halign'],
  fg: '',
  font: '',
} as unknown as CellPaintConfig;

/**
 * Draw a cell's primary value, then the decoration the column asked for.
 *
 * `align` is passed rather than read from `p` because a renderer may lay text
 * out somewhere the column's own alignment does not describe; the decoration
 * has to follow the text that was actually drawn.
 *
 * WHICH draws go through here: the one that renders the cell's VALUE. Not axis
 * labels on a chart, not the min/max endpoints of a scale, not per-segment
 * labels inside a cluster, not the letter on an action button — underlining a
 * chart's axis because the column asked for underlined text would be wrong,
 * and a multi-fragment composite has no single value for a line to sit under.
 * `fragText` stays the plain draw for all of those.
 */
export function paintValueText(
  gc: Gc,
  p: CellPaintConfig,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
): void {
  gc.cache.textAlign = align;
  gc.fillText(text, x, y);
  if (!p.textDecoration || p.textDecoration === 'none' || !text) return;
  decoScratch.textDecoration = p.textDecoration;
  decoScratch.valueFormatted = text;
  decoScratch.halign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
  decoScratch.fg = gc.cache.fillStyle as string;
  decoScratch.font = gc.cache.font as string;
  paintTextDecoration(gc as never, decoScratch, x, y);
}

/** Letter spacing, applied before a renderer draws anything. */
export function applyCellTextSpacing(gc: Gc, p: CellPaintConfig): void {
  applyLetterSpacing(gc as never, p);
}

/** Per-cell borders and decorator overlays, applied after a renderer draws.
 *  Both are column configuration, not renderer business. */
export function paintCellChrome(gc: Gc, p: CellPaintConfig): void {
  if (p.border) paintCellBorders(gc as never, p.bounds, p.border);
  if (p.decorators && p.decorators.length > 0) {
    paintCellDecorators(gc as never, p.bounds, p.decorators);
  }
}

/**
 * The cell-change flash tint.
 *
 * Painted BEFORE the renderer draws, which is where the kernel puts it — its
 * built-in cells fill it as part of the background, so the tint sits behind the
 * glyphs rather than washing over them.
 *
 * Exactly one renderer in this catalog used to paint it (`price`), which meant
 * `enableCellChangeFlash` worked on text columns — those keep the kernel's own
 * cell — and did nothing on the numeric ones, because `number` REPLACES that
 * kernel default. Flashing appeared to work inconsistently across columns for
 * no reason a reader could see.
 *
 * `flashFromColor` already carries the DIRECTIONAL tone where the theme
 * declares `--vg-flash-up-*` / `--vg-flash-down-*`: the kernel's flash registry
 * resolves up/down per cell and threads the result here. That supersedes the
 * per-renderer directional tint `price` used to compute for itself, and applies
 * to every column rather than one.
 */
export function paintCellFlash(gc: Gc, p: CellPaintConfig): void {
  if (!p.flashAlpha || p.flashAlpha > 1 || p.flashAlpha <= 0) return;
  gc.cache.save();
  gc.cache.globalAlpha = p.flashAlpha;
  gc.cache.fillStyle = p.flashFromColor ?? '#fef3c7';
  gc.fillRect(p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h);
  gc.cache.restore();
}
