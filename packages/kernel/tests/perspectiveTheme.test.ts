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
