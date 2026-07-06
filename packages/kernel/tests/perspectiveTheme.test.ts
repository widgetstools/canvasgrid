// Perspective-inspired look & feel — Foundation (surface #1).
// A theme is pure CSS (dark inferred from the `-dark` suffix; cssReader reads
// tokens generically), so this pins the token CONTRACT in tokens.css + the
// dark/light kind inference. No kernel logic changed.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveThemeKind } from '../src/theming/themeKind';

// The kernel suite runs with cwd = packages/kernel; fall back to the repo-root
// path so the test is robust to where vitest is launched from.
const cwdPath = resolve(process.cwd(), 'src/theming/tokens.css');
const cssPath = existsSync(cwdPath)
  ? cwdPath
  : resolve(process.cwd(), 'packages/kernel/src/theming/tokens.css');
const css = readFileSync(cssPath, 'utf8');

/** Body of the STANDALONE theme block — the occurrence of `<selector> {` whose
 *  body carries the token set (has `--cg-font-size`), not the grouped
 *  `background-color` seam that shares the same selector. */
function themeBlock(selector: string): string {
  let idx = -1;
  while ((idx = css.indexOf(`${selector} {`, idx + 1)) !== -1) {
    const body = css.slice(idx, css.indexOf('\n}', idx));
    if (body.includes('--cg-font-size')) return body;
  }
  return '';
}

