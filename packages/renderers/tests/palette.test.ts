// @cgrid/renderers — palette function tests (Cycle 21f / Task 2).
//
// Tests for the theme-aware functions added to palette.ts in Task 2.
// The catalog CONST data maps (SEMANTIC_COLORS etc.) are tested in types.test.ts.

import { describe, it, expect } from 'vitest';
import {
  resolveSemanticColors,
  withThemeAlpha,
  resolvePillColors,
} from '../src/palette';

// ─── resolveSemanticColors ───────────────────────────────────────────────────

describe('resolveSemanticColors', () => {
  it('returns the 4 catalog hexes exactly (§1 aesthetic bar)', () => {
    const colors = resolveSemanticColors();
    expect(colors.positive).toBe('#3de0a0');
    expect(colors.negative).toBe('#f05071');
    expect(colors.warning).toBe('#f0b429');
    expect(colors.info).toBe('#3b82f6');
  });

  it('returns muted as a low-chroma gray (same light/dark)', () => {
    const colors = resolveSemanticColors();
    expect(typeof colors.muted).toBe('string');
    expect(colors.muted).toMatch(/^#[0-9a-f]{6}$/i);
    // same value every call (const, no theme input)
    expect(resolveSemanticColors().muted).toBe(colors.muted);
  });

  it('returns a plain object (no side effects, structuredClone-safe)', () => {
    const a = resolveSemanticColors();
    const b = resolveSemanticColors();
    expect(a).toEqual(b);
    expect(structuredClone(a)).toEqual(a);
  });
});

// ─── withThemeAlpha ──────────────────────────────────────────────────────────

describe('withThemeAlpha', () => {
  it('dark × 1.4 — 0.5 → 0.7', () => {
    expect(withThemeAlpha(0.5, 'dark')).toBeCloseTo(0.7, 10);
  });

  it('dark × 1.4 clamped to 1 — 0.8 → 1', () => {
    expect(withThemeAlpha(0.8, 'dark')).toBe(1);
  });

  it('dark × 1.4 clamped at exactly 1 — 1 → 1', () => {
    expect(withThemeAlpha(1, 'dark')).toBe(1);
  });

  it('light is a passthrough — 0.5 → 0.5', () => {
    expect(withThemeAlpha(0.5, 'light')).toBe(0.5);
  });

  it('light passthrough for any value — 0.12 → 0.12', () => {
    expect(withThemeAlpha(0.12, 'light')).toBe(0.12);
  });
});

// ─── resolvePillColors ───────────────────────────────────────────────────────

describe('resolvePillColors', () => {
  it('WORKING/light → bg is rgba with low alpha, fg is info blue', () => {
    const result = resolvePillColors('WORKING', 'light');
    expect(result.fg).toBe('#3b82f6');
    expect(result.bg).toMatch(/^rgba\(59,130,246,/);
  });

  it('WORKING/dark → same fg hue, higher-alpha bg than light', () => {
    const light = resolvePillColors('WORKING', 'light');
    const dark = resolvePillColors('WORKING', 'dark');
    // fg hue identical
    expect(dark.fg).toBe(light.fg);
    // bg differs (dark alpha is boosted)
    expect(dark.bg).not.toBe(light.bg);
    // both are rgba
    expect(dark.bg).toMatch(/^rgba\(/);
    // dark alpha > light alpha
    const extractAlpha = (rgba: string): number =>
      parseFloat(rgba.replace(/.*,\s*/, '').replace(')', ''));
    expect(extractAlpha(dark.bg)).toBeGreaterThan(extractAlpha(light.bg));
  });

  it('FILLED/light → fg is positive green', () => {
    const result = resolvePillColors('FILLED', 'light');
    expect(result.fg).toBe('#0aa063');
  });

  it('REJECTED/light → has border, fg is negative red', () => {
    const result = resolvePillColors('REJECTED', 'light');
    expect(result.fg).toBe('#e63946');
    expect(result.border).toBe('#e63946');
  });

  it('unknown status → fallback, no throw', () => {
    expect(() => resolvePillColors('__UNKNOWN__', 'light')).not.toThrow();
    const result = resolvePillColors('__UNKNOWN__', 'light');
    expect(typeof result.fg).toBe('string');
    expect(typeof result.bg).toBe('string');
  });
});
