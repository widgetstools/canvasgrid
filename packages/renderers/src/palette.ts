// @cgrid/renderers — palette data.
// Authoritative references:
//   docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md
//     §2.6.6 (structure glyph map), §2.6.7 (palette defaults)
//   docs/superpowers/plans/2026-07-01-canvasgrid-cell-renderer-catalog.md
//     §1 (aesthetic bar — semantic hexes), §3.3 (StructureIconStrip),
//     §3.4 (StatusPill, RatingBadge, VenueChip)
//
// Every table here is plain, `structuredClone`-safe data (strings/numbers/
// booleans only — no functions, Map/Set, or Date) so it can be threaded
// through worker postMessage boundaries and cloned freely by callers.
// Renderers resolve these as DEFAULTS; every params interface in types.ts
// exposes an override field (`colors`, `venueColors`, `statusColors`,
// `glyphOverrides`) so a column config always wins over the palette.

import type { SemanticColorMap, StructureGlyphKey } from './types';
import { withAlpha } from './paintUtils';

/**
 * Catalog §1 aesthetic bar — the four semantic hexes reserved for signal
 * (80% of a professional blotter stays muted gray; these are the 20%).
 */
export const SEMANTIC_COLORS: Readonly<Required<SemanticColorMap>> = {
  positive: '#0aa063',
  negative: '#e63946',
  warning: '#f0b429',
  info: '#3b82f6',
  muted: '#8a8f98',
};

/**
 * Cycle 21f §2.6.6 — StructureIconStrip's fixed-income feature glyph map
 * (Lucide icon names). Params-overridable per column via `glyphOverrides`.
 */
export const STRUCTURE_GLYPH_MAP: Readonly<Record<StructureGlyphKey, string>> = {
  callable: 'bell-ring',
  puttable: 'corner-down-left',
  sinker: 'anchor',
  floater: 'waves',
  'step-up': 'trending-up',
  'make-whole': 'shield-check',
};

/** A single StatusPill visual — catalog §3.4 StatusPill. */
export interface StatusPillStyle {
  bg: string;
  fg: string;
  border?: string;
  dashed?: boolean;
}

/**
 * Catalog §3.4 StatusPill — canonical order/state → visual. Keys use
 * underscores (not the catalog's display spaces) so they're valid object
 * keys and valid `status` param values (`'PART_FILL'`, not `'PART FILL'`).
 */
export const STATUS_PILL_MAP: Readonly<Record<string, StatusPillStyle>> = {
  WORKING: { bg: '#3b82f61f', fg: '#3b82f6' },
  PART_FILL: { bg: '#f0b4291f', fg: '#f0b429' },
  FILLED: { bg: '#0aa0631f', fg: '#0aa063' },
  CANCELLED: { bg: '#8a8f981f', fg: '#8a8f98' },
  REJECTED: { bg: '#ffffff', fg: '#e63946', border: '#e63946' },
  PENDING: { bg: 'transparent', fg: '#8a8f98', border: '#8a8f98', dashed: true },
};

/** A single RatingBadge band — catalog §3.4 RatingBadge. */
export interface RatingBand {
  grade: string;
  color: string;
  tier: 'ig' | 'hy' | 'nr';
}

/**
 * Catalog §3.4 RatingBadge — S&P-style grade ladder, AAA green → D red.
 * IG/HY split at BBB-/Baa3 (`tier: 'ig'` through BBB-, `'hy'` from BB+ down);
 * NR/WD render muted grey (`tier: 'nr'`) regardless of position in the ladder.
 */
