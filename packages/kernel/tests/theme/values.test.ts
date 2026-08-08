import { describe, it, expect } from 'vitest';
import {
  compileColor,
  compileLength,
  compileBorder,
  compileFontFamily,
  compileFontWeight,
} from '../../src/theming/theme/values';

const tokenMap: Record<string, string> = {
  accentColor: '--vg-chrome-accent',
  backgroundColor: '--vg-bg-color',
  spacing: '--vg-cell-padding-x',
};
const resolveTokenName = (p: string): string => tokenMap[p] ?? '';

describe('compileColor', () => {
  it('passes through a hex string verbatim', () => {
    expect(compileColor('#2f7bc4', resolveTokenName)).toBe('#2f7bc4');
  });

  it('passes through an rgb() string verbatim', () => {
    expect(compileColor('rgb(1,2,3)', resolveTokenName)).toBe('rgb(1,2,3)');
  });

  it('passes through an oklch() string verbatim', () => {
    expect(compileColor('oklch(0.5 0.1 200)', resolveTokenName)).toBe('oklch(0.5 0.1 200)');
  });

  it('passes through a var() string verbatim', () => {
    expect(compileColor('var(--x)', resolveTokenName)).toBe('var(--x)');
  });

  it('compiles a { ref } to var(--vg-*)', () => {
    expect(compileColor({ ref: 'accentColor' }, resolveTokenName)).toBe('var(--vg-chrome-accent)');
  });

  it('compiles { ref, mix, onto } to an exact color-mix() string', () => {
    expect(
      compileColor({ ref: 'accentColor', mix: 0.25, onto: 'backgroundColor' }, resolveTokenName)
    ).toBe('color-mix(in srgb, var(--vg-chrome-accent) 25%, var(--vg-bg-color))');
  });

  it('drops trailing .0 for fractional percents (0.075 -> 7.5%)', () => {
    expect(
      compileColor({ ref: 'accentColor', mix: 0.075, onto: 'backgroundColor' }, resolveTokenName)
    ).toBe('color-mix(in srgb, var(--vg-chrome-accent) 7.5%, var(--vg-bg-color))');
  });

  it('drops trailing .0 for whole percents (0.25 -> 25%, not 25.0%)', () => {
    const result = compileColor(
      { ref: 'accentColor', mix: 0.25, onto: 'backgroundColor' },
      resolveTokenName
    );
    expect(result).toContain('25%');
    expect(result).not.toContain('25.0%');
  });

  it('clamps mix above 1 to 100%', () => {
    expect(
      compileColor({ ref: 'accentColor', mix: 1.5, onto: 'backgroundColor' }, resolveTokenName)
    ).toBe('color-mix(in srgb, var(--vg-chrome-accent) 100%, var(--vg-bg-color))');
  });

  it('clamps mix below 0 to 0%', () => {
    expect(
      compileColor({ ref: 'accentColor', mix: -0.5, onto: 'backgroundColor' }, resolveTokenName)
    ).toBe('color-mix(in srgb, var(--vg-chrome-accent) 0%, var(--vg-bg-color))');
  });

  it('emits literal "transparent" when onto is "transparent"', () => {
    expect(
      compileColor({ ref: 'accentColor', mix: 0.5, onto: 'transparent' }, resolveTokenName)
    ).toBe('color-mix(in srgb, var(--vg-chrome-accent) 50%, transparent)');
  });

  it('falls back to the raw ref name when resolveTokenName returns empty', () => {
    expect(compileColor({ ref: 'unknownParam' }, resolveTokenName)).toBe('var(--unknownParam)');
  });
});

describe('compileLength', () => {
  it('converts a positive number to px', () => {
    expect(compileLength(8, resolveTokenName)).toBe('8px');
  });

  it('converts zero to 0px', () => {
    expect(compileLength(0, resolveTokenName)).toBe('0px');
  });

  it('passes through a px string verbatim', () => {
    expect(compileLength('8px', resolveTokenName)).toBe('8px');
  });

  it('passes through a rem string verbatim', () => {
    expect(compileLength('1.5rem', resolveTokenName)).toBe('1.5rem');
  });

  it('passes through a percent string verbatim', () => {
    expect(compileLength('100%', resolveTokenName)).toBe('100%');
  });

  it('compiles { ref } to var(--vg-*)', () => {
    expect(compileLength({ ref: 'spacing' }, resolveTokenName)).toBe('var(--vg-cell-padding-x)');
  });

  it('wraps { calc } in calc(...)', () => {
    expect(compileLength({ calc: 'var(--vg-row-height) - 2px' }, resolveTokenName)).toBe(
      'calc(var(--vg-row-height) - 2px)'
    );
  });

  it('does not double-wrap a calc string that already starts with calc(', () => {
    expect(compileLength({ calc: 'calc(var(--vg-row-height) - 2px)' }, resolveTokenName)).toBe(
      'calc(var(--vg-row-height) - 2px)'
    );
  });
});

describe('compileBorder', () => {
  it('passes through a shorthand string verbatim', () => {
    expect(compileBorder('2px dashed red')).toBe('2px dashed red');
  });

  it('compiles true to the default 1px solid border using the default token', () => {
    expect(compileBorder(true)).toBe('1px solid var(--vg-border-color)');
  });

  it('compiles true using a custom borderColorToken', () => {
    expect(compileBorder(true, '--vg-my-border')).toBe('1px solid var(--vg-my-border)');
  });

  it('compiles false to none', () => {
    expect(compileBorder(false)).toBe('none');
  });
});

describe('compileFontFamily', () => {
  it('passes through a string verbatim', () => {
    expect(compileFontFamily('Inter')).toBe('Inter');
  });

  it('joins an array without quoting single-word entries', () => {
    expect(compileFontFamily(['Inter', 'system-ui'])).toBe('Inter, system-ui');
  });

  it('quotes entries containing whitespace', () => {
    expect(compileFontFamily(['JetBrains Mono', 'monospace'])).toBe("'JetBrains Mono', monospace");
  });

  it('does not double-quote an already-quoted entry', () => {
    expect(compileFontFamily(["'JetBrains Mono'", 'monospace'])).toBe(
      "'JetBrains Mono', monospace"
    );
  });
});

describe('compileFontWeight', () => {
  it('stringifies a number verbatim', () => {
    expect(compileFontWeight(600)).toBe('600');
  });

  it('passes through a string verbatim', () => {
    expect(compileFontWeight('bold')).toBe('bold');
  });
});
