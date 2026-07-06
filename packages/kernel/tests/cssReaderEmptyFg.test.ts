// "look-and-feel" Part A — em-dash nulls. `CssReader` resolves
// `--cg-empty-fg` into `ResolvedTheme.emptyFg` so the number/text cell
// renderers can paint a muted color for the opt-in `emptyCellText` glyph.
// Falls back to the same muted color `totalsFgMuted` already resolves so
// themes that haven't declared `--cg-empty-fg` yet still get a sensible
// muted null color instead of an unstyled default.

import { describe, it, expect, beforeEach } from 'vitest';
import { CssReader } from '../src/theming/cssReader';

describe('CssReader — emptyFg', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('reads --cg-empty-fg into emptyFg', () => {
    container.style.cssText = `
      --cg-empty-fg: #565e6a;
    `;
    const r = new CssReader(container).read();
    expect(r.emptyFg).toBe('#565e6a');
  });

  it('falls back to --cg-totals-fg-muted when --cg-empty-fg is absent', () => {
    container.style.cssText = `
      --cg-totals-fg-muted: #94a3b8;
    `;
    const r = new CssReader(container).read();
    expect(r.emptyFg).toBe('#94a3b8');
    expect(r.emptyFg).toBe(r.totalsFgMuted);
  });

  it('falls back to the hard-coded default when both tokens are absent', () => {
    const r = new CssReader(container).read();
    expect(r.emptyFg).toBe('#475569');
  });
});
