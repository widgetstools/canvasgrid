/**
 * Master / detail — the display-space row index.
 *
 * A detail row is not data. It has no rowId of its own, contributes nothing to
 * a filter, a sort, an aggregate or a group tree, and the worker never needs to
 * know it exists. What it IS, is one extra row slot in the DISPLAYED order,
 * sitting immediately below its master, holding a nested grid the canvas does
 * not paint.
 *
 * So master/detail lives entirely on the main thread, and this module is the
 * whole of its index arithmetic. The worker keeps producing the base visible
 * order (post filter / group / sort). Main holds the sorted list of BASE
 * indices whose rows are expanded, and translates in both directions:
 *
 *   base    what the worker counts, slices and reports — no detail rows
 *   display what the viewport scrolls, the painter walks and the user clicks
 *
 * Two consequences worth stating, because they are why the split is drawn
 * here rather than in the worker:
 *
 *   1. Expanding a row cannot invalidate the pipeline. No refilter, no
 *      regroup, no resort, no chunk refetch beyond the window that moved.
 *   2. Nothing downstream of `expandChunk` needs a master/detail branch. The
 *      chunk that reaches the painter is already in display space with the
 *      detail rows carrying `rowKind === ROW_KIND_DETAIL`, exactly the way
 *      group and footer rows arrive as synthetic slots from the worker.
 *
 * The expanded set is small by construction — AG Grid caps live detail grids
 * at ten — so `positions` is a plain sorted array and every lookup is a binary
 * search over it.
 */

import type { ViewportChunk } from '../worker/protocol';

/**
 * Row kind for a detail row, continuing the chunk's existing vocabulary
 * (0 = leaf, 1 = group, 2 = grandTotal, 3 = footer). Unlike those four this
 * one is stamped main-side by {@link MasterDetailIndex.expandChunk}; the
 * worker never emits it.
 */
export const ROW_KIND_DETAIL = 4;

/** Resolution of a display row index against the base order. */
export interface DisplayRowRef {
  /**
   * Base index this display row maps to. For a detail row this is its
   * MASTER's base index — the detail has no base index of its own.
   */
  base: number;
  /** True when the display row is a detail row rather than a real row. */
  isDetail: boolean;
}

export class MasterDetailIndex {
  /** Base indices of the currently-expanded master rows, ascending. */
  private positions: number[] = [];