export const RATING_SCALE_BANDS: readonly RatingBand[] = [
  { grade: 'AAA', color: '#0aa063', tier: 'ig' },
  { grade: 'AA+', color: '#22a866', tier: 'ig' },
  { grade: 'AA', color: '#3aae65', tier: 'ig' },
  { grade: 'AA-', color: '#52b563', tier: 'ig' },
  { grade: 'A+', color: '#6bbb60', tier: 'ig' },
  { grade: 'A', color: '#83c25d', tier: 'ig' },
  { grade: 'A-', color: '#9bc859', tier: 'ig' },
  { grade: 'BBB+', color: '#b3cf54', tier: 'ig' },
  { grade: 'BBB', color: '#c8d24a', tier: 'ig' },
  { grade: 'BBB-', color: '#dcd53e', tier: 'ig' },
  { grade: 'BB+', color: '#f0b429', tier: 'hy' },
  { grade: 'BB', color: '#ef9f2a', tier: 'hy' },
  { grade: 'BB-', color: '#ee8a2c', tier: 'hy' },
  { grade: 'B+', color: '#ec762d', tier: 'hy' },
  { grade: 'B', color: '#ea612f', tier: 'hy' },
  { grade: 'B-', color: '#e94d31', tier: 'hy' },
  { grade: 'CCC+', color: '#e2434f', tier: 'hy' },
  { grade: 'CCC', color: '#dc3b47', tier: 'hy' },
  { grade: 'CCC-', color: '#d6353f', tier: 'hy' },
  { grade: 'CC', color: '#c62f38', tier: 'hy' },
  { grade: 'C', color: '#b62931', tier: 'hy' },
  { grade: 'D', color: '#a6222a', tier: 'hy' },
  { grade: 'NR', color: '#8a8f98', tier: 'nr' },
  { grade: 'WD', color: '#8a8f98', tier: 'nr' },
] as const;

/**
 * Catalog §3.4 VenueChip — default MIC → color. Params-overridable per
 * column via `venueColors`.
 */
export const DEFAULT_VENUE_PALETTE: Readonly<Record<string, string>> = {
  XNAS: '#3b82f6',
  ARCX: '#8b5cf6',
  BATS: '#14b8a6',
  EDGX: '#f0b429',
};

// ─── Theme-aware palette functions ────────────────────────────────────────────

/**
 * Returns the catalog §1 semantic color tokens verbatim. The same hex values
 * are used in both light and dark themes — the catalog does not differentiate
 * by theme for the four signal hexes or the muted gray.
 */
export function resolveSemanticColors(): {
  positive: string;
  negative: string;
  warning: string;
  info: string;
  muted: string;
} {
  return { ...SEMANTIC_COLORS };
}

/**
 * Theme-aware alpha adjustment.
 *
 * Dark surfaces read lower-contrast at equal alpha, so dark mode multiplies
 * the base alpha by a fixed `1.4` factor clamped to `1`. Light mode returns
 * the alpha unchanged. This is a palette.ts design rule (not a catalog mandate)
 * so it can be unit-tested independently of any renderer.
 */
export function withThemeAlpha(alpha: number, themeKind: 'light' | 'dark'): number {
  if (themeKind === 'dark') {
    return Math.min(1, alpha * 1.4);
  }
  return alpha;
}

/**
 * Resolves a status key to visual `{ bg, fg, border? }` for the given theme.
 *
 * Built from `statusMap` (Workstream A, part 2 — defaults to the
 * catalog-fixed `STATUS_PILL_MAP` const, but callers thread
 * `p.palette.status` here first so the base colors come from CSS tokens
 * when a theme declares them). For status keys whose `bg` encodes alpha in
 * an 8-digit hex (`#rrggbbaa`), applies `withThemeAlpha` to the embedded
 * alpha so dark-theme pills read at higher contrast. The `fg` hue is never
 * modified across themes.
 */
export function resolvePillColors(
  status: string,
  themeKind: 'light' | 'dark',
  statusMap: Readonly<Record<string, StatusPillStyle>> = STATUS_PILL_MAP,
): { bg: string; fg: string; border?: string } {
  const style = statusMap[status];
  if (style === undefined) {
    return { bg: 'transparent', fg: SEMANTIC_COLORS.muted };
  }

  const rawBg = style.bg;
  let bg: string;

  if (rawBg === 'transparent') {
    bg = 'transparent';
  } else if (rawBg.startsWith('#') && rawBg.length === 9) {
    // 8-digit hex: #rrggbbaa — extract base color and embedded alpha
    const hex6 = rawBg.slice(0, 7);
    const rawAlpha = parseInt(rawBg.slice(7), 16) / 255;
    const alpha = withThemeAlpha(rawAlpha, themeKind);
    bg = withAlpha(hex6, alpha);
  } else {
    // Plain 6-digit hex or special value: pass through unchanged
    bg = rawBg;
  }

  const result: { bg: string; fg: string; border?: string } = { bg, fg: style.fg };
  if (style.border !== undefined) result.border = style.border;
  return result;
}
