import { describe, it, expect } from 'vitest';
import { createTheme, type ThemeMode } from '../../src/theming/theme/themeObject';

describe('createTheme — defaults', () => {
  it('defaults baseClass to quartz light/dark', () => {
    const theme = createTheme();
    const compiled = theme.compile('light');
    expect(compiled.baseClass).toEqual({
      light: 'cg-theme-quartz',
      dark: 'cg-theme-quartz-dark',
    });
  });

  it('compiles to only the auto-derived tokens with no layers (no explicit params set)', () => {
    const theme = createTheme();
    // No withParams layers means an empty merged CgThemeParams, so
    // compileParams still emits its fixed 7-token auto-derivation set
    // (see params.ts) — verify no *explicit* param leaked in.
    expect(theme.compile('light').vars['--cg-chrome-accent']).toBeUndefined();
    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBeUndefined();
  });
});

describe('withParams — immutability', () => {
  it('does not mutate the original theme', () => {
    const a = createTheme();
    const b = a.withParams({ accentColor: '#f00' });

    expect(a.compile('light').vars['--cg-chrome-accent']).toBeUndefined();
    expect(b.compile('light').vars['--cg-chrome-accent']).toBe('#f00');
  });

  it('returns a new CgTheme instance', () => {
    const a = createTheme();
    const b = a.withParams({ accentColor: '#f00' });
    expect(b).not.toBe(a);
  });
});

describe('withParams — layering', () => {
  it('lets a later withParams call win over an earlier one for the same param', () => {
    const theme = createTheme()
      .withParams({ accentColor: '#f00' })
      .withParams({ accentColor: '#0f0' });

    expect(theme.compile('light').vars['--cg-chrome-accent']).toBe('#0f0');
  });
});

describe('withParams — modes', () => {
  it('scopes a mode-tagged layer to that mode only, base layers apply to both', () => {
    const theme = createTheme()
      .withParams({ backgroundColor: '#111' })
      .withParams({ backgroundColor: '#fff' }, 'light');

    expect(theme.compile('dark').vars['--cg-bg-color']).toBe('#111');
    expect(theme.compile('light').vars['--cg-bg-color']).toBe('#fff');
  });

  it('applies a base (mode-omitted) param to both light and dark', () => {
    const theme = createTheme().withParams({ accentColor: '#2f7bc4' });

    expect(theme.compile('light').vars['--cg-chrome-accent']).toBe('#2f7bc4');
    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBe('#2f7bc4');
  });

  it('a dark-tagged layer does not leak into light compile', () => {
    const theme = createTheme().withParams({ accentColor: '#000000' }, 'dark');

    expect(theme.compile('dark').vars['--cg-chrome-accent']).toBe('#000000');
    // light falls back to auto-derivation/undefined, not the dark override
    expect(theme.compile('light').vars['--cg-chrome-accent']).toBeUndefined();
  });
});

describe('withParams — record deep-merge (statusColors/ratingColors/venueColors)', () => {
  it('merges statusColors sub-keys across layers instead of replacing wholesale', () => {
    const theme = createTheme()
      .withParams({ statusColors: { filled: { bg: '#0a0' } } })
      .withParams({ statusColors: { working: { bg: '#00a' } } });

    const vars = theme.compile('light').vars;
    expect(vars['--cg-status-filled-bg']).toBe('#0a0');
    expect(vars['--cg-status-working-bg']).toBe('#00a');
  });

  it('merges ratingColors keys across layers', () => {
    const theme = createTheme()
      .withParams({ ratingColors: { aaa: '#0aa063' } })
      .withParams({ ratingColors: { bbb: '#deadbe' } });

    const vars = theme.compile('light').vars;
    expect(vars['--cg-rating-aaa-color']).toBe('#0aa063');
    expect(vars['--cg-rating-bbb-color']).toBe('#deadbe');
  });

  it('merges venueColors keys across layers', () => {
    const theme = createTheme()
      .withParams({ venueColors: { XNAS: '#3b82f6' } })
      .withParams({ venueColors: { XLON: '#ff8800' } });

    const vars = theme.compile('light').vars;
    expect(vars['--cg-venue-xnas-color']).toBe('#3b82f6');
    expect(vars['--cg-venue-xlon-color']).toBe('#ff8800');
  });
});

describe('withParams — vars deep-merge', () => {
  it('merges vars keys across layers rather than replacing the whole map', () => {
    const theme = createTheme()
      .withParams({ vars: { '--cg-custom-a': 'red' } })
      .withParams({ vars: { '--cg-custom-b': 'blue' } });

    const vars = theme.compile('light').vars;
    expect(vars['--cg-custom-a']).toBe('red');
    expect(vars['--cg-custom-b']).toBe('blue');
  });

  it('lets a later layer override an earlier layer for the same var key', () => {
    const theme = createTheme()
      .withParams({ vars: { '--cg-custom-a': 'red' } })
      .withParams({ vars: { '--cg-custom-a': 'green' } });

    expect(theme.compile('light').vars['--cg-custom-a']).toBe('green');
  });
});

describe('createTheme — custom baseClass', () => {
  it('carries a custom baseClass through to compile()', () => {
    const theme = createTheme({
      baseClass: { light: 'cg-theme-starui', dark: 'cg-theme-starui-dark' },
    });

    expect(theme.compile('light').baseClass).toEqual({
      light: 'cg-theme-starui',
      dark: 'cg-theme-starui-dark',
    });
  });

  it('withParams preserves the original baseClass', () => {
    const base = createTheme({
      baseClass: { light: 'cg-theme-starui', dark: 'cg-theme-starui-dark' },
    });
    const themed = base.withParams({ accentColor: '#111' });

    expect(themed.compile('dark').baseClass).toEqual({
      light: 'cg-theme-starui',
      dark: 'cg-theme-starui-dark',
    });
  });
});

describe('mode typing', () => {
  it('accepts light and dark as valid ThemeMode values', () => {
    const modes: ThemeMode[] = ['light', 'dark'];
    expect(modes).toHaveLength(2);
  });
});
