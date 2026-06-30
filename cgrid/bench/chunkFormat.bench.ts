/**
 * Cycle 25 / Task 1 — chunkFormat encode/decode benchmarks.
 *
 * The chunkFormat module is on the worker→main hot path: every
 * viewport response runs through `serializeChunk` (worker side) and
 * `deserializeChunk` (main side). Throughput here is one of the
 * primary determinants of scroll FPS on large grids.
 *
 * Run: `npx vitest bench --run bench/chunkFormat.bench.ts` from cgrid/.
 * Baselines committed in `bench/baselines.json`.
 */

import { bench, describe } from 'vitest';
import {
  encodeText, decodeText, serializeChunk, deserializeChunk,
} from '../src/worker/chunkFormat';

// ─── Text encode/decode ──────────────────────────────────────────────────

const SHORT = Array.from({ length: 10_000 }, (_, i) =>
  ['APAC', 'EMEA', 'AMER', 'LATAM'][i % 4]!);
const LONG = Array.from({ length: 10_000 }, (_, i) =>
  `Long descriptive text for row ${i} with some repeated content that mimics real-world catalog data`);

describe('chunkFormat — text encode/decode', () => {
  bench('encodeText short (10k rows × 4 distinct)', () => {
    encodeText(SHORT);
  });

  bench('encodeText long (10k rows × ~90 chars)', () => {
    encodeText(LONG);
  });

  const shortBlob = encodeText(SHORT);
  const longBlob = encodeText(LONG);

  bench('decodeText short', () => {
    decodeText(shortBlob.offsets, shortBlob.bytes);
  });

  bench('decodeText long', () => {
    decodeText(longBlob.offsets, longBlob.bytes);
  });
});

// ─── Chunk serialize/deserialize ─────────────────────────────────────────

function makeChunk(rowCount: number, textCols = 3, numCols = 5) {
  const numericCols: Record<string, Float64Array> = {};
  for (let c = 0; c < numCols; c++) {
    const arr = new Float64Array(rowCount);
    for (let r = 0; r < rowCount; r++) arr[r] = r * 1.5 + c * 100;
    numericCols[`num${c}`] = arr;
  }
  const textColsObj: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};
  for (let c = 0; c < textCols; c++) {
    const strings = Array.from({ length: rowCount }, (_, i) =>
      ['APAC', 'EMEA', 'AMER', 'LATAM', 'GBL'][i % 5]!);
    textColsObj[`text${c}`] = encodeText(strings);
  }
  return {
    rowStart: 0,
    rowCount,
    rowIds: new Uint32Array(Array.from({ length: rowCount }, (_, i) => i)),
    rowKinds: new Uint8Array(rowCount),
    groupDepth: new Uint8Array(rowCount),
    heights: new Float32Array(rowCount).fill(30),
    numericCols,
    textCols: textColsObj,
  } as any;
}

describe('chunkFormat — serialize/deserialize', () => {
  const c1k = makeChunk(1_000);
  const c10k = makeChunk(10_000);
  const c50k = makeChunk(50_000);

  bench('serializeChunk 1k × 8', () => {
    serializeChunk(c1k);
  });

  bench('serializeChunk 10k × 8', () => {
    serializeChunk(c10k);
  });

  bench('serializeChunk 50k × 8', () => {
    serializeChunk(c50k);
  });

  const bytes1k = serializeChunk(c1k);
  const bytes10k = serializeChunk(c10k);
  const bytes50k = serializeChunk(c50k);

  bench('deserializeChunk 1k × 8', () => {
    deserializeChunk(bytes1k);
  });

  bench('deserializeChunk 10k × 8', () => {
    deserializeChunk(bytes10k);
  });

  bench('deserializeChunk 50k × 8', () => {
    deserializeChunk(bytes50k);
  });
});
