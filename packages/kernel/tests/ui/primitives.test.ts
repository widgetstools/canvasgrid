import { describe, expect, it } from 'vitest';
import {
  VGUI_DEFAULT_TOKENS,
  vguiButtonCss,
  vguiCapsCss,
  vguiChipCss,
  vguiRowCss,
  vguiTileCss,
} from '../../src/ui/primitives';

const RETIRED_HARDCODED_BLUE = '#' + '4f9cf9';

describe('VGUI_DEFAULT_TOKENS', () => {
  it('points accent at the theme chrome token, not the retired hardcoded blue', () => {
    expect(VGUI_DEFAULT_TOKENS.accent).toBe('var(--vg-chrome-accent, var(--vg-focus-ring-color))');
    expect(VGUI_DEFAULT_TOKENS.accent).not.toContain(RETIRED_HARDCODED_BLUE);
  });
});

describe('vguiCapsCss', () => {
  it('emits the unified eyebrow spec', () => {
    const css = vguiCapsCss('.ckp-caps');
    expect(css).toContain('font-size: 11px');
    expect(css).toContain('font-weight: 600');
    expect(css).toContain('letter-spacing: 0.1em');
  });
});

describe('vguiRowCss', () => {
  it('stacks help under the label and pins a 28px control column', () => {
    const css = vguiRowCss({
      root: 'ckp-row',
      label: 'ckp-row-label',
      title: 'ckp-row-title',
      help: 'ckp-help',
      control: 'ckp-row-control',
    });
    expect(css).toContain('grid-template-columns:');
    expect(css).toContain('min-height: 28px');
    expect(css).toContain('font-size: 12.5px');
    expect(css).toContain('font-weight: 500');
    expect(css).toContain('text-transform: none');
    expect(css).not.toContain(RETIRED_HARDCODED_BLUE);
    // The label used to be inset 10px inside a row already gutted at 16px,
    // which put the section title, the field label and the row edge on
    // three different left edges. Everything shares the row's gutter now.
    expect(css).toContain('padding-left: 0');
    // No per-row divider: a rule under every row turned a pane of a dozen
    // fields into as many horizontal lines — the grammar of a properties
    // dialog, where the lines group because nothing else does. The control
    // column is on one vertical edge and the band groups; space carries it.
    expect(css).not.toContain('border-bottom');
  });
});

describe('vguiButtonCss', () => {
  it('emits the four-rung 28px ladder', () => {
    const css = vguiButtonCss({
      primary: 'ckp-btn-primary',
      secondary: 'ckp-btn-secondary',
      quiet: 'ckp-btn-quiet',
      danger: 'ckp-btn-danger',
    });
    expect(css).toContain('height: 28px');
    expect(css).toContain('padding: 0 13px');
    expect(css).toContain('border-radius:');
    expect(css).toContain('2px');
    expect(css).toContain('font-size: 12px');
    expect(css).toContain('.ckp-btn-primary');
    expect(css).toContain('.ckp-btn-secondary');
    expect(css).toContain('.ckp-btn-quiet');
    expect(css).toContain('.ckp-btn-danger');
    expect(css).toContain('--vg-neg-color');
    expect(css).not.toContain(RETIRED_HARDCODED_BLUE);
  });
});

describe('vguiChipCss', () => {
  it('emits a two-part mono chip with semantic tones', () => {
    const css = vguiChipCss({
      root: 'ckp-chip',
      key: 'ckp-chip-label',
      value: 'ckp-chip-value',
      positive: 'positive',
      warning: 'warning',
      negative: 'negative',
      info: 'info',
    });
    expect(css).toContain('JetBrains Mono');
    expect(css).toContain('--vg-pos-color');
    expect(css).toContain('--vg-warning-color');
    expect(css).toContain('--vg-neg-color');
    expect(css).toContain('height: 21px');
    expect(css).not.toContain(RETIRED_HARDCODED_BLUE);
  });
});

describe('vguiTileCss', () => {
  it('emits a 30px bordered tile with accent fill when selected', () => {
    const css = vguiTileCss({ root: 'ckp-tile', on: 'on' });
    expect(css).toContain('width: 30px');
    expect(css).toContain('height: 30px');
    expect(css).toContain('box-sizing: border-box');
    expect(css).not.toContain(RETIRED_HARDCODED_BLUE);
  });
});
