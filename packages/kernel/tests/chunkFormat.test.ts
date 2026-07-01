import { describe, it, expect } from 'vitest';
import { encodeText, decodeText } from '../src/worker/chunkFormat';

describe('chunkFormat', () => {
  it('round-trips ASCII', () => {
    const input = ['apple', 'banana', '', 'cherry'];
    const { offsets, bytes } = encodeText(input);
    expect(decodeText(offsets, bytes)).toEqual(input);
  });

  it('round-trips unicode', () => {
    const input = ['日本語', '🍎', 'ümläut'];
    const { offsets, bytes } = encodeText(input);
    expect(decodeText(offsets, bytes)).toEqual(input);
  });

  it('offsets has length n+1', () => {
    const { offsets } = encodeText(['a', 'b', 'c']);
    expect(offsets.length).toBe(4);
  });
});
