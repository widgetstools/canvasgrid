// @cgrid/renderers — shared paint helpers (signatures only; Phase B fills these in).
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md
//   §2.1 (paintUtils.ts scope), §2.2 (painter discipline — no per-paint allocation).
//
// `Gc` is extracted structurally from `CellPainter['paint']`'s first parameter
// rather than importing `CachedContext2D` directly — the latter isn't part of
// kernel's public export surface (only `CellPainter`/`CellPaintConfig` are).
// Type-only; erased at compile time (peer dep, matches format/rules precedent).

import type { CellPainter } from '@cgrid/kernel';
import type { StatusPillStyle } from './palette';

/** The canvas-context type every kernel `CellPainter.paint` receives. */
export type Gc = Parameters<CellPainter['paint']>[0];

/** Catalog §1 aesthetic bar — pill radius 2-4px, 10-11px caps text (§2.6.7). */
export function pill(
  _gc: Gc,
  _x: number,
  _y: number,
  _w: number,
  _h: number,
  _style: StatusPillStyle,
  _text: string,
): void {
  throw new Error('not-yet-implemented: pill() ships in a later cycle-21f task');
}

/** Catalog §3.3 — 8px filled circle used by StatusDot/QuoteQualityDot/TrafficLightCell. */
export function dot(_gc: Gc, _cx: number, _cy: number, _radius: number, _color: string): void {
  throw new Error('not-yet-implemented: dot() ships in a later cycle-21f task');
}

/** Catalog §3.5 — full- or partial-cell horizontal bar used by the bars/gauges category. */
export function miniBar(
  _gc: Gc,
  _x: number,
  _y: number,
  _w: number,
  _h: number,
  _fraction: number,
  _color: string,
): void {
  throw new Error('not-yet-implemented: miniBar() ships in a later cycle-21f task');
}

/** Draws a single styled text fragment; returns the advance width in device px
 *  (composite painters lay out fragments left-to-right using this return value). */
export function fragText(
  _gc: Gc,
  _text: string,
  _x: number,
  _y: number,
  _opts?: { font?: string; color?: string; align?: 'left' | 'right' | 'center' },
): number {
  throw new Error('not-yet-implemented: fragText() ships in a later cycle-21f task');
}

/** Resolves a semantic color key against `palette.ts`'s `SEMANTIC_COLORS`,
 *  honoring a per-column `SemanticColorMap` override when present. */
export function resolveSemanticColor(
  _key: 'positive' | 'negative' | 'warning' | 'info' | 'muted',
  _overrides?: import('./types').SemanticColorMap,
): string {
  throw new Error('not-yet-implemented: resolveSemanticColor() ships in a later cycle-21f task');
}

/**
 * LAB-space color interpolation (§2.6.2 HeatCell default; `curve: 'linear'`
 * opts out to plain RGB lerp). `t` clamped to `[0, 1]`.
 */
export function interpolateLab(_fromHex: string, _toHex: string, _t: number): string {
  throw new Error('not-yet-implemented: interpolateLab() ships in a later cycle-21f task');
}
