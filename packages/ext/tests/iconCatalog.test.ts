import { describe, it, expect } from 'vitest';
import { lucideBundle } from '@cgrid/kernel/icons/lucide.generated';
import { lucideCategories } from '../src/toolbar/iconCatalog.generated';
import { emojiCategories } from '../src/toolbar/emojiCatalog';

describe('icon catalog', () => {
  it('covers every lucide icon exactly once', () => {
    const all = lucideCategories.flatMap((c) => [...c.icons]);
    expect(all.length).toBe(Object.keys(lucideBundle).length);
    expect(new Set(all).size).toBe(all.length);
    for (const name of all) expect(lucideBundle[name]).toBeTypeOf('string');
  });
  it('has categorized more than half the set (Other is a fallback, not the norm)', () => {
    const other = lucideCategories.find((c) => c.category === 'Other');
    const total = lucideCategories.reduce((n, c) => n + c.icons.length, 0);
    expect((other?.icons.length ?? 0) / total).toBeLessThan(0.5);
  });
  it('Other sorts last; icons sorted within each category', () => {
    expect(lucideCategories[lucideCategories.length - 1]!.category).toBe('Other');
    for (const c of lucideCategories) {
      expect([...c.icons]).toEqual([...c.icons].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe('emoji catalog', () => {
  it('has 8 categories with unique non-empty emojis', () => {
    expect(emojiCategories.length).toBe(8);
    const all = emojiCategories.flatMap((c) => [...c.emojis]);
    expect(all.length).toBeGreaterThanOrEqual(150);
    expect(new Set(all).size).toBe(all.length);
    for (const e of all) expect(e.length).toBeGreaterThan(0);
  });
});
