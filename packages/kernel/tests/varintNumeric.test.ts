import { describe, it, expect } from 'vitest';
import {
  encodeVarintI32, decodeVarintI32,
  encodeDeltaInts, decodeDeltaInts,
} from '../src/worker/chunkFormat';

/**
 * Cycle 25 / Task 3 — varint + delta numeric columns.
 *
 * Two helpers for compressing numeric columns:
 *
 *  • `encodeVarintI32` / `decodeVarintI32` — variable-length encoding
 *    of signed 32-bit ints. Zigzag-maps the sign into the low bit so
 *    `-1` → `1` → 1 byte. Small magnitudes (the common case for
 *    counts, indices, timestamps-as-day-offsets) pack into 1–2 bytes
 *    instead of the 8 bytes a Float64 takes.
 *
 *  • `encodeDeltaInts` / `decodeDeltaInts` — first-difference encoding
 *    over the same varint stream. Sorted / sequence-y columns
 *    (rowIds, IDs that grow, timestamps a few seconds apart) become
 *    nearly all small deltas which then varint to 1 byte each.
 *
 * These are pure helpers. Rewiring `serializeChunk` to emit
 * varint-coded numeric columns under a new chunk-format version flag
 * is the follow-up that closes Task 3.
 */

describe('encodeVarintI32 / decodeVarintI32', () => {
  it('round-trips 0', () => {
    const bytes = encodeVarintI32([0]);
    expect(bytes.length).toBe(1);
    expect(decodeVarintI32(bytes, 1)).toEqual([0]);
  });

  it('round-trips small positives and negatives in 1 byte each', () => {
    const xs = [1, -1, 5, -5, 63, -63];
    const bytes = encodeVarintI32(xs);
    expect(bytes.length).toBe(xs.length);
    expect(decodeVarintI32(bytes, xs.length)).toEqual(xs);
  });

  it('round-trips large magnitudes correctly', () => {
    const xs = [0, 1_000_000, -1_000_000, 2_147_483_647, -2_147_483_648];
    const bytes = encodeVarintI32(xs);
    expect(decodeVarintI32(bytes, xs.length)).toEqual(xs);
  });

  it('packs smaller than Int32Array for low-magnitude data', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i % 100);
    const bytes = encodeVarintI32(xs);
    expect(bytes.length).toBeLessThan(4 * xs.length);
  });
});

describe('encodeDeltaInts / decodeDeltaInts', () => {
  it('round-trips a monotonic sequence into mostly 1-byte deltas', () => {
    const xs = [10, 11, 12, 14, 17, 20];
    const bytes = encodeDeltaInts(xs);
    expect(decodeDeltaInts(bytes, xs.length)).toEqual(xs);
    // 6 ints starting at 10 with small deltas pack into a handful of bytes
    expect(bytes.length).toBeLessThan(4 * xs.length);
  });

  it('handles empty input', () => {
    const bytes = encodeDeltaInts([]);
    expect(decodeDeltaInts(bytes, 0)).toEqual([]);
  });

  it('round-trips a sequence with descending values (negative deltas)', () => {
    const xs = [100, 90, 80, 75, 70];
    const bytes = encodeDeltaInts(xs);
    expect(decodeDeltaInts(bytes, xs.length)).toEqual(xs);
  });

  it('packs sequential rowIds (1..1000) far smaller than the equivalent Uint32Array', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i + 1);
    const bytes = encodeDeltaInts(xs);
    // Each delta is 1 → 1 byte each; total ~1001 bytes vs 4000 for Uint32Array.
    expect(bytes.length).toBeLessThan(1500);
    expect(decodeDeltaInts(bytes, xs.length)).toEqual(xs);
  });
});
