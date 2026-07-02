import { describe, it, expect } from 'vitest';
import { isDarkColor, resolveThemeKind } from '../../src/theming/themeKind';

describe('isDarkColor', () => {
  it('classifies hex colors', () => {
    expect(isDarkColor('#ffffff')).toBe(false);
    expect(isDarkColor('#0b0e14')).toBe(true);
    expect(isDarkColor('#fff')).toBe(false);
    expect(isDarkColor('#111')).toBe(true);
  });
  it('classifies rgb()/rgba() colors', () => {
    expect(isDarkColor('rgb(255, 255, 255)')).toBe(false);
    expect(isDarkColor('rgba(20, 20, 24, 1)')).toBe(true);
  });
  it('unparseable colors read as light', () => {
    expect(isDarkColor('papayawhip')).toBe(false);
    expect(isDarkColor('')).toBe(false);
  });
});

describe('resolveThemeKind', () => {
  it('-dark suffixed theme classes are dark', () => {
    expect(resolveThemeKind(['cg-theme-quartz-dark'], '#fff')).toBe('dark');
    expect(resolveThemeKind(['cg-theme-high-contrast-dark'], '#fff')).toBe('dark');
  });
  it('non-dark theme classes are light regardless of bg', () => {
    expect(resolveThemeKind(['cg-theme-quartz'], '#000')).toBe('light');
    expect(resolveThemeKind(['cg-theme-high-contrast'], '#000')).toBe('light');
  });
  it('no cg-theme class falls back to bg luminance', () => {
    expect(resolveThemeKind(['my-custom-grid'], '#0b0e14')).toBe('dark');
    expect(resolveThemeKind([], '#ffffff')).toBe('light');
  });
  it('cg-theme-auto follows prefers-color-scheme (light default in happy-dom)', () => {
    expect(resolveThemeKind(['cg-theme-auto'], '#000')).toBe('light');
  });
});
