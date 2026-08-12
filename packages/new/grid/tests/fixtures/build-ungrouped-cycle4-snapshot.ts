/**
 * Cycle 15 / Task 3 — fixture generator for the ungrouped Cycle 4
 * snapshot used by `chunkFormat.group.test.ts`. Produces a binary
 * `ungrouped-cycle4-snapshot.bin` representing a `ViewportChunk` in the
 * pre-Task-3 shape (no `groupValue / groupChildCount / isExpanded`
 * fields), serialized as wire version `1`.
 *
 * The fixture isn't generated at test time so the binary checked into
 * `tests/fixtures/` is the source of truth for "what a Cycle 4 era
 * chunk looked like on the wire". Re-running this script overwrites
 * the file in-place; the script's source is the canonical recipe.
 *
 * Run with:
 *   npx tsx cgrid/tests/fixtures/build-ungrouped-cycle4-snapshot.ts
 *
 * (Or via `node --import tsx ...` on tsx-less setups.) The output is
 * committed verbatim alongside the test.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serializeChunk, encodeText } from '../../src/worker/chunkFormat';
import type { ViewportChunk } from '../../src/worker/protocol';

function buildCycle4Chunk(): ViewportChunk {
  const rowCount = 3;
  const rowIds = new Uint32Array([1001, 1002, 1003]);
  const rowKinds = new Uint8Array(rowCount);  // all data rows
  const groupDepth = new Uint8Array(rowCount);
  const heights = new Float32Array([28, 28, 28]);

  const ticker = encodeText(['AAPL', 'MSFT', 'GOOG']);
  return {
    rowStart: 0,
    rowCount,
    rowIds,
    rowKinds,
    groupDepth,
    heights,
    numericCols: { price: new Float64Array([182.5, 415.25, 138.75]) },
    textCols: { ticker },
    // No group fields — this snapshot models the wire shape before
    // Task 3 added them.
  };
}

function main(): void {
  const chunk = buildCycle4Chunk();
  const bytes = serializeChunk(chunk, { version: 1 });
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, 'ungrouped-cycle4-snapshot.bin');
  writeFileSync(outPath, bytes);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${bytes.byteLength} bytes to ${outPath}`);
}

main();
