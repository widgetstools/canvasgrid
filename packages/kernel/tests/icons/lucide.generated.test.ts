import { describe, it, expect } from 'vitest';
import { lucideBundle } from '../../src/icons/lucide.generated';

describe('Lucide bundle smoke test', () => {
  it('exports at least 1000 icons', () => {
    expect(Object.keys(lucideBundle).length).toBeGreaterThanOrEqual(1000);
  });

  it('line-only icons like crosshair + battery + voicemail are present (regression: build-lucide line regex)', () => {
    expect(lucideBundle['crosshair']).toBeDefined();
    expect(lucideBundle['battery']).toBeDefined();
    expect(lucideBundle['voicemail']).toBeDefined();
    expect(lucideBundle['equal']).toBeDefined();
  });

  it('has trending-up + trending-down (referenced by design spec)', () => {
    expect(lucideBundle['trending-up']).toBeDefined();
    expect(lucideBundle['trending-down']).toBeDefined();
  });

  it('heart-off (attribute order regression) contains the diagonal slash line', () => {
    // heart-off.svg uses x1 y1 x2 y2 order (unlike other line-using files).
    // Verify the diagonal slash M2,2 L22,22 is present so heart-off is
    // visually distinct from heart.
    expect(lucideBundle['heart-off']).toBeDefined();
    expect(lucideBundle['heart-off']).toContain('M2,2 L22,22');
  });

  it('every entry is a non-empty string', () => {
    for (const [, path] of Object.entries(lucideBundle)) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }
  });
});
