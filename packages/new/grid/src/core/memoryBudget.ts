/**
 * Cycle 25 / Task 10 — memory-pressure release.
 *
 * `VelocityGridOptions.memoryBudgetMB` (optional) caps the cumulative byte
 * size of chunks the grid keeps in its main-side cache. We hold cached
 * chunks via `WeakRef` so V8/JSC can collect them before our eviction
 * runs if real memory pressure builds; the LRU walks them in
 * least-recently-used order and drops strong refs first when the sum
 * goes over budget.
 *
 * The estimator is conservative — it sums every typed array on the
 * chunk that the worker shipped through structured-clone. Strings,
 * decoded text arrays, and the flash registry's per-cell entries live
 * on the main side outside this estimate; the budget primarily bounds
 * the worker-clone footprint.
 */

import type { ViewportChunk } from '../worker/protocol';

export function estimateChunkBytes(chunk: ViewportChunk | null | undefined): number {
  if (!chunk) return 0;
  let bytes = 0;
  bytes += chunk.rowIds.byteLength;
  bytes += chunk.rowKinds.byteLength;
  bytes += chunk.groupDepth.byteLength;
  bytes += chunk.heights.byteLength;
  for (const k in chunk.numericCols) {
    bytes += chunk.numericCols[k]!.byteLength;
  }
  for (const k in chunk.textCols) {
    const tc = chunk.textCols[k]!;
    bytes += tc.offsets.byteLength + tc.bytes.byteLength;
  }
  if (chunk.flashMask) bytes += chunk.flashMask.byteLength;
  if (chunk.groupChildCount) bytes += chunk.groupChildCount.byteLength;
  if (chunk.isExpanded) bytes += chunk.isExpanded.byteLength;
  return bytes;
}

export function shouldRelease(usedBytes: number | undefined, budgetBytes: number): boolean {
  if (!usedBytes) return false;
  if (budgetBytes <= 0) return false;
  return usedBytes > budgetBytes;
}

interface LRUEntry<T extends object> {
  ref: WeakRef<T>;
  bytes: number;
}

/** LRU cache that holds entries through `WeakRef` so they can be GC'd
 *  ahead of our explicit eviction. The map's insertion order doubles
 *  as the LRU order — `Map` walks oldest-first, and we re-insert on
 *  `get` to promote. */
export class ChunkLRU<T extends object = ViewportChunk> {
  private map = new Map<string, LRUEntry<T>>();
  private byteSum = 0;

  constructor(private budgetBytes: number) {}

  setBudget(budgetBytes: number): void {
    this.budgetBytes = budgetBytes;
    this.evict();
  }

  bytes(): number {
    return this.byteSum;
  }

  size(): number {
    return this.map.size;
  }

  set(key: string, value: T, bytes: number): void {
    const existing = this.map.get(key);
    if (existing) {
      this.byteSum -= existing.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { ref: new WeakRef(value), bytes });
    this.byteSum += bytes;
    this.evict();
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    const v = entry.ref.deref();
    if (v === undefined) {
      // Collected by GC ahead of us — drop the stale entry.
      this.byteSum -= entry.bytes;
      this.map.delete(key);
      return undefined;
    }
    // Promote: re-insert at the tail of the Map.
    this.map.delete(key);
    this.map.set(key, entry);
    return v;
  }

  clear(): void {
    this.map.clear();
    this.byteSum = 0;
  }

  private evict(): void {
    if (this.budgetBytes <= 0) return;
    if (this.byteSum <= this.budgetBytes) return;
    for (const key of this.map.keys()) {
      if (this.byteSum <= this.budgetBytes) break;
      const entry = this.map.get(key)!;
      this.byteSum -= entry.bytes;
      this.map.delete(key);
    }
  }
}
