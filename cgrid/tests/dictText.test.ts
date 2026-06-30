import { describe, it, expect } from 'vitest';
import { encodeTextDict, decodeTextDict } from '../src/worker/chunkFormat';

/**
 * Cycle 25 / Task 2 — dictionary-coded text columns.
 *
 * Low-cardinality text columns (region, currency, status) dedup
 * massively when stored as `{ dict: string[], indices: typed array }`
 * instead of the existing `{ offsets, bytes }` shape that re-encodes
 * every value inline. The indices array picks the narrowest typed
 * array that can hold `dict.length` (Uint8 / Uint16 / Uint32).
 *
 * This commit ships the pure helpers; rewiring `serializeChunk` to
 * pick dict-coded encoding per column based on cardinality is the
 * follow-up that closes Task 2.
 */

describe('encodeTextDict / decodeTextDict — round trip', () => {
  it('packs N copies of one string as a 1-entry dict', () => {
    const xs = ['APAC', 'APAC', 'APAC', 'APAC'];
    const packed = encodeTextDict(xs);
    expect(packed.dict).toEqual(['APAC']);
    expect(packed.indices.length).toBe(4);
    expect(Array.from(packed.indices)).toEqual([0, 0, 0, 0]);
    expect(decodeTextDict(packed.dict, packed.indices)).toEqual(xs);
  });

  it('round-trips a varied vocabulary with stable dict order (first occurrence wins)', () => {
    const xs = ['B', 'A', 'B', 'C', 'A', 'B'];
    const packed = encodeTextDict(xs);
    expect(packed.dict).toEqual(['B', 'A', 'C']);
    expect(Array.from(packed.indices)).toEqual([0, 1, 0, 2, 1, 0]);
    expect(decodeTextDict(packed.dict, packed.indices)).toEqual(xs);
  });

  it('picks Uint8 for dicts up to 256 entries', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => `v${i % 200}`);
    const packed = encodeTextDict(xs);
    expect(packed.dict.length).toBe(200);
    expect(packed.indices).toBeInstanceOf(Uint8Array);
  });

  it('picks Uint16 for dicts 257..65536', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => `v${i}`);
    // first 1000 are unique → dict size 1000, needs Uint16
    const packed = encodeTextDict(xs);
    expect(packed.dict.length).toBe(1000);
    expect(packed.indices).toBeInstanceOf(Uint16Array);
  });

  it('handles empty input', () => {
    const packed = encodeTextDict([]);
    expect(packed.dict).toEqual([]);
    expect(packed.indices.length).toBe(0);
    expect(decodeTextDict(packed.dict, packed.indices)).toEqual([]);
  });

  it('treats missing entries (undefined/null) as empty strings to mirror encodeText', () => {
    const xs = ['A', undefined as any, 'A', null as any];
    const packed = encodeTextDict(xs);
    expect(packed.dict).toContain('');
    expect(decodeTextDict(packed.dict, packed.indices)).toEqual(['A', '', 'A', '']);
  });
});
