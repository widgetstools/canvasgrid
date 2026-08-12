import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

describe('CssReader', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = `
      --vg-font-family: Inter;
      --vg-font-size: 14px;
      --vg-row-height: 32px;
      --vg-header-height: 36px;
      --vg-fg-color: #111;
      --vg-bg-color: #fff;
      --vg-row-alt-bg: #fafafa;
      --vg-header-bg: #eee;
      --vg-header-fg: #111;
      --vg-border-color: #ccc;
      --vg-grid-line-color: #eee;
      --vg-row-hover-bg: #f5f5f5;
      --vg-row-selected-bg: rgba(0,0,0,0.1);
      --vg-focus-ring-color: #08f;
      --vg-focus-ring-width: 2px;
      --vg-flash-from-color: yellow;
      --vg-flash-to-color: transparent;
      --vg-resizer-hot-zone: 4px;
    `;
    document.body.appendChild(container);
  });

  it('reads tokens into a ResolvedTheme', () => {
    const r = new CssReader(container).read();
    expect(r.fg).toBe('#111');
    expect(r.bg).toBe('#fff');
    expect(r.rowHeight).toBe(32);
    expect(r.headerHeight).toBe(36);
    expect(r.font).toContain('14px');
    expect(r.font).toContain('Inter');
    expect(r.focusRingWidth).toBe(2);
    expect(r.resizerHotZone).toBe(4);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream A (2026-07-06 CSS styling model) — renderer-palette tokens.
// Semantic colors (join pos/neg) + geometry-as-style (bar height, chip
// height/radius), resolved into `ResolvedTheme.rendererPalette` and
// threaded onto every `CellPaintConfig` by `applyCellProps`. Mirrors the
// existing single-scan token-resolution pattern above.
// ───────────────────────────────────────────────────────────────────────
const DEFAULT_STATUS_MAP = {
  WORKING: { bg: '#3b82f61f', fg: '#3b82f6' },
  PART_FILL: { bg: '#f0b4291f', fg: '#f0b429' },
  FILLED: { bg: '#0aa0631f', fg: '#0aa063' },
  CANCELLED: { bg: '#8a8f981f', fg: '#8a8f98' },
  REJECTED: { bg: '#ffffff', fg: '#e63946', border: '#e63946' },
  PENDING: { bg: 'transparent', fg: '#8a8f98', border: '#8a8f98', dashed: true },
};

const DEFAULT_RATING_MAP = {
  AAA: '#0aa063', 'AA+': '#22a866', AA: '#3aae65', 'AA-': '#52b563',
  'A+': '#6bbb60', A: '#83c25d', 'A-': '#9bc859',
  'BBB+': '#b3cf54', BBB: '#c8d24a', 'BBB-': '#dcd53e',
  'BB+': '#f0b429', BB: '#ef9f2a', 'BB-': '#ee8a2c',
  'B+': '#ec762d', B: '#ea612f', 'B-': '#e94d31',
  'CCC+': '#e2434f', CCC: '#dc3b47', 'CCC-': '#d6353f',
  CC: '#c62f38', C: '#b62931', D: '#a6222a',
  NR: '#8a8f98', WD: '#8a8f98',
};

const DEFAULT_VENUE_MAP = {
  XNAS: '#3b82f6', ARCX: '#8b5cf6', BATS: '#14b8a6', EDGX: '#f0b429',
};

describe('CssReader — rendererPalette (Workstream A)', () => {
  let container: HTMLElement;

  afterEach(() => {
    container.remove();
  });

  it('resolves --vg-pos-color/--vg-neg-color/--vg-warning-color/--vg-info-color/--vg-muted-color and --vg-bar-height/--vg-chip-height/--vg-chip-radius', () => {
    container = document.createElement('div');
    container.style.cssText = `
      --vg-pos-color: #00ff00;
      --vg-neg-color: #ff0000;
      --vg-warning-color: #ffaa00;
      --vg-info-color: #0000ff;
      --vg-muted-color: #999999;
      --vg-bar-height: 12px;
      --vg-chip-height: 20px;
      --vg-chip-radius: 6px;
    `;
    document.body.appendChild(container);

    const r = new CssReader(container).read();
    expect(r.rendererPalette).toEqual({
      positive: '#00ff00',
      negative: '#ff0000',
      warning: '#ffaa00',
      info: '#0000ff',
      muted: '#999999',
      barHeight: 12,
      chipHeight: 20,
      chipRadius: 6,
      status: DEFAULT_STATUS_MAP,
      rating: DEFAULT_RATING_MAP,
      venue: DEFAULT_VENUE_MAP,
    });
  });

  it('falls back to the exact SEMANTIC_COLORS / geometry literals when the tokens are absent (defensive, byte-identical)', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    const r = new CssReader(container).read();
    expect(r.rendererPalette).toEqual({
      positive: '#2dd4bf',
      negative: '#fb7185',
      warning: '#f0b429',
      info: '#3b82f6',
      muted: '#8a8f98',
      barHeight: 8,
      chipHeight: 16,
      chipRadius: 3,
      status: DEFAULT_STATUS_MAP,
      rating: DEFAULT_RATING_MAP,
      venue: DEFAULT_VENUE_MAP,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream A, part 2 (2026-07-06 CSS styling model) — status-pill /
// rating-scale / venue structured maps, widening the same rendererPalette
// channel WS-A1 built. `--vg-status-<state>-bg/-fg/-border`,
// `--vg-rating-<grade>-color`, `--vg-venue-<mic>-color`. `dashed` stays a
// code-level structural flag (never sourced from a token).
// ───────────────────────────────────────────────────────────────────────
describe('CssReader — rendererPalette status/rating/venue maps (Workstream A part 2)', () => {
  let container: HTMLElement;

  afterEach(() => {
    container.remove();
  });

  it('resolves representative status/rating/venue tokens (custom overrides)', () => {
    container = document.createElement('div');
    container.style.cssText = `
      --vg-status-working-bg: #123456;
      --vg-status-working-fg: #654321;
      --vg-status-part-fill-bg: #111111;
      --vg-status-rejected-border: #ff00ff;
      --vg-rating-aaa-color: #00ff00;
      --vg-rating-bb-plus-color: #ff9900;
      --vg-rating-nr-color: #101010;
      --vg-venue-xnas-color: #abcdef;
    `;
    document.body.appendChild(container);

    const r = new CssReader(container).read();
    expect(r.rendererPalette.status.WORKING).toEqual({ bg: '#123456', fg: '#654321' });
    expect(r.rendererPalette.status.PART_FILL.bg).toBe('#111111');
    expect(r.rendererPalette.status.REJECTED.border).toBe('#ff00ff');
    // dashed is structural (code), never a token — stays true for PENDING
    // regardless of any color token being declared.
    expect(r.rendererPalette.status.PENDING.dashed).toBe(true);
    expect(r.rendererPalette.rating.AAA).toBe('#00ff00');
    expect(r.rendererPalette.rating['BB+']).toBe('#ff9900');
    expect(r.rendererPalette.rating.NR).toBe('#101010');
    expect(r.rendererPalette.venue.XNAS).toBe('#abcdef');
  });

  it('falls back to the exact STATUS_PILL_MAP / RATING_SCALE_BANDS / DEFAULT_VENUE_PALETTE literals when the tokens are absent (byte-identical)', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    const r = new CssReader(container).read();
    expect(r.rendererPalette.status).toEqual(DEFAULT_STATUS_MAP);
    expect(r.rendererPalette.rating).toEqual(DEFAULT_RATING_MAP);
    expect(Object.keys(r.rendererPalette.rating)).toHaveLength(24);
    expect(r.rendererPalette.venue).toEqual(DEFAULT_VENUE_MAP);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream B (2026-07-06 CSS styling model) — full-vocabulary variant
// parsing. `scanVariantVariables` walks `document.styleSheets`, so these
// tests insert real <style> elements (happy-dom populates `.cssRules`
// for those synchronously) rather than setting inline `style.cssText`
// on the probe container.
// ───────────────────────────────────────────────────────────────────────
describe('CssReader — cellClass / headerClass variant parsing', () => {
  let container: HTMLElement;
  const inserted: HTMLStyleElement[] = [];

  function insertStyle(css: string): void {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    inserted.push(style);
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    for (const s of inserted.splice(0)) s.remove();
    container.remove();
  });

  it('[regression] still parses the original 4 cell slots (bg/fg/font/halign)', () => {
    insertStyle(`
      .vg-grid {
        --vg-cell-class-loss-fg: #e63946;
        --vg-cell-class-loss-bg: rgba(230,57,70,.08);
        --vg-cell-class-loss-font: 600 13px Inter;
        --vg-cell-class-loss-halign: right;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      fg: '#e63946',
      bg: 'rgba(230,57,70,.08)',
      font: '600 13px Inter',
      halign: 'right',
    });
  });

  it('[regression] still parses the original 4 header slots (bg/fg/font/halign)', () => {
    insertStyle(`
      .vg-grid {
        --vg-header-class-hl-fg: #111;
        --vg-header-class-hl-bg: #eee;
        --vg-header-class-hl-font: 700 13px Inter;
        --vg-header-class-hl-halign: center;
      }
    `);
    const { headerClassVariants } = new CssReader(container).read();
    expect(headerClassVariants.get('hl')).toEqual({
      fg: '#111',
      bg: '#eee',
      font: '700 13px Inter',
      halign: 'center',
    });
  });

  it('parses valign', () => {
    insertStyle(`.x { --vg-cell-class-top-valign: top; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('top')).toEqual({ valign: 'top' });
  });

  it('parses font breakouts: font-family, font-size (px), font-weight (numeric), font-style', () => {
    insertStyle(`
      .x {
        --vg-cell-class-hero-font-family: "JetBrains Mono";
        --vg-cell-class-hero-font-size: 15px;
        --vg-cell-class-hero-font-weight: 700;
        --vg-cell-class-hero-font-style: italic;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('hero')).toEqual({
      fontFamily: '"JetBrains Mono"',
      fontSize: 15,
      fontWeight: 700,
      fontStyle: 'italic',
    });
  });

  it('parses font-weight as a CSS keyword', () => {
    insertStyle(`.x { --vg-cell-class-bold-font-weight: bold; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('bold')).toEqual({ fontWeight: 'bold' });
  });

  it('parses text-transform, text-decoration, letter-spacing, line-height', () => {
    insertStyle(`
      .x {
        --vg-cell-class-shout-text-transform: uppercase;
        --vg-cell-class-shout-text-decoration: underline;
        --vg-cell-class-shout-letter-spacing: 0.5px;
        --vg-cell-class-shout-line-height: 1.4;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('shout')).toEqual({
      textTransform: 'uppercase',
      textDecoration: 'underline',
      letterSpacing: 0.5,
      lineHeight: 1.4,
    });
  });

  it('parses a uniform padding number', () => {
    insertStyle(`.x { --vg-cell-class-pad-padding: 8px; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('pad')).toEqual({ padding: 8 });
  });

  it('merges per-side padding with the uniform fallback', () => {
    insertStyle(`
      .x {
        --vg-cell-class-pad2-padding: 4px;
        --vg-cell-class-pad2-padding-left: 12px;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('pad2')).toEqual({
      padding: { top: 4, right: 4, bottom: 4, left: 12 },
    });
  });

  it('assembles a per-side border from discrete width/style/color slots', () => {
    insertStyle(`
      .x {
        --vg-cell-class-loss-border-left-width: 2px;
        --vg-cell-class-loss-border-left-style: dashed;
        --vg-cell-class-loss-border-left-color: #e63946;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      border: { left: { width: 2, style: 'dashed', color: '#e63946' } },
    });
  });

  it('parses a per-side border shorthand in any token order', () => {
    insertStyle(`.x { --vg-cell-class-loss-border-top: solid 2px #e63946; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      border: { top: { style: 'solid', width: 2, color: '#e63946' } },
    });
  });

  it('parses border.all from the -border shorthand and from -border-width/-style/-color', () => {
    insertStyle(`.a { --vg-cell-class-boxed-border: 1px solid #ccc; }`);
    const rA = new CssReader(container).read();
    expect(rA.cellClassVariants.get('boxed')).toEqual({
      border: { all: { width: 1, style: 'solid', color: '#ccc' } },
    });

    insertStyle(`
      .b {
        --vg-cell-class-boxed2-border-width: 1px;
        --vg-cell-class-boxed2-border-style: dotted;
        --vg-cell-class-boxed2-border-color: #999;
      }
    `);
    const rB = new CssReader(container).read();
    expect(rB.cellClassVariants.get('boxed2')).toEqual({
      border: { all: { width: 1, style: 'dotted', color: '#999' } },
    });
  });

  it('parses -icon (+ -icon-color/-icon-size) into content', () => {
    insertStyle(`
      .x {
        --vg-cell-class-flag-icon: warning;
        --vg-cell-class-flag-icon-color: #f59e0b;
        --vg-cell-class-flag-icon-size: 14px;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('flag')).toEqual({
      content: { kind: 'icon', icon: 'warning', color: '#f59e0b', size: 14 },
    });
  });

  it('parses -emoji (+ size) into content', () => {
    insertStyle(`
      .x {
        --vg-cell-class-fire-emoji: "🔥";
        --vg-cell-class-fire-icon-size: 16px;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('fire')).toEqual({
      content: { kind: 'emoji', value: '🔥', size: 16 },
    });
  });

  it('parses -content into a text content override', () => {
    insertStyle(`.x { --vg-cell-class-label-content: "N/A"; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('label')).toEqual({
      content: { kind: 'text', value: 'N/A' },
    });
  });

  it('parses -decorator-tr (+ color/size) into a decorators[] entry at position tr', () => {
    insertStyle(`
      .x {
        --vg-cell-class-loss-decorator-tr: "▼";
        --vg-cell-class-loss-decorator-tr-color: #e63946;
        --vg-cell-class-loss-decorator-tr-size: 10px;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      decorators: [{ position: 'tr', kind: 'emoji', value: '▼', color: '#e63946', size: 10 }],
    });
  });

  it('parses -decorator-<pos>-dot into a dot decorator', () => {
    insertStyle(`.x { --vg-cell-class-status-decorator-bl-dot: #22c55e; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('status')).toEqual({
      decorators: [{ position: 'bl', kind: 'dot', color: '#22c55e' }],
    });
  });

  it('parses a bare (unquoted) decorator value as an icon reference', () => {
    insertStyle(`.x { --vg-cell-class-flag2-decorator-tl: star; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('flag2')).toEqual({
      decorators: [{ position: 'tl', kind: 'icon', icon: 'star' }],
    });
  });

  it('parses the full vocabulary on a header-class variant too', () => {
    insertStyle(`
      .x {
        --vg-header-class-num-halign: right;
        --vg-header-class-num-font-weight: 600;
        --vg-header-class-num-border-bottom: 2px solid #0d9488;
      }
    `);
    const { headerClassVariants } = new CssReader(container).read();
    expect(headerClassVariants.get('num')).toEqual({
      halign: 'right',
      fontWeight: 600,
      border: { bottom: { width: 2, style: 'solid', color: '#0d9488' } },
    });
  });

  it('ignores unknown suffixes (forward-compatible)', () => {
    insertStyle(`
      .x {
        --vg-cell-class-mystery-not-a-real-slot: 42;
        --vg-cell-class-mystery-fg: #123456;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('mystery')).toEqual({ fg: '#123456' });
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream C (2026-07-06 CSS styling model) — token-referenceable
// cellStyle/headerStyle values. `resolveVarRef` resolves `var(--vg-x)` /
// `var(--vg-x, fallback)` / bare `--vg-x` refs through this theme's
// resolved custom properties, memoized per token for the theme's
// lifetime (never a per-cell getComputedStyle cost).
// ───────────────────────────────────────────────────────────────────────
describe('CssReader — resolveVarRef (Workstream C token-referenceable cellStyle)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = `--vg-pos-color: #16a34a;`;
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('resolves var(--vg-x) to the declared token value', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('var(--vg-pos-color)')).toBe('#16a34a');
  });

  it('resolves a bare --vg-x token reference (no var() wrapper)', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('--vg-pos-color')).toBe('#16a34a');
  });

  it('falls back to the var() fallback when the token is undeclared', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('var(--vg-missing, #fff)')).toBe('#fff');
  });

  it('returns the original var() text when undeclared and no fallback given', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('var(--vg-missing)')).toBe('var(--vg-missing)');
  });

  it('leaves a literal hex color unchanged', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('#e63946')).toBe('#e63946');
  });

  it('leaves a literal rgb() color unchanged', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('rgb(230, 57, 70)')).toBe('rgb(230, 57, 70)');
  });

  it('leaves a bare non-var string unchanged', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('bold')).toBe('bold');
  });

  it('memoizes per-token lookups — repeated resolves do not re-call getPropertyValue', () => {
    const theme = new CssReader(container).read();
    const spy = vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue');
    spy.mockClear();
    expect(theme.resolveVarRef!('var(--vg-pos-color)')).toBe('#16a34a');
    expect(theme.resolveVarRef!('var(--vg-pos-color)')).toBe('#16a34a');
    expect(theme.resolveVarRef!('var(--vg-pos-color, #000)')).toBe('#16a34a');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('theme swap (read() called again) clears the memo — re-resolve reflects the new token value', () => {
    const reader = new CssReader(container);
    const themeA = reader.read();
    expect(themeA.resolveVarRef!('var(--vg-pos-color)')).toBe('#16a34a');

    container.style.cssText = `--vg-pos-color: #22c55e;`;
    const themeB = reader.read();
    expect(themeB.resolveVarRef!('var(--vg-pos-color)')).toBe('#22c55e');
    // The old ResolvedTheme's own resolver closed over its own (pre-swap)
    // memo/computed-style snapshot — it keeps reading the value valid at
    // the time it was produced, it doesn't retroactively pick up the swap.
    expect(themeA.resolveVarRef!('var(--vg-pos-color)')).toBe('#16a34a');
  });
});
