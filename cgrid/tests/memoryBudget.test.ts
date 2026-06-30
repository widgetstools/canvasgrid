import { describe, it, expect } from 'vitest';
import {
  estimateChunkBytes, shouldRelease, ChunkLRU,
} from '../src/core/memoryBudget';

/**
 * Cycle 25 / Task 10 — memory-pressure release.
 *
 * `memoryBudgetMB` caps the cumulative byte size of cached chunks the
 * grid holds across viewport requests. When the running sum exceeds the
 * budget we evict from the LRU end. Eviction happens before the GC has
 * to scavenge, so we don't free the chunks ourselves — the LRU holds
 * `WeakRef`s, and we just drop our strong reference (the main chunk
 * stays; only old ones become collectable).
 */

describe('estimateChunkBytes', () => {
  it('sums numeric, text, and metadata typed-array sizes', () => {
    const chunk: any = {
      rowCount: 100,
      rowIds: new Uint32Array(100),
      rowKinds: new Uint8Array(100),
      groupDepth: new Uint8Array(100),
      heights: new Float32Array(100),
      numericCols: {
        price: new Float64Array(100),
        qty: new Float64Array(100),
      },
      textCols: {
        name: { offsets: new Uint32Array(101), bytes: new Uint8Array(1000) },
      },
    };
    const bytes = estimateChunkBytes(chunk);
    // numeric: 2 × 800; text offsets: 404; text bytes: 1000;
    // rowIds 400 + rowKinds 100 + groupDepth 100 + heights 400
    expect(bytes).toBe(2 * 800 + 404 + 1000 + 400 + 100 + 100 + 400);
  });

  it('returns 0 for null / undefined chunks', () => {
    expect(estimateChunkBytes(null)).toBe(0);
    expect(estimateChunkBytes(undefined)).toBe(0);
  });
});

describe('shouldRelease', () => {
  it('returns false when budget is 0 or undefined (no limit)', () => {
    expect(shouldRelease(0, 1_000_000)).toBe(false);
    expect(shouldRelease(undefined, 1_000_000)).toBe(false);
  });

  it('returns true when used > budget', () => {
    expect(shouldRelease(70 * 1024 * 1024, 60 * 1024 * 1024)).toBe(true);
  });

  it('returns false when used <= budget', () => {
    expect(shouldRelease(100, 50 * 1024 * 1024)).toBe(false);
  });
});

describe('ChunkLRU', () => {
  it('stores chunks under a key + retrieves them while still alive', () => {
    const lru = new ChunkLRU(1024 * 1024); // 1 MB budget
    const chunk = { hello: 'world' } as any;
    lru.set('a', chunk, 100);
    expect(lru.get('a')).toBe(chunk);
  });

  it('evicts the LRU entry when budget is exceeded', () => {
    const lru = new ChunkLRU(250);
    lru.set('a', { id: 'a' } as any, 100);
    lru.set('b', { id: 'b' } as any, 100);
    lru.set('c', { id: 'c' } as any, 100);
    // 'a' should have been evicted (sum 300 > 250)
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBeDefined();
    expect(lru.get('c')).toBeDefined();
  });

  it('promotes touched entries on get so they survive eviction', () => {
    const lru = new ChunkLRU(250);
    lru.set('a', { id: 'a' } as any, 100);
    lru.set('b', { id: 'b' } as any, 100);
    lru.get('a'); // promote a
    lru.set('c', { id: 'c' } as any, 100); // forces eviction of b (LRU)
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBeDefined();
    expect(lru.get('c')).toBeDefined();
  });

  it('a manual clear() resets the cache entirely', () => {
    const lru = new ChunkLRU(1_000_000);
    lru.set('a', { id: 'a' } as any, 100);
    lru.clear();
    expect(lru.get('a')).toBeUndefined();
    expect(lru.bytes()).toBe(0);
  });
});
