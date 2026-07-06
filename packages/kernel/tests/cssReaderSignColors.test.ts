// Cycle "look-and-feel" / Task 1 — theme-token sign palette. `CssReader`
// resolves `--cg-pos-color` / `--cg-neg-color` into `ResolvedTheme.posColor`
// / `.negColor` so renderers can paint a theme's positive/negative accent
// (e.g. Perspective's blue/salmon) instead of a hard-coded green/red.
// Absent tokens resolve to `''` (NOT a hard-coded fallback color) — the
// empty string is mapped to `undefined` downstream (propertyChain.ts) so
// renderers' `?? SEMANTIC_COLORS` fallback fires for un-themed grids.

import { describe, it, expect, beforeEach } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

describe('CssReader — sign colors', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('reads --cg-pos-color / --cg-neg-color into posColor/negColor', () => {
    container.style.cssText = `
      --cg-pos-color: #6aa9e0;
      --cg-neg-color: #e0876a;
    `;
    const r = new CssReader(container).read();
    expect(r.posColor).toBe('#6aa9e0');
    expect(r.negColor).toBe('#e0876a');
  });

  it('resolves to empty string when the tokens are absent', () => {
    const r = new CssReader(container).read();
    expect(r.posColor).toBe('');
    expect(r.negColor).toBe('');
  });
});
