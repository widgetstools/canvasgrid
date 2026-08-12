import { describe, it, expect } from 'vitest';
import {
  workerCanMeasure,
  MeasureCache,
  wrapTextToHeight,
} from '../src/worker/measureText';

describe('workerCanMeasure', () => {
  it('returns a boolean and memoises after the first call', () => {
    const first = workerCanMeasure();
    expect(typeof first).toBe('boolean');
    const second = workerCanMeasure();
    expect(second).toBe(first);
  });
});

describe('MeasureCache (LRU)', () => {
  it('round-trips set/get for a single entry', () => {
    const cache = new MeasureCache(4);
    cache.set('font|10|hi', 28);
    expect(cache.get('font|10|hi')).toBe(28);
    expect(cache.has('font|10|hi')).toBe(true);
  });

  it('returns undefined for an absent key', () => {
    const cache = new MeasureCache(4);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('missing')).toBe(false);
  });

  it('evicts the least-recently-used entry when capacity + 1 is inserted', () => {
    const cache = new MeasureCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Touch 'a' so 'b' is the LRU.
    expect(cache.get('a')).toBe(1);
    cache.set('d', 4);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.size()).toBe(3);
  });

  it('updating an existing key does not evict and refreshes recency', () => {
    const cache = new MeasureCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // 'b' is now LRU
    cache.set('c', 3);  // evicts 'b'
    expect(cache.get('a')).toBe(10);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });
});

describe('wrapTextToHeight (greedy word-wrap)', () => {
  // Test double: each char is 10px wide. Words split on spaces.
  const tenPxPerChar = (s: string) => s.length * 10;

  it('single-line text returns lineHeight + 2*padding', () => {
    const h = wrapTextToHeight('hi', 100, 20, 4, tenPxPerChar);
    // 'hi' = 20px wide, fits in 100; 1 line
    expect(h).toBe(20 + 8);
  });

  it('wraps a long string across multiple lines', () => {
    // 'aaaa bbbb cccc' — three 4-char words, each 40 px; width 80 fits two words.
    const h = wrapTextToHeight('aaaa bbbb cccc', 80, 20, 0, tenPxPerChar);
    // "aaaa bbbb" wraps to one line (40+10+40=90? Actually with separator).
    // Greedy: try 'aaaa' (40) → fits in 80 (current width 40). Try 'aaaa bbbb' (90) → exceeds 80; wrap.
    // Line 1: 'aaaa' (40). Line 2: 'bbbb cccc' (90) exceeds 80 → wrap. Line 2: 'bbbb', Line 3: 'cccc'.
    expect(h).toBe(20 * 3);
  });

  it('returns at least one line for empty input', () => {
    expect(wrapTextToHeight('', 100, 20, 0, tenPxPerChar)).toBe(20);
  });

  it('height is monotone non-decreasing as width shrinks', () => {
    const text = 'aaaa bbbb cccc dddd eeee ffff';
    let prev = 0;
    for (const w of [400, 300, 200, 120, 80, 40]) {
      const h = wrapTextToHeight(text, w, 20, 0, tenPxPerChar);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it('treats a single word wider than the line as one line (never splits a word)', () => {
    // 'aaaaa' = 50px wide; width = 20px. Should still return one line.
    expect(wrapTextToHeight('aaaaa', 20, 20, 0, tenPxPerChar)).toBe(20);
  });

  it('handles a width of 0 by returning a single line', () => {
    expect(wrapTextToHeight('aaaa bbbb', 0, 20, 0, tenPxPerChar)).toBe(20);
  });
});
