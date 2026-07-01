/**
 * Cycle 25 / Task 7 — GPU-friendly flash alpha mask.
 *
 * Builds a flat `Float32Array(rows × cols)` indexed by
 * `r * cols + c` containing the per-cell flash alpha for the current
 * frame. The painter reads the mask by index — no Map lookup, no
 * string concat, no per-cell allocation. The same buffer can be
 * uploaded to a GPU texture for a future composited overlay (one
 * draw call instead of one per cell).
 *
 * The function preserves the caller's `out` buffer when shapes match
 * so the renderer can reuse a single mask across frames.
 */

import type { FlashRegistry } from './flashRegistry';

export interface BuildFlashAlphaMaskInput {
  registry: FlashRegistry;
  rowIds: Uint32Array | readonly number[];
  colIds: readonly string[];
  now: number;
  /** Optional reusable buffer. Returned as-is when its length matches
   *  `rowIds.length × colIds.length`; otherwise a fresh
   *  `Float32Array` is allocated. */
  out?: Float32Array;
}

export function buildFlashAlphaMask(input: BuildFlashAlphaMaskInput): Float32Array {
  const { registry, rowIds, colIds, now } = input;
  const rowCount = rowIds.length;
  const colCount = colIds.length;
  const totalCells = rowCount * colCount;
  const mask = input.out && input.out.length === totalCells
    ? input.out
    : new Float32Array(totalCells);
  if (totalCells === 0) return mask;
  // Zero the buffer when reused — the registry's `getAlpha` returns 0
  // for non-flashing cells, but writing 0 explicitly is what makes a
  // reused buffer safe to consume.
  if (input.out === mask) mask.fill(0);
  for (let r = 0; r < rowCount; r++) {
    const rowId = (rowIds as ArrayLike<number>)[r]!;
    const base = r * colCount;
    for (let c = 0; c < colCount; c++) {
      const a = registry.getAlpha(rowId, colIds[c]!, now);
      if (a !== 0) mask[base + c] = a;
    }
  }
  return mask;
}
