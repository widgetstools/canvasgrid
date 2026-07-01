import { describe, it, expect } from 'vitest';
import { encodeText } from '../src/worker/chunkFormat';
import {
  rawNumericAt, rawTextAt, rawRowKindAt, RawTextDecoder,
} from '../src/core/rawCellAccess';

/**
 * Cycle 25 / Task 6 — direct typed-array views into the worker chunk.
 *
 * The existing `cgrid.cellAt(rowIndex, colId)` allocates a fresh
 * `{ value, valueFormatted, flashAlpha }` object per cell. That's
 * fine in the paint loop because the result feeds into one paint per
 * frame — but for apps that need cell-by-cell reads at high rates
 * (custom export, programmatic scrubbing, GPU upload), the
 * allocations dominate. The helpers below skip the object and read
 * straight out of `numericCols[colId]` (Float64Array) and
 * `textCols[colId]` (offsets + bytes), so the per-cell cost is one
 * typed-array load.
 *
 * `RawTextDecoder` is a tiny per-column decode cache so repeated
 * reads of the same text column don't re-decode every offset.
 */

function makeChunk() {
  return {
    rowStart: 100,
    rowCount: 4,
    rowIds: new Uint32Array([10, 11, 12, 13]),
    rowKinds: new Uint8Array([0, 0, 1, 3]),
    groupDepth: new Uint8Array(4),
    heights: new Float32Array(4).fill(30),
    numericCols: {
      price: new Float64Array([10.5, 20.5, 0, 0]),
    },
    textCols: {
      name: encodeText(['apple', 'banana', '', '']),
    },
  } as any;
}

describe('rawNumericAt', () => {
  it('returns the typed-array value at the row-local index', () => {
    const chunk = makeChunk();
    expect(rawNumericAt(chunk, 0, 'price')).toBe(10.5);
    expect(rawNumericAt(chunk, 1, 'price')).toBe(20.5);
  });

  it('returns undefined for an unknown column', () => {
    const chunk = makeChunk();
    expect(rawNumericAt(chunk, 0, 'nope')).toBeUndefined();
  });

  it('returns undefined for an out-of-range row', () => {
    const chunk = makeChunk();
    expect(rawNumericAt(chunk, -1, 'price')).toBeUndefined();
    expect(rawNumericAt(chunk, 5, 'price')).toBeUndefined();
  });
});

describe('rawTextAt', () => {
  it('decodes a text cell directly from the chunk', () => {
    const chunk = makeChunk();
    expect(rawTextAt(chunk, 0, 'name')).toBe('apple');
    expect(rawTextAt(chunk, 1, 'name')).toBe('banana');
  });

  it('returns empty string for an unknown column', () => {
    const chunk = makeChunk();
    expect(rawTextAt(chunk, 0, 'nope')).toBe('');
  });

  it('caches per-column decode work', () => {
    const chunk = makeChunk();
    const cache = new RawTextDecoder();
    const a = rawTextAt(chunk, 0, 'name', cache);
    const b = rawTextAt(chunk, 0, 'name', cache);
    expect(a).toBe(b);
    expect(a).toBe('apple');
  });
});

describe('rawRowKindAt', () => {
  it('reads the rowKinds typed array directly', () => {
    const chunk = makeChunk();
    expect(rawRowKindAt(chunk, 0)).toBe(0);
    expect(rawRowKindAt(chunk, 2)).toBe(1);
    expect(rawRowKindAt(chunk, 3)).toBe(3);
  });
});
