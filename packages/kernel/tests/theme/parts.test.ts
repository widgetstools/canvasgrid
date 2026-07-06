import { describe, it, expect } from 'vitest';
import { createTheme } from '../../src/theming/theme/themeObject';

describe('withPart — param fold', () => {
  it('folds a part`s params into the compiled vars', () => {
    const theme = createTheme().withPart({ feature: 'x', params: { accentColor: '#f00' } });
    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBe('#f00');
  });
});

describe('withPart — one-per-feature replace', () => {
  it('replaces a prior part of the same feature rather than stacking both', () => {
    const theme = createTheme()
      .withPart({ feature: 'x', params: { accentColor: '#f00' } })
      .withPart({ feature: 'x', params: { accentColor: '#0f0' } });

    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBe('#0f0');
  });
});

describe('withoutPart', () => {
  it('removes the effect of a previously-added part', () => {
    const theme = createTheme()
      .withPart({ feature: 'x', params: { accentColor: '#f00' } })
      .withoutPart('x');

    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBeUndefined();
  });

  it('is a no-op when the feature was never added', () => {
    const theme = createTheme().withoutPart('nope');
    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBeUndefined();
  });
});

describe('withPart — distinct features coexist', () => {
  it('folds two different-feature parts together', () => {
    const theme = createTheme()
      .withPart({ feature: 'x', params: { accentColor: '#f00' } })
      .withPart({ feature: 'y', params: { backgroundColor: '#123456' } });

    const vars = theme.compile('dark').vars;
    expect(vars['--cg-chrome-accent']).toBe('#f00');
    expect(vars['--cg-bg-color']).toBe('#123456');
  });
});

describe('withPart — css collection', () => {
  it('surfaces a single part`s css on the compiled theme', () => {
    const theme = createTheme().withPart({ feature: 'y', css: '.foo{}' });
    expect(theme.compile('dark').css).toContain('.foo{}');
  });

  it('concatenates css from multiple active parts', () => {
    const theme = createTheme()
      .withPart({ feature: 'a', css: '.a{}' })
      .withPart({ feature: 'b', css: '.b{}' });

    const css = theme.compile('dark').css ?? '';
    expect(css).toContain('.a{}');
    expect(css).toContain('.b{}');
  });

  it('is undefined when no active part supplies css', () => {
    const theme = createTheme().withPart({ feature: 'z', params: { accentColor: '#f00' } });
    expect(theme.compile('dark').css).toBeUndefined();
  });

  it('is undefined for a theme with no parts at all', () => {
    expect(createTheme().compile('dark').css).toBeUndefined();
  });
});

describe('withPart — mode scoping', () => {
  it('applies a mode-tagged part only to that mode', () => {
    const theme = createTheme().withPart({
      feature: 'x',
      params: { accentColor: '#f00' },
      mode: 'light',
    });

    expect(theme.compile('light').vars['--cg-chrome-accent']).toBe('#f00');
    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBeUndefined();
  });

  it('applies a mode-omitted part to both light and dark (base)', () => {
    const theme = createTheme().withPart({ feature: 'x', params: { accentColor: '#f00' } });

    expect(theme.compile('light').vars['--cg-chrome-accent']).toBe('#f00');
    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBe('#f00');
  });
});

describe('withPart / withoutPart — immutability', () => {
  it('withPart returns a new instance and leaves the original untouched', () => {
    const a = createTheme();
    const b = a.withPart({ feature: 'x', params: { accentColor: '#f00' } });

    expect(b).not.toBe(a);
    expect(a.compile('dark').vars['--cg-chrome-accent']).toBeUndefined();
    expect(b.compile('dark').vars['--cg-chrome-accent']).toBe('#f00');
  });

  it('withoutPart returns a new instance and leaves the prior one untouched', () => {
    const a = createTheme().withPart({ feature: 'x', params: { accentColor: '#f00' } });
    const b = a.withoutPart('x');

    expect(b).not.toBe(a);
    expect(a.compile('dark').vars['--cg-chrome-accent']).toBe('#f00');
    expect(b.compile('dark').vars['--cg-chrome-accent']).toBeUndefined();
  });
});
