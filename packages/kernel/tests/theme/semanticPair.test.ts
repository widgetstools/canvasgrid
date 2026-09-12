/**
 * The semantic value pair: teal up, orange-red down.
 *
 * Every up/down reading in the grid — a P&L number's colour, the directional
 * tick flash, Excel's `[Green]`/`[Red]` format words, `--vg-success-color` /
 * `--vg-danger-color` which alias the pair — resolves to `--vg-pos-color`
 * and `--vg-neg-color`. This file is what stops those two drifting back to
 * green and red, in any theme, and what stops either of them drifting below
 * the contrast its own background needs.
 *
 * WHY not green/red. On a blotter the sign of a number is the whole message,
 * and green-vs-red is precisely the axis that deuteranopia and protanopia
 * collapse — roughly one man in twelve reads those two as the same colour.
 * Teal and orange-red separate on the blue-yellow axis and on luminance as
 * well as on hue, so they survive every common form of colour blindness and
 * greyscale printing.
 *
 * The ratios are computed here rather than copied from the CSS comments, so
 * a token edited without re-measuring fails instead of carrying a stale
 * number in a comment nobody re-reads.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// `process.cwd()` is the kernel package root under both runners (the repo's
// vitest and `npm test -w @wellsfargo-starui/velocity-grid`); the same idiom
// a11yKeyboard.test.ts uses to read this file.
const css = fs.readFileSync(path.join(process.cwd(), 'src/theming/tokens.css'), 'utf8');

// ─── colour maths (WCAG 2.x relative luminance + contrast) ─────────────────

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Hue in degrees, 0 = red, 120 = green, 180 = cyan/teal. */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/**
 * Every `selectors { body }` block in the file, tagged with whether it sits
 * inside a `prefers-color-scheme: dark` query. Comments are stripped first —
 * a banner comment above a rule otherwise becomes part of the selector text,
 * and the ones in this file contain commas.
 *
 * Matching on a parsed block rather than a literal slice of the source keeps
 * these tests working when a selector list is re-wrapped or a theme joins one.
 */
interface Block { selectors: string[]; body: string; dark: boolean }
const BLOCKS: Block[] = (() => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Block[] = [];
  // Track the one level of nesting this file uses: @media ... { rules }.
  const darkQuery = /@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/g;
  const darkRanges: Array<[number, number]> = [];
  for (const m of clean.matchAll(darkQuery)) {
    // Walk to the matching close brace.
    let depth = 1;
    let i = m.index! + m[0].length;
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') depth--;
    }
    darkRanges.push([m.index!, i]);
  }
  const inDark = (at: number) => darkRanges.some(([a, b]) => at >= a && at <= b);
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((x) => x.trim()).filter(Boolean);
    if (selectors.some((x) => x.startsWith('@'))) continue;
    out.push({ selectors, body: m[2]!, dark: inDark(m.index!) });
  }
  return out;
})();

/** The value of `name` in the LAST matching block — last, because that is the
 *  one the cascade applies. `dark` selects the media-query variant. */
function declaredFor(cls: string, name: string, dark = false): string {
  const hits = BLOCKS.filter(
    (b) => b.dark === dark && b.selectors.includes(cls) && new RegExp(`${name}\\s*:`).test(b.body),
  );
  expect(hits.length, `${cls}${dark ? ' (dark)' : ''} never declares ${name}`).toBeGreaterThan(0);
  return new RegExp(`${name}:\\s*([^;]+);`).exec(hits[hits.length - 1]!.body)![1]!.trim();
}

