import { describe, it, expect } from 'vitest';
import { shapeFlashAlpha } from '../../src/core/flashShaper';

// Window: flash 500ms + fade 1000ms → total 1500ms.
const F = 500, D = 1000, T = F + D;

describe('shapeFlashAlpha', () => {
  it('fade reproduces the original registry math exactly', () => {
    expect(shapeFlashAlpha('fade', 0, F, D)).toBe(1);          // t=0
    expect(shapeFlashAlpha('fade', F, F, D)).toBe(1);          // end of hold
    expect(shapeFlashAlpha('fade', F + D / 2, F, D)).toBe(0.5); // mid-fade
    expect(shapeFlashAlpha('fade', T, F, D)).toBe(0);          // t=1
    expect(shapeFlashAlpha('fade', -1, F, D)).toBe(0);
  });
  it('pulse: sin² double cycle — 0/1/0/1/0 at quarter points', () => {
    expect(shapeFlashAlpha('pulse', 0, F, D)).toBe(0);                       // t=0
    expect(shapeFlashAlpha('pulse', T * 0.25, F, D)).toBeCloseTo(1, 10);    // t=0.25
    expect(shapeFlashAlpha('pulse', T * 0.5, F, D)).toBeCloseTo(0, 10);     // t=0.5
    expect(shapeFlashAlpha('pulse', T * 0.75, F, D)).toBeCloseTo(1, 10);    // t=0.75
    expect(shapeFlashAlpha('pulse', T, F, D)).toBe(0);                       // t=1
  });
  it('glow: plateau 60% then linear fade', () => {
    expect(shapeFlashAlpha('glow', 0, F, D)).toBe(1);            // t=0
    expect(shapeFlashAlpha('glow', T * 0.5, F, D)).toBe(1);      // t=0.5 (plateau)
    expect(shapeFlashAlpha('glow', T * 0.6, F, D)).toBe(1);      // plateau edge
    expect(shapeFlashAlpha('glow', T * 0.8, F, D)).toBeCloseTo(0.5, 10);
    expect(shapeFlashAlpha('glow', T, F, D)).toBe(0);            // t=1
  });
  it('degenerate zero-length window is safe', () => {
    expect(shapeFlashAlpha('pulse', 0, 0, 0)).toBe(0);
    expect(shapeFlashAlpha('glow', 0, 0, 0)).toBe(0);
    expect(shapeFlashAlpha('fade', 0, 0, 0)).toBe(1); // original: elapsed<=flashDuration
  });
});