describe('cg-theme-perspective foundation', () => {
  it('declares both theme blocks', () => {
    expect(themeBlock('.cg-theme-perspective-dark')).not.toBe('');
    expect(themeBlock('.cg-theme-perspective')).not.toBe('');
  });

  it('dark block: near-black bg, all-mono type, reserved sign tokens', () => {
    const dark = themeBlock('.cg-theme-perspective-dark');
    expect(dark).toMatch(/--cg-bg-color:\s*#16181d/i);
    // headers/chrome font is the MONO stack (not Inter) — all-mono like Perspective
    expect(dark).toMatch(/--cg-font-family:\s*'JetBrains Mono'/);
    expect(dark).toMatch(/--cg-cell-font-family:\s*'JetBrains Mono'/);
    // sign-color tokens reserved for surface #3
    expect(dark).toMatch(/--cg-pos-color:\s*#6aa9e0/i);
    expect(dark).toMatch(/--cg-neg-color:\s*#e0876a/i);
    // dense rows + compact type
    expect(dark).toMatch(/--cg-row-height:\s*24px/);
  });

  it('is registered on the shared background-color + .cg-canvas seams', () => {
    expect(css).toContain('.cg-theme-perspective-dark .cg-canvas');
    expect(css).toContain('.cg-theme-perspective .cg-canvas');
  });

  it('resolveThemeKind: -dark → dark, base → light', () => {
    expect(resolveThemeKind(['cg-theme-perspective-dark'], '#16181d')).toBe('dark');
    expect(resolveThemeKind(['cg-theme-perspective'], '#ffffff')).toBe('light');
  });
});

// "look-and-feel" Part A (surface #4 — chrome). These tokens are pure CSS
// custom properties consumed directly by DOM chrome rules via `var()` (config
// pills, tool-panel checkboxes) — NOT read by `CssReader` (which only
// resolves tokens the canvas painters need), so — unlike `--cg-empty-fg` in
// `cssReaderEmptyFg.test.ts` — there is no CssReader-based test to extend.
// This file's raw-CSS-text pattern is the correct precedent for chrome-only
// tokens: it pins (a) each new token's declared value per perspective block
// and (b) the fallback literal on the consuming rule, so quartz/starui (which
// never set these vars) provably keep rendering the pre-existing fallback.
describe('cg-theme-perspective chrome (surface #4 / Part A)', () => {
  it('config pills — root-level --cg-row-group-chip-* tokens (dark)', () => {
    const dark = themeBlock('.cg-theme-perspective-dark');
    expect(dark).toMatch(/--cg-row-group-chip-radius:\s*4px/);
    expect(dark).toMatch(/--cg-row-group-chip-border:\s*var\(--cg-border-color\)/);
    expect(dark).toMatch(/--cg-row-group-chip-fg:\s*var\(--cg-header-fg\)/);
    expect(dark).toMatch(/--cg-row-group-chip-hover-bg:\s*var\(--cg-row-hover-bg\)/);
    expect(dark).toMatch(/--cg-row-group-chip-bg:\s*#1c2028/i);
  });

  it('config pills — root-level --cg-row-group-chip-* tokens (light)', () => {
    const light = themeBlock('.cg-theme-perspective');
    expect(light).toMatch(/--cg-row-group-chip-radius:\s*4px/);
    expect(light).toMatch(/--cg-row-group-chip-border:\s*var\(--cg-border-color\)/);
    expect(light).toMatch(/--cg-row-group-chip-fg:\s*var\(--cg-header-fg\)/);
    expect(light).toMatch(/--cg-row-group-chip-hover-bg:\s*var\(--cg-row-hover-bg\)/);
    expect(light).toMatch(/--cg-row-group-chip-bg:\s*#f6f8fa/i);
  });

  it('config pills — scoped override wins over .cg-row-group-panel / .cg-pivot-panel\'s own local redeclaration', () => {
    // .cg-row-group-panel / .cg-pivot-panel each redeclare the chip family
    // locally (quartz-style color-mix formula), shadowing the inherited
    // root value — so a HIGHER-specificity ancestor+own-class selector is
    // required to re-win for perspective. Assert both selector pairs exist.
    expect(css).toMatch(
      /\.cg-theme-perspective \.cg-row-group-panel,\s*\n\.cg-theme-perspective \.cg-pivot-panel\s*\{[^}]*--cg-row-group-chip-bg:\s*#f6f8fa/
    );
    expect(css).toMatch(
      /\.cg-theme-perspective-dark \.cg-row-group-panel,\s*\n\.cg-theme-perspective-dark \.cg-pivot-panel\s*\{[^}]*--cg-row-group-chip-bg:\s*#1c2028/
    );
  });

  it('config pills — sidebar .cg-columns-panel-pill reads the chip family with a quartz-preserving fallback', () => {
    const pillRule = css.slice(css.indexOf('.cg-columns-panel-pill {'), css.indexOf('.cg-columns-panel-pill:hover'));
    expect(pillRule).toContain(
      'border: 1px solid var(--cg-row-group-chip-border, color-mix(in srgb, var(--cg-border-color) 55%, transparent));'
    );
    expect(pillRule).toContain('border-radius: var(--cg-row-group-chip-radius, var(--cg-radius, 4px));');
    expect(pillRule).toContain(
      'background: var(--cg-row-group-chip-bg, color-mix(in srgb, var(--cg-header-bg) 70%, var(--cg-bg-color) 30%));'
    );
    expect(pillRule).toContain('color: var(--cg-row-group-chip-fg, var(--cg-fg-color));');
  });

  it('checkboxes — root-level --cg-checkbox-panel-* tokens set the hairline-box + blue-check treatment (dark + light)', () => {
    const dark = themeBlock('.cg-theme-perspective-dark');
    const light = themeBlock('.cg-theme-perspective');
    for (const block of [dark, light]) {
      expect(block).toMatch(/--cg-checkbox-panel-border:\s*var\(--cg-border-color\)/);
      expect(block).toMatch(/--cg-checkbox-panel-checked-bg:\s*transparent/);
      expect(block).toMatch(/--cg-checkbox-panel-checked-border:\s*var\(--cg-border-color\)/);
      expect(block).toMatch(/--cg-checkbox-panel-check-color:\s*var\(--cg-pos-color\)/);
    }
  });

  it('checkboxes — .cg-columns-panel-row-checkbox reads the panel-checkbox tokens with quartz-preserving fallbacks', () => {
    const checkboxSection = css.slice(
      css.indexOf('.cg-columns-panel-row-checkbox,\n.cg-columns-panel-select-all {'),
      css.indexOf('.cg-col-drag-ghost {')
    );
    expect(checkboxSection).toContain(
      'border: 1.5px solid var(--cg-checkbox-panel-border, color-mix(in srgb, var(--cg-fg-color) 40%, transparent));'
    );
    expect(checkboxSection).toContain(
      'background: var(--cg-checkbox-panel-checked-bg, var(--cg-chrome-accent, var(--cg-fg-color)));'
    );
    expect(checkboxSection).toContain(
      'border-color: var(--cg-checkbox-panel-checked-border, var(--cg-chrome-accent, var(--cg-fg-color)));'
    );
    expect(checkboxSection).toContain('border: solid var(--cg-checkbox-panel-check-color, var(--cg-bg-color));');
  });

  it('search input — .cg-columns-panel-search-wrap input radius is tokenized with the same 2px fallback', () => {
    expect(css).toContain('border-radius: var(--cg-radius, 2px);');
  });
});
