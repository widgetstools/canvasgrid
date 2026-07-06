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
      light: 'cg-theme-quartz',
      dark: 'cg-theme-quartz-dark',
    });
  });

  it('has no css contribution', () => {
    expect(themeQuartz.compile('light').css).toBeUndefined();
  });
});

describe('themeStarui — starui baseClass pair', () => {
  it('has the starui light baseClass', () => {
    expect(themeStarui.compile('light').baseClass.light).toBe('cg-theme-starui');
  });

  it('has the starui dark baseClass', () => {
    expect(themeStarui.compile('dark').baseClass.dark).toBe('cg-theme-starui-dark');
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

    expect(vars['--cg-chrome-accent']).toBe('#ff0000');
    expect(vars['--cg-row-hover-bg']).toBe(
      'color-mix(in srgb, var(--cg-chrome-accent) 7%, var(--cg-bg-color))'
    );
    expect(vars['--cg-row-selected-bg']).toBe(
      'color-mix(in srgb, var(--cg-chrome-accent) 12%, var(--cg-bg-color))'
    );
    expect(vars['--cg-range-border-color']).toBe('var(--cg-chrome-accent)');

    expect(vars['--cg-border-color']).toBeUndefined();
  });

  it('does not mutate themeQuartz itself', () => {
    themeQuartz.withParams({ accentColor: '#ff0000' });
    expect(themeQuartz.compile('dark').vars).toEqual({});
  });
});
