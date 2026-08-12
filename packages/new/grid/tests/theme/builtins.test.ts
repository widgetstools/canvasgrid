import { describe, it, expect } from 'vitest';
import { themeQuartz, themeStarui, baseTheme } from '../../src/theming/theme/builtins';

describe('themeQuartz — byte-identical to the quartz CSS class', () => {
  it('compiles to empty vars (no auto-derivations without a dependency present)', () => {
    expect(themeQuartz.compile('dark').vars).toEqual({});
    expect(themeQuartz.compile('light').vars).toEqual({});
  });

  it('has the quartz light/dark baseClass pair', () => {
    const compiled = themeQuartz.compile('dark');
    expect(compiled.baseClass).toEqual({
      light: 'vg-theme-quartz',
      dark: 'vg-theme-quartz-dark',
    });
  });

  it('has no css contribution', () => {
    expect(themeQuartz.compile('light').css).toBeUndefined();
  });
});

describe('themeStarui — starui baseClass pair', () => {
  it('has the starui light baseClass', () => {
    expect(themeStarui.compile('light').baseClass.light).toBe('vg-theme-starui');
  });

  it('has the starui dark baseClass', () => {
    expect(themeStarui.compile('dark').baseClass.dark).toBe('vg-theme-starui-dark');
  });

  it('compiles to empty vars just like themeQuartz', () => {
    expect(themeStarui.compile('dark').vars).toEqual({});
  });
});

describe('baseTheme — alias for themeQuartz', () => {
  it('is the same neutral starting point as themeQuartz', () => {
    expect(baseTheme).toBe(themeQuartz);
  });
});

describe('themeQuartz.withParams — accent-dependent derivations, immutability', () => {
  it('includes the explicit accent token plus its dependent derivations, but not bg/fg-only ones', () => {
    const themed = themeQuartz.withParams({ accentColor: '#ff0000' });
    const vars = themed.compile('dark').vars;

    expect(vars['--vg-chrome-accent']).toBe('#ff0000');
    expect(vars['--vg-row-hover-bg']).toBe(
      'color-mix(in srgb, var(--vg-chrome-accent) 7%, var(--vg-bg-color))'
    );
    expect(vars['--vg-row-selected-bg']).toBe(
      'color-mix(in srgb, var(--vg-chrome-accent) 12%, var(--vg-bg-color))'
    );
    expect(vars['--vg-range-border-color']).toBe('var(--vg-chrome-accent)');

    expect(vars['--vg-border-color']).toBeUndefined();
  });

  it('does not mutate themeQuartz itself', () => {
    themeQuartz.withParams({ accentColor: '#ff0000' });
    expect(themeQuartz.compile('dark').vars).toEqual({});
  });
});