const tokenIn = (cls: string, name: string, dark = false): string => {
  const v = declaredFor(cls, name, dark);
  expect(v, `${cls} ${name} should be a hex literal`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  return v.toLowerCase();
};

/**
 * Each theme with its own pair, and the ground the NUMBERS are painted on —
 * `--vg-bg-color` for that theme, not the chrome around it.
 */
const THEMES = [
  { cls: '.vg-theme-quartz', bg: '#FFFFFF', min: 4.5, name: 'quartz light' },
  { cls: '.vg-theme-starui', bg: '#FFFFFF', min: 4.5, name: 'starui light' },
  { cls: '.vg-theme-cursor', bg: '#FFFFFF', min: 4.5, name: 'cursor light' },
  { cls: '.vg-theme-quartz-dark', bg: '#1D1D22', min: 4.5, name: 'quartz dark' },
  { cls: '.vg-theme-starui-dark', bg: '#1D1D22', min: 4.5, name: 'starui dark' },
  { cls: '.vg-theme-cursor-dark', bg: '#1D1D22', min: 4.5, name: 'cursor dark' },
  { cls: '.vg-theme-auto', bg: '#FFFFFF', min: 4.5, name: 'auto (light)' },
  { cls: '.vg-theme-auto', bg: '#1D1D22', min: 4.5, name: 'auto (dark)', dark: true },
  { cls: '.vg-theme-high-contrast', bg: '#ffffff', min: 7, name: 'high contrast light' },
  { cls: '.vg-theme-high-contrast-dark', bg: '#000000', min: 7, name: 'high contrast dark' },
] as ReadonlyArray<{ cls: string; bg: string; min: number; name: string; dark?: boolean }>;

describe.each(THEMES)('$name', ({ cls, bg, min, dark }) => {
  const pos = () => tokenIn(cls, '--vg-pos-color', dark ?? false);
  const neg = () => tokenIn(cls, '--vg-neg-color', dark ?? false);

  it('positive is a teal, not a green', () => {
    // Teal/cyan sits at 160-200°. Green (the thing being replaced) is
    // 90-150°, so the lower bound is the assertion that matters.
    expect(hue(pos())).toBeGreaterThanOrEqual(160);
    expect(hue(pos())).toBeLessThanOrEqual(200);
  });

  it('negative is an orange-red, not a rose or a crimson', () => {
    // Orange-red runs 5-30°. The roses and crimsons this replaces sit either
    // side of 0/350 with a strong blue component, which the channel check
    // below rules out.
    const h = hue(neg());
    expect(h).toBeGreaterThanOrEqual(5);
    expect(h).toBeLessThanOrEqual(30);
  });

  it('the negative leans yellow, not blue — that is what keeps it apart from the teal', () => {
    const [, g, b] = rgb(neg());
    expect(g).toBeGreaterThan(b);
  });

  it(`both clear ${min}:1 on ${bg}`, () => {
    expect(contrast(pos(), bg)).toBeGreaterThanOrEqual(min);
    expect(contrast(neg(), bg)).toBeGreaterThanOrEqual(min);
  });

  it('neither side shouts louder than the other', () => {
    // A pair where one half is twice the contrast of the other reads as one
    // emphasised state and one plain one, which is not what up/down means.
    const r = contrast(pos(), bg) / contrast(neg(), bg);
    expect(r).toBeGreaterThan(0.65);
    expect(r).toBeLessThan(1.55);
  });

  it('the two are far enough apart to tell at a glance', () => {
    const d = Math.abs(hue(pos()) - hue(neg()));
    expect(Math.min(d, 360 - d)).toBeGreaterThan(100);
  });
});

describe('the tick flash uses the same pair', () => {
  /** `rgb(R G B / A%)` → '#rrggbb'. */
  function flashHex(cls: string, name: string): string {
    const v = declaredFor(cls, name);
    const m = /rgb\((\d+) (\d+) (\d+)/.exec(v);
    expect(m, `${cls} ${name} should be an rgb() wash, got ${v}`).not.toBeNull();
    return '#' + [1, 2, 3].map((i) => Number(m![i]).toString(16).padStart(2, '0')).join('');
  }

  it('the light up-flash IS the light positive', () => {
    expect(flashHex('.vg-theme-quartz', '--vg-flash-up-from-color'))
      .toBe(tokenIn('.vg-theme-quartz', '--vg-pos-color'));
  });

  it('the light down-flash IS the light negative', () => {
    expect(flashHex('.vg-theme-quartz', '--vg-flash-down-from-color'))
      .toBe(tokenIn('.vg-theme-quartz', '--vg-neg-color'));
  });

  it('the dark pair matches too', () => {
    expect(flashHex('.vg-theme-quartz-dark', '--vg-flash-up-from-color'))
      .toBe(tokenIn('.vg-theme-quartz-dark', '--vg-pos-color'));
    expect(flashHex('.vg-theme-quartz-dark', '--vg-flash-down-from-color'))
      .toBe(tokenIn('.vg-theme-quartz-dark', '--vg-neg-color'));
  });

  it('a down-tick never washes teal', () => {
    // The cheap way this breaks: one of the four is updated and its partner
    // is not, so the two directions stop being opposites.
    for (const cls of ['.vg-theme-quartz', '.vg-theme-quartz-dark']) {
      expect(hue(flashHex(cls, '--vg-flash-up-from-color'))).toBeGreaterThanOrEqual(160);
      expect(hue(flashHex(cls, '--vg-flash-down-from-color'))).toBeLessThanOrEqual(30);
    }
  });
});

describe('Excel [Green] / [Red] route to the pair', () => {
  it('so a [Green];[Red] P&L format matches the flash beside it', async () => {
    const { EXCEL_NAMED_COLORS } = await import('../../src/format/excel/namedColors');
    expect(EXCEL_NAMED_COLORS.Green).toContain('--vg-pos-color');
    expect(EXCEL_NAMED_COLORS.Red).toContain('--vg-neg-color');
  });

  it('and their unthemed fallbacks are the same two families', () => {
    // A headless render has no tokens; it must not fall back to green/red.
    return import('../../src/format/excel/namedColors').then(({ EXCEL_NAMED_COLORS }) => {
      const fall = (v: string) => /#[0-9a-fA-F]{3,8}/.exec(v)![0];
      expect(hue(fall(EXCEL_NAMED_COLORS.Green!))).toBeGreaterThanOrEqual(160);
      expect(hue(fall(EXCEL_NAMED_COLORS.Red!))).toBeLessThanOrEqual(30);
    });
  });
});
