// Cycle 21i / Phase 1 — color-picker parse/format round-trip tests.
// The picker's HSVA <-> RGBA math is exercised through the pure
// parse/stringify helpers (the DOM interactions are covered in E2E).

import { describe, it, expect } from 'vitest';
import { parseColor, rgbaToString } from '../src/interaction/settingsForm/colorPicker';

describe('parseColor', () => {
  it('parses #rgb', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });
  it('parses #rrggbb', () => {
    expect(parseColor('#3b82f6')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
  });
  it('parses rgb()', () => {
    expect(parseColor('rgb(56, 132, 195)')).toEqual({ r: 56, g: 132, b: 195, a: 1 });
  });
  it('parses rgba() with alpha', () => {
    expect(parseColor('rgba(56, 132, 195, 0.5)')).toEqual({ r: 56, g: 132, b: 195, a: 0.5 });
  });
  it('parses the modern slash + percent alpha form', () => {
    expect(parseColor('rgb(38 79 120 / 50%)')).toEqual({ r: 38, g: 79, b: 120, a: 0.5 });
  });
  it('returns null on junk', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('rgbaToString', () => {
  it('emits rgb() when opaque', () => {
    expect(rgbaToString({ r: 59, g: 130, b: 246, a: 1 })).toBe('rgb(59, 130, 246)');
  });
  it('emits rgba() when translucent', () => {
    expect(rgbaToString({ r: 59, g: 130, b: 246, a: 0.35 })).toBe('rgba(59, 130, 246, 0.35)');
  });
  it('round-trips through parse', () => {
    const c = parseColor('rgba(20, 184, 166, 0.4)')!;
    expect(parseColor(rgbaToString(c))).toEqual(c);
  });
});
