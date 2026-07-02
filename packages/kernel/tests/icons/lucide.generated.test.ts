import { describe, it, expect } from 'vitest';
import { lucideBundle } from '../../src/icons/lucide.generated';

describe('Lucide bundle smoke test', () => {
  it('exports at least 1000 icons', () => {
    expect(Object.keys(lucideBundle).length).toBeGreaterThanOrEqual(1000);
  });

  it('has trending-up + trending-down (referenced by design spec)', () => {
    expect(lucideBundle['trending-up']).toBeDefined();
    expect(lucideBundle['trending-down']).toBeDefined();
  });

  it('every entry is a non-empty string', () => {
    for (const [, path] of Object.entries(lucideBundle)) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }
  });
});
