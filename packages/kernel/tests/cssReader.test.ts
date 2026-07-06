import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

describe('CssReader', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = `
      --cg-font-family: Inter;
      --cg-font-size: 14px;
      --cg-row-height: 32px;
      --cg-header-height: 36px;
      --cg-fg-color: #111;
      --cg-bg-color: #fff;
      --cg-row-alt-bg: #fafafa;
      --cg-header-bg: #eee;
      --cg-header-fg: #111;
      --cg-border-color: #ccc;
      --cg-grid-line-color: #eee;
      --cg-row-hover-bg: #f5f5f5;
      --cg-row-selected-bg: rgba(0,0,0,0.1);
      --cg-focus-ring-color: #08f;
      --cg-focus-ring-width: 2px;
      --cg-flash-from-color: yellow;
      --cg-flash-to-color: transparent;
      --cg-resizer-hot-zone: 4px;
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
      .cg-grid {
        --cg-cell-class-loss-fg: #e63946;
        --cg-cell-class-loss-bg: rgba(230,57,70,.08);
        --cg-cell-class-loss-font: 600 13px Inter;
        --cg-cell-class-loss-halign: right;
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
      .cg-grid {
        --cg-header-class-hl-fg: #111;
        --cg-header-class-hl-bg: #eee;
        --cg-header-class-hl-font: 700 13px Inter;
        --cg-header-class-hl-halign: center;
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
    insertStyle(`.x { --cg-cell-class-top-valign: top; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('top')).toEqual({ valign: 'top' });
  });

  it('parses font breakouts: font-family, font-size (px), font-weight (numeric), font-style', () => {
    insertStyle(`
      .x {
        --cg-cell-class-hero-font-family: "JetBrains Mono";
        --cg-cell-class-hero-font-size: 15px;
        --cg-cell-class-hero-font-weight: 700;
        --cg-cell-class-hero-font-style: italic;
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
    insertStyle(`.x { --cg-cell-class-bold-font-weight: bold; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('bold')).toEqual({ fontWeight: 'bold' });
  });

  it('parses text-transform, text-decoration, letter-spacing, line-height', () => {
    insertStyle(`
      .x {
        --cg-cell-class-shout-text-transform: uppercase;
        --cg-cell-class-shout-text-decoration: underline;
        --cg-cell-class-shout-letter-spacing: 0.5px;
        --cg-cell-class-shout-line-height: 1.4;
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
    insertStyle(`.x { --cg-cell-class-pad-padding: 8px; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('pad')).toEqual({ padding: 8 });
  });

  it('merges per-side padding with the uniform fallback', () => {
    insertStyle(`
      .x {
        --cg-cell-class-pad2-padding: 4px;
        --cg-cell-class-pad2-padding-left: 12px;
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
        --cg-cell-class-loss-border-left-width: 2px;
        --cg-cell-class-loss-border-left-style: dashed;
        --cg-cell-class-loss-border-left-color: #e63946;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      border: { left: { width: 2, style: 'dashed', color: '#e63946' } },
    });
  });

  it('parses a per-side border shorthand in any token order', () => {
    insertStyle(`.x { --cg-cell-class-loss-border-top: solid 2px #e63946; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      border: { top: { style: 'solid', width: 2, color: '#e63946' } },
    });
  });

  it('parses border.all from the -border shorthand and from -border-width/-style/-color', () => {
    insertStyle(`.a { --cg-cell-class-boxed-border: 1px solid #ccc; }`);
    const rA = new CssReader(container).read();
    expect(rA.cellClassVariants.get('boxed')).toEqual({
      border: { all: { width: 1, style: 'solid', color: '#ccc' } },
    });

    insertStyle(`
      .b {
        --cg-cell-class-boxed2-border-width: 1px;
        --cg-cell-class-boxed2-border-style: dotted;
        --cg-cell-class-boxed2-border-color: #999;
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
        --cg-cell-class-flag-icon: warning;
        --cg-cell-class-flag-icon-color: #f59e0b;
        --cg-cell-class-flag-icon-size: 14px;
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
        --cg-cell-class-fire-emoji: "🔥";
        --cg-cell-class-fire-icon-size: 16px;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('fire')).toEqual({
      content: { kind: 'emoji', value: '🔥', size: 16 },
    });
  });

  it('parses -content into a text content override', () => {
    insertStyle(`.x { --cg-cell-class-label-content: "N/A"; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('label')).toEqual({
      content: { kind: 'text', value: 'N/A' },
    });
  });

  it('parses -decorator-tr (+ color/size) into a decorators[] entry at position tr', () => {
    insertStyle(`
      .x {
        --cg-cell-class-loss-decorator-tr: "▼";
        --cg-cell-class-loss-decorator-tr-color: #e63946;
        --cg-cell-class-loss-decorator-tr-size: 10px;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('loss')).toEqual({
      decorators: [{ position: 'tr', kind: 'emoji', value: '▼', color: '#e63946', size: 10 }],
    });
  });

  it('parses -decorator-<pos>-dot into a dot decorator', () => {
    insertStyle(`.x { --cg-cell-class-status-decorator-bl-dot: #22c55e; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('status')).toEqual({
      decorators: [{ position: 'bl', kind: 'dot', color: '#22c55e' }],
    });
  });

  it('parses a bare (unquoted) decorator value as an icon reference', () => {
    insertStyle(`.x { --cg-cell-class-flag2-decorator-tl: star; }`);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('flag2')).toEqual({
      decorators: [{ position: 'tl', kind: 'icon', icon: 'star' }],
    });
  });

  it('parses the full vocabulary on a header-class variant too', () => {
    insertStyle(`
      .x {
        --cg-header-class-num-halign: right;
        --cg-header-class-num-font-weight: 600;
        --cg-header-class-num-border-bottom: 2px solid #0d9488;
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
        --cg-cell-class-mystery-not-a-real-slot: 42;
        --cg-cell-class-mystery-fg: #123456;
      }
    `);
    const { cellClassVariants } = new CssReader(container).read();
    expect(cellClassVariants.get('mystery')).toEqual({ fg: '#123456' });
  });
});

