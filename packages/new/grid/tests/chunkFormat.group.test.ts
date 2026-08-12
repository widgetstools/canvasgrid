/**
 * Cycle 15 / Task 3 — chunk-format extension tests.
 *
 * Verifies the append-only `ViewportChunk` extension that introduces
 * `groupValue / groupChildCount / isExpanded` parallel arrays. The
 * critical regression guard is the round-trip of an UNGROUPED chunk
 * captured from a Cycle 4 era serializer (binary fixture committed in
 * `tests/fixtures/ungrouped-cycle4-snapshot.bin`) — proves new
 * readers stay compatible with the wire shape downstream code already
 * relies on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  serializeChunk,
  deserializeChunk,
  estimateChunkSize,
  encodeText,
  decodeText,
} from '../src/worker/chunkFormat';
import {
  CHUNK_FORMAT_VERSION,
  normalizeViewportChunk,
  type ViewportChunk,
} from '../src/worker/protocol';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function makeDataOnlyChunk(): ViewportChunk {
  const rowCount = 4;
  return {
    rowStart: 0,
    rowCount,
    rowIds: new Uint32Array([10, 20, 30, 40]),
    rowKinds: new Uint8Array(rowCount),
    groupDepth: new Uint8Array(rowCount),
    heights: new Float32Array([24, 24, 24, 24]),
    numericCols: { qty: new Float64Array([1, 2, 3, 4]) },
    textCols: { sym: encodeText(['A', 'B', 'C', 'D']) },
  };
}

function makeGroupedChunk(): ViewportChunk {
  // Mirrors the post-Task-3 wire shape: one group row at index 0 with
  // three data children. groupValue / childCount / isExpanded populate
  // the group slot; data slots get the documented defaults.
  const rowCount = 4;
  const rowKinds = new Uint8Array([1, 0, 0, 0]);   // group, data, data, data
  const groupDepth = new Uint8Array([0, 1, 1, 1]);
  const isExpanded = new Uint8Array([1, 1, 1, 1]);
  const groupChildCount = new Uint32Array([3, 0, 0, 0]);
  return {
    rowStart: 0,
    rowCount,
    rowIds: new Uint32Array([0, 11, 22, 33]),
    rowKinds,
    groupDepth,
    heights: new Float32Array([24, 24, 24, 24]),
    numericCols: { qty: new Float64Array([0, 1, 2, 3]) },
    textCols: { sym: encodeText(['', 'AAPL', 'AAPL', 'AAPL']) },
    groupValue: ['Apple Inc.', '', '', ''],
    groupChildCount,
    isExpanded,
    flashMask: new Uint8Array([0b0001]),
    totals: { qty: 6 },
  };
}

describe('chunkFormat — group field extension', () => {
  it('round-trips a data-only chunk (defaults appear in deserialized output)', () => {
    const chunk = makeDataOnlyChunk();
    const bytes = serializeChunk(chunk);
    const round = deserializeChunk(bytes);

    expect(round.rowCount).toBe(chunk.rowCount);
    expect(Array.from(round.rowIds)).toEqual(Array.from(chunk.rowIds));
    expect(Array.from(round.rowKinds)).toEqual(Array.from(chunk.rowKinds));
    expect(Array.from(round.heights)).toEqual(Array.from(chunk.heights));
    expect(Array.from(round.numericCols.qty!)).toEqual([1, 2, 3, 4]);

    // Even though the source chunk omitted the v2 fields, the v2
    // deserializer fills sensible defaults so downstream consumers
    // never have to branch.
    expect(round.groupValue).toEqual(['', '', '', '']);
    expect(Array.from(round.groupChildCount!)).toEqual([0, 0, 0, 0]);
    expect(Array.from(round.isExpanded!)).toEqual([1, 1, 1, 1]);
  });

  it('round-trips a grouped chunk lossless', () => {
    const chunk = makeGroupedChunk();
    const bytes = serializeChunk(chunk);
    const round = deserializeChunk(bytes);

    expect(round.groupValue).toEqual(['Apple Inc.', '', '', '']);
    expect(Array.from(round.groupChildCount!)).toEqual([3, 0, 0, 0]);
    expect(Array.from(round.isExpanded!)).toEqual([1, 1, 1, 1]);
    expect(Array.from(round.rowKinds)).toEqual([1, 0, 0, 0]);
    expect(Array.from(round.groupDepth)).toEqual([0, 1, 1, 1]);
    expect(Array.from(round.flashMask!)).toEqual([0b0001]);
    expect(round.totals).toEqual({ qty: 6 });
  });

  it('serialize → deserialize preserves text column UTF-8 (multibyte values)', () => {
    const rowCount = 3;
    const chunk: ViewportChunk = {
      rowStart: 0,
      rowCount,
      rowIds: new Uint32Array(rowCount),
      rowKinds: new Uint8Array(rowCount),
      groupDepth: new Uint8Array(rowCount),
      heights: new Float32Array(rowCount),
      numericCols: {},
      textCols: { name: encodeText(['日本語', '🍎', 'ümläut']) },
      groupValue: ['', '', ''],
      groupChildCount: new Uint32Array(rowCount),
      isExpanded: new Uint8Array([1, 1, 1]),
    };
    const round = deserializeChunk(serializeChunk(chunk));
    const decoded = decodeText(round.textCols.name!.offsets, round.textCols.name!.bytes);
    expect(decoded).toEqual(['日本語', '🍎', 'ümläut']);
  });

  it('handles a chunk where only rowKind differs (partial-fields)', () => {
    // groupChildCount + isExpanded absent on the source; rowKind set.
    const rowCount = 2;
    const chunk: ViewportChunk = {
      rowStart: 0,
      rowCount,
      rowIds: new Uint32Array([7, 8]),
      rowKinds: new Uint8Array([1, 0]),
      groupDepth: new Uint8Array([0, 1]),
      heights: new Float32Array(rowCount),
      numericCols: {},
      textCols: {},
      groupValue: ['parent', ''],
      // groupChildCount + isExpanded intentionally omitted on the
      // serialized side. Deserializer must still reconstruct them
      // with default values rather than reading bytes beyond the
      // payload.
    };
    const round = deserializeChunk(serializeChunk(chunk));
    expect(round.groupValue).toEqual(['parent', '']);
    expect(Array.from(round.groupChildCount!)).toEqual([0, 0]);
    expect(Array.from(round.isExpanded!)).toEqual([1, 1]);
  });

  it('round-trips a large-string groupValue (>64 bytes UTF-8 to verify offset math)', () => {
    const longLabel = 'Group_'.repeat(100);    // >600 bytes
    const rowCount = 2;
    const chunk: ViewportChunk = {
      rowStart: 0,
      rowCount,
      rowIds: new Uint32Array([1, 2]),
      rowKinds: new Uint8Array([1, 0]),
      groupDepth: new Uint8Array([0, 1]),
      heights: new Float32Array(rowCount),
      numericCols: {},
      textCols: {},
      groupValue: [longLabel, ''],
      groupChildCount: new Uint32Array([5, 0]),
      isExpanded: new Uint8Array([1, 1]),
    };
    const round = deserializeChunk(serializeChunk(chunk));
    expect(round.groupValue![0]).toBe(longLabel);
    expect(round.groupValue![1]).toBe('');
    expect(round.groupChildCount![0]).toBe(5);
  });

  it('treats null / undefined groupValue entries as empty strings via normalize()', () => {
    // The wire format itself takes string[]; normalizeViewportChunk is
    // what callers consuming structured-clone chunks invoke. Verify it
    // tolerates missing fields by injecting sensible defaults.
    const partial: ViewportChunk = {
      rowStart: 0,
      rowCount: 3,
      rowIds: new Uint32Array(3),
      rowKinds: new Uint8Array([1, 0, 0]),
      groupDepth: new Uint8Array([0, 1, 1]),
      heights: new Float32Array(3),
      numericCols: {},
      textCols: {},
      // No group fields at all (v1 chunk).
    };
    const normalized = normalizeViewportChunk(partial);
    expect(normalized.groupValue).toEqual(['', '', '']);
    expect(Array.from(normalized.groupChildCount!)).toEqual([0, 0, 0]);
    expect(Array.from(normalized.isExpanded!)).toEqual([1, 1, 1]);
  });

  it('round-trips the ungrouped Cycle 4 fixture (binary file)', () => {
    const fixturePath = join(fixturesDir, 'ungrouped-cycle4-snapshot.bin');
    const bytes = readFileSync(fixturePath);
    const decoded = deserializeChunk(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));

    // The fixture was produced by `serializeChunk(chunk, { version: 1 })`
    // — i.e. no group fields written. v2 reader fills defaults.
    expect(decoded.rowCount).toBe(3);
    expect(Array.from(decoded.rowIds)).toEqual([1001, 1002, 1003]);
    expect(decoded.numericCols.price).toBeDefined();
    expect(Array.from(decoded.numericCols.price!)).toEqual([182.5, 415.25, 138.75]);
    expect(decoded.textCols.ticker).toBeDefined();
    const tickers = decodeText(decoded.textCols.ticker!.offsets, decoded.textCols.ticker!.bytes);
    expect(tickers).toEqual(['AAPL', 'MSFT', 'GOOG']);

    // Critical: defaults appear for the v2-only fields even though the
    // wire payload was version 1.
    expect(decoded.groupValue).toEqual(['', '', '']);
    expect(Array.from(decoded.groupChildCount!)).toEqual([0, 0, 0]);
    expect(Array.from(decoded.isExpanded!)).toEqual([1, 1, 1]);
  });

  it('rejects a payload with a bad magic header', () => {
    const garbage = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(() => deserializeChunk(garbage)).toThrow(/bad magic/);
  });

  it('rejects an unsupported version', () => {
    // Build a v2 chunk, then tamper with the version byte to a future
    // value the deserializer doesn't know.
    const chunk = makeDataOnlyChunk();
    const bytes = serializeChunk(chunk);
    bytes[4] = 99;   // version byte
    expect(() => deserializeChunk(bytes)).toThrow(/unsupported version/);
  });

  it('estimateChunkSize matches actual serialized length within 1 byte', () => {
    const chunk = makeGroupedChunk();
    const estimate = estimateChunkSize(chunk);
    const actual = serializeChunk(chunk).byteLength;
    expect(Math.abs(estimate - actual)).toBeLessThanOrEqual(1);
  });
});

describe('chunkFormat — version awareness', () => {
  it('CHUNK_FORMAT_VERSION is 2 (Cycle 15 / Task 3 baseline)', () => {
    expect(CHUNK_FORMAT_VERSION).toBe(2);
  });
});
