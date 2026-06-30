/**
 * Cycle 25 / Task 6 — direct typed-array reads against a ViewportChunk.
 *
 * cgrid's `cellAt(rowIndex, colId)` returns a fresh
 * `{ value, valueFormatted, flashAlpha }` object per call. That's
 * cheap once per paint, but apps that need cell-by-cell reads at
 * high rates (custom export, programmatic scrubbing, GPU upload)
 * pay an object allocation per read. These helpers skip the object
 * and load the value straight from the chunk's typed arrays.
 *
 * Caveats: these helpers do NOT honor the auto-group / pivot /
 * footer / group-row paths `cgrid.cellAt` implements. Use them
 * against plain data rows (rowKind 0); for everything else, go
 * through `cgrid.cellAt`.
 */

import { decodeText } from '../worker/chunkFormat';
import type { ViewportChunk } from '../worker/protocol';

/** Per-column decode cache. One instance per call site that batches
 *  many reads — most useful when reading the same text column for
 *  many rows. Reuse across chunks is safe; the cache keys by column
 *  id and the chunk's text-col reference (which changes when the
 *  chunk is replaced). */
export class RawTextDecoder {
  private cache = new Map<string, { source: { offsets: Uint32Array; bytes: Uint8Array }; values: string[] }>();

  decode(chunk: ViewportChunk, colId: string): string[] | undefined {
    const tc = chunk.textCols[colId];
    if (!tc) return undefined;
    const hit = this.cache.get(colId);
    if (hit && hit.source === tc) return hit.values;
    const values = decodeText(tc.offsets, tc.bytes);
    this.cache.set(colId, { source: tc, values });
    return values;
  }
}

const sharedTextDecoder = new RawTextDecoder();

function localIndex(chunk: ViewportChunk, localRowIndex: number): number {
  if (localRowIndex < 0 || localRowIndex >= chunk.rowCount) return -1;
  return localRowIndex;
}

export function rawNumericAt(
  chunk: ViewportChunk,
  localRowIndex: number,
  colId: string,
): number | undefined {
  const i = localIndex(chunk, localRowIndex);
  if (i < 0) return undefined;
  const col = chunk.numericCols[colId];
  if (!col) return undefined;
  return col[i];
}

export function rawTextAt(
  chunk: ViewportChunk,
  localRowIndex: number,
  colId: string,
  decoder: RawTextDecoder = sharedTextDecoder,
): string {
  const i = localIndex(chunk, localRowIndex);
  if (i < 0) return '';
  const values = decoder.decode(chunk, colId);
  if (!values) return '';
  return values[i] ?? '';
}

export function rawRowKindAt(chunk: ViewportChunk, localRowIndex: number): number {
  const i = localIndex(chunk, localRowIndex);
  if (i < 0) return 0;
  return chunk.rowKinds[i] ?? 0;
}