// ───────────────────────────────────────────────────────────────────────
// Workstream C (2026-07-06 CSS styling model) — token-referenceable
// cellStyle/headerStyle values. `resolveVarRef` resolves `var(--cg-x)` /
// `var(--cg-x, fallback)` / bare `--cg-x` refs through this theme's
// resolved custom properties, memoized per token for the theme's
// lifetime (never a per-cell getComputedStyle cost).
// ───────────────────────────────────────────────────────────────────────
describe('CssReader — resolveVarRef (Workstream C token-referenceable cellStyle)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.cssText = `--cg-pos-color: #16a34a;`;
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('resolves var(--cg-x) to the declared token value', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('var(--cg-pos-color)')).toBe('#16a34a');
  });

  it('resolves a bare --cg-x token reference (no var() wrapper)', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('--cg-pos-color')).toBe('#16a34a');
  });

  it('falls back to the var() fallback when the token is undeclared', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('var(--cg-missing, #fff)')).toBe('#fff');
  });

  it('returns the original var() text when undeclared and no fallback given', () => {
    const theme = new CssReader(container).read();
    expect(theme.resolveVarRef!('var(--cg-missing)')).toBe('var(--cg-missing)');
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
    expect(theme.resolveVarRef!('var(--cg-pos-color)')).toBe('#16a34a');
    expect(theme.resolveVarRef!('var(--cg-pos-color)')).toBe('#16a34a');
    expect(theme.resolveVarRef!('var(--cg-pos-color, #000)')).toBe('#16a34a');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('theme swap (read() called again) clears the memo — re-resolve reflects the new token value', () => {
    const reader = new CssReader(container);
    const themeA = reader.read();
    expect(themeA.resolveVarRef!('var(--cg-pos-color)')).toBe('#16a34a');

    container.style.cssText = `--cg-pos-color: #22c55e;`;
    const themeB = reader.read();
    expect(themeB.resolveVarRef!('var(--cg-pos-color)')).toBe('#22c55e');
    // The old ResolvedTheme's own resolver closed over its own (pre-swap)
    // memo/computed-style snapshot — it keeps reading the value valid at
    // the time it was produced, it doesn't retroactively pick up the swap.
    expect(themeA.resolveVarRef!('var(--cg-pos-color)')).toBe('#16a34a');
  });
});