  /** Replace the expanded-position list. Input need not be sorted; entries
   *  below zero (a master hidden inside a collapsed group resolves to -1)
   *  are dropped, as are duplicates. Returns `true` when the resulting list
   *  differs from the previous one — callers use that to skip a viewport
   *  recompute that would change nothing. */
  setPositions(next: readonly number[]): boolean {
    const cleaned: number[] = [];
    for (const p of next) {
      if (!Number.isInteger(p) || p < 0) continue;
      cleaned.push(p);
    }
    cleaned.sort((a, b) => a - b);
    // Dedupe in place — two masters cannot share a base index, but a stale
    // resolve racing a fresh one can hand us the same index twice.
    let w = 0;
    for (let i = 0; i < cleaned.length; i++) {
      if (i > 0 && cleaned[i] === cleaned[i - 1]) continue;
      cleaned[w++] = cleaned[i]!;
    }
    cleaned.length = w;
    if (cleaned.length === this.positions.length) {
      let same = true;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] !== this.positions[i]) { same = false; break; }
      }
      if (same) return false;
    }
    this.positions = cleaned;
    return true;
  }

  /** Number of detail rows currently in the display order. */
  get count(): number { return this.positions.length; }

  /** True when no row is expanded — every mapping below is the identity and
   *  callers can take their pre-master-detail path unchanged. */
  get isEmpty(): boolean { return this.positions.length === 0; }

  /** Base indices of the expanded masters, ascending. Read-only view. */
  get expandedBaseIndices(): readonly number[] { return this.positions; }

  /** Total displayed rows for a base row count. */
  displayCount(baseCount: number): number {
    return baseCount + this.positions.length;
  }

  /** Display index of the row at base index `b`. */
  displayOfBase(b: number): number {
    return b + this.countBelow(b);
  }

  /** Resolve a display index back to the base order. */
  resolve(d: number): DisplayRowRef {
    const j = this.lastDetailAtOrBefore(d);
    if (j < 0) return { base: d, isDetail: false };
    const detailDisplay = this.positions[j]! + j + 1;
    if (detailDisplay === d) return { base: this.positions[j]!, isDetail: true };
    return { base: d - (j + 1), isDetail: false };
  }

  /** True when `d` is a detail row's display index. */
  isDetailRow(d: number): boolean {
    const j = this.lastDetailAtOrBefore(d);
    return j >= 0 && this.positions[j]! + j + 1 === d;
  }

  /** Display index of the detail row belonging to the master at base `b`,
   *  or -1 when that master is not expanded. */
  detailDisplayForBase(b: number): number {
    const j = this.indexOf(b);
    return j < 0 ? -1 : b + j + 1;
  }

  /**
   * Widen a DISPLAY window into the BASE window that covers it.
   *
   * A detail row is produced from its master's chunk slot, so a window whose
   * first row is a detail must still fetch that master; `resolve` already
   * returns the master's base index for a detail row, which is what makes the
   * start clamp correct without a special case.
   */
  mapWindowToBase(dStart: number, dEnd: number): { rowStart: number; rowEnd: number } {
    if (this.positions.length === 0) return { rowStart: dStart, rowEnd: dEnd };
    const start = Math.max(0, dStart);
    const end = Math.max(start, dEnd);
    const bStart = this.resolve(start).base;
    // `end` is exclusive, so the last row in the window is `end - 1`.
    const bEnd = end > start ? this.resolve(end - 1).base + 1 : bStart;
    return { rowStart: bStart, rowEnd: Math.max(bStart, bEnd) };
  }

  /**
   * Rewrite a base-space chunk into display space, splicing one detail slot in
   * after every expanded master the chunk covers.
   *
   * The detail slot is deliberately shaped like the synthetic rows the worker
   * already ships: zero numeric id, blank cells, its own row height. It
   * carries the master's STRING row id in `stringRowIds` — that is how the
   * detail-grid host knows which master a band belongs to, and it is also what
   * keeps the window-diff's row-identity check (`rowIds` + `rowKinds` +
   * `groupKey`) from ever confusing two detail rows for each other.
   *
   * Returns `chunk` untouched when nothing is expanded.
   */
  expandChunk(chunk: ViewportChunk, detailRowHeight: number): ViewportChunk {
    if (this.positions.length === 0) return chunk;
    const bStart = chunk.rowStart;
    const n = chunk.rowCount;
    // Which of the covered base rows are expanded, in window order.
    const inserts: number[] = [];   // local base offsets that gain a detail row
    for (let i = 0; i < n; i++) {
      if (this.indexOf(bStart + i) >= 0) inserts.push(i);
    }
    if (inserts.length === 0) {
      // Nothing expanded inside this window, but the window still starts at a
      // shifted display index.
      return { ...chunk, rowStart: this.displayOfBase(bStart) };
    }

    const outCount = n + inserts.length;
    // `srcOf[o]` = base-local slot that fed output slot `o`, or -1 for a
    // detail slot. Built once and reused by every column re-pack below.
    const srcOf = new Int32Array(outCount);
    const masterOf = new Int32Array(outCount).fill(-1);
    {
      let o = 0;
      let k = 0;
      for (let i = 0; i < n; i++) {
        srcOf[o] = i;
        o++;
        if (k < inserts.length && inserts[k] === i) {
          srcOf[o] = -1;
          masterOf[o] = i;
          o++;
          k++;
        }
      }
    }

    const rowIds = new Uint32Array(outCount);
    const rowKinds = new Uint8Array(outCount);
    const groupDepth = new Uint8Array(outCount);
    const heights = new Float32Array(outCount);
    const stringRowIds: string[] = new Array<string>(outCount).fill('');
    const groupValue: string[] = new Array<string>(outCount).fill('');
    const groupKey: string[] = new Array<string>(outCount).fill('');
    const groupChildCount = new Uint32Array(outCount);
    const isExpanded = new Uint8Array(outCount);
    isExpanded.fill(1);

    const srcStringIds = chunk.stringRowIds;
    const srcGroupValue = chunk.groupValue;
    const srcGroupKey = chunk.groupKey;
    const srcChildCount = chunk.groupChildCount;
    const srcExpanded = chunk.isExpanded;

    for (let o = 0; o < outCount; o++) {
      const i = srcOf[o]!;
      if (i < 0) {
        rowKinds[o] = ROW_KIND_DETAIL;
        heights[o] = detailRowHeight;
        stringRowIds[o] = srcStringIds?.[masterOf[o]!] ?? '';
        continue;
      }
      rowIds[o] = chunk.rowIds[i] ?? 0;
      rowKinds[o] = chunk.rowKinds[i] ?? 0;
      groupDepth[o] = chunk.groupDepth[i] ?? 0;
      heights[o] = chunk.heights[i] ?? 0;
      if (srcStringIds) stringRowIds[o] = srcStringIds[i] ?? '';
      if (srcGroupValue) groupValue[o] = srcGroupValue[i] ?? '';
      if (srcGroupKey) groupKey[o] = srcGroupKey[i] ?? '';
      if (srcChildCount) groupChildCount[o] = srcChildCount[i] ?? 0;
      if (srcExpanded) isExpanded[o] = srcExpanded[i] ?? 1;
    }

    const numericCols: Record<string, Float64Array> = {};
    for (const colId of Object.keys(chunk.numericCols)) {
      const src = chunk.numericCols[colId]!;
      const out = new Float64Array(outCount);
      for (let o = 0; o < outCount; o++) {
        const i = srcOf[o]!;
        if (i >= 0) out[o] = src[i] ?? 0;
      }
      numericCols[colId] = out;
    }

    const textCols: Record<string, { offsets: Uint32Array; bytes: Uint8Array }> = {};
    for (const colId of Object.keys(chunk.textCols)) {
      textCols[colId] = spliceEmptyText(chunk.textCols[colId]!, srcOf, outCount);
    }

    return {
      ...chunk,
      rowStart: this.displayOfBase(bStart),
      rowCount: outCount,
      rowIds,
      stringRowIds,
      rowKinds,
      groupDepth,
      heights,
      groupValue,
      groupChildCount,
      isExpanded,
      groupKey,
      numericCols,
      textCols,
      flashMask: remapBitMask(chunk.flashMask, srcOf, outCount, colCountOf(chunk)),
      flashDir: remapByteMask(chunk.flashDir, srcOf, outCount, colCountOf(chunk)),
      touchedRows: remapTouched(chunk.touchedRows, srcOf, outCount),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Index of `b` in `positions`, or -1. */
  private indexOf(b: number): number {
    let lo = 0;
    let hi = this.positions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.positions[mid]!;
      if (v === b) return mid;
      if (v < b) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  /** Count of expanded positions strictly below `b`. */
  private countBelow(b: number): number {
    let lo = 0;
    let hi = this.positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.positions[mid]! < b) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /**
   * Largest `j` whose detail row sits at or before display index `d`, or -1.
   *
   * Detail row `j` lands at display index `positions[j] + j + 1`, and that
   * expression is strictly increasing in `j` (positions ascend), so a plain
   * binary search is valid.
   */
  private lastDetailAtOrBefore(d: number): number {
    let lo = 0;
    let hi = this.positions.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.positions[mid]! + mid + 1 <= d) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }
}

/** Column count a row-major cell mask was packed against. */
function colCountOf(chunk: ViewportChunk): number {
  if (chunk.rowCount === 0) return 0;
  if (chunk.flashDir) return Math.floor(chunk.flashDir.length / chunk.rowCount);
  // flashMask is bit-packed; the column count isn't recoverable from it
  // alone, so fall back to the numeric+text column tally the slicer used.
  return Object.keys(chunk.numericCols).length + Object.keys(chunk.textCols).length;
}

/**
 * Insert zero-length entries into an encoded text column.
 *
 * The encoding is `offsets[i] .. offsets[i + 1]` into a shared byte buffer, so
 * a blank cell is a duplicated offset and the bytes never move. Splicing costs
 * one small `Uint32Array` and no re-encode.
 */
function spliceEmptyText(
  col: { offsets: Uint32Array; bytes: Uint8Array },
  srcOf: Int32Array,
  outCount: number,
): { offsets: Uint32Array; bytes: Uint8Array } {
  const offsets = new Uint32Array(outCount + 1);
  let last = col.offsets[0] ?? 0;
  for (let o = 0; o < outCount; o++) {
    const i = srcOf[o]!;
    if (i < 0) {
      // Zero-length span at whatever byte position the previous row ended.
      offsets[o] = last;
      continue;
    }
    offsets[o] = col.offsets[i] ?? last;
    last = col.offsets[i + 1] ?? last;
  }
  offsets[outCount] = last;
  return { offsets, bytes: col.bytes };
}

/** Re-pack a row-major bit mask so each base row keeps its bits at its new
 *  display slot. Detail rows contribute no bits — they hold no cells. */
function remapBitMask(
  mask: Uint8Array | undefined,
  srcOf: Int32Array,
  outCount: number,
  colCount: number,
): Uint8Array | undefined {
  if (!mask || colCount <= 0) return mask;
  const totalBits = outCount * colCount;
  const out = new Uint8Array((totalBits + 7) >>> 3);
  for (let o = 0; o < outCount; o++) {
    const i = srcOf[o]!;
    if (i < 0) continue;
    for (let c = 0; c < colCount; c++) {
      const from = i * colCount + c;
      if (((mask[from >>> 3] ?? 0) & (1 << (from & 7))) === 0) continue;
      const to = o * colCount + c;
      out[to >>> 3]! |= 1 << (to & 7);
    }
  }
  return out;
}

/** Re-pack a row-major byte-per-cell array alongside {@link remapBitMask}. */
function remapByteMask(
  bytes: Uint8Array | undefined,
  srcOf: Int32Array,
  outCount: number,
  colCount: number,
): Uint8Array | undefined {
  if (!bytes || colCount <= 0) return bytes;
  const out = new Uint8Array(outCount * colCount);
  for (let o = 0; o < outCount; o++) {
    const i = srcOf[o]!;
    if (i < 0) continue;
    for (let c = 0; c < colCount; c++) {
      out[o * colCount + c] = bytes[i * colCount + c] ?? 0;
    }
  }
  return out;
}

/** Shift window-relative touched-row indices onto their display slots. */
function remapTouched(
  touched: Uint32Array | undefined,
  srcOf: Int32Array,
  outCount: number,
): Uint32Array | undefined {
  if (!touched) return undefined;
  // base-local → output-local, built by one walk of `srcOf`.
  const fwd = new Map<number, number>();
  for (let o = 0; o < outCount; o++) {
    const i = srcOf[o]!;
    if (i >= 0) fwd.set(i, o);
  }
  const out = new Uint32Array(touched.length);
  let w = 0;
  for (const t of touched) {
    const o = fwd.get(t);
    if (o !== undefined) out[w++] = o;
  }
  return out.subarray(0, w);
}
