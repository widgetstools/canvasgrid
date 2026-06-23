import { describe, it, expect } from 'vitest';
import { collectViewportTransferables, type ViewportChunk } from '../src/worker/protocol';

describe('collectViewportTransferables', () => {
  it('includes all typed-array buffers', () => {
    const chunk: ViewportChunk = {
      rowStart: 0,
      rowCount: 2,
      rowIds: new Uint32Array(2),
      rowKinds: new Uint8Array(2),
      groupDepth: new Uint8Array(2),
      numericCols: { a: new Float64Array(2), b: new Float64Array(2) },
      textCols: { c: { offsets: new Uint32Array(3), bytes: new Uint8Array(4) } },
      flashMask: new Uint8Array(1),
    };
    const xfer = collectViewportTransferables(chunk);
    // Expected: rowIds + rowKinds + groupDepth + 2 numeric + 2 text (offsets + bytes) + flashMask = 8
    expect(xfer).toHaveLength(8);
  });
});
