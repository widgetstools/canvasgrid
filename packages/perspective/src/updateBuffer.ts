/**
 * Bound the Perspective table.write queue under STOMP/seed backpressure.
 *
 * Indexed `table.update` is last-write-wins per row identity, so dropping
 * earlier copies of the same key is safe. Identity is always the
 * DataProvider `keyColumn` (single field or composite) via
 * {@link composeRowId} — never a hardcoded field name.
 *
 * When unique ids still exceed `cap`, keep the most recently seen keys
 * (scan from the end).
 */
// Deep import, not the package index: this module is reachable from the
// deployed shared worker (`workerFeedHost.ts`), and the index pulls in
// `connectHub`, whose `new SharedWorker(new URL(...))` a bundler compiles as
// a NESTED worker entry — which both bloats the worker and emits a sibling
// asset the "deploy one self-contained file" instruction says will not exist.
import { composeRowId } from '@wellsfargo-starui/velocity-grid-data/rowid';

export type UpdateBufferKeyColumn = string | readonly string[];

export function boundUpdateBuffer<T extends Record<string, unknown>>(
  buffer: T[],
  cap: number,
  keyColumn: UpdateBufferKeyColumn,
): T[] {
  if (cap <= 0) return [];
  if (buffer.length <= cap) return buffer;

  const seen = new Set<string>();
  const newestFirst: T[] = [];
  for (let i = buffer.length - 1; i >= 0; i--) {
    const row = buffer[i]!;
    const id = composeRowId(row, keyColumn);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    newestFirst.push(row);
    if (newestFirst.length >= cap) break;
  }
  if (newestFirst.length === 0) {
    // No resolvable keys — hard trim by arrival order rather than wiping.
    return buffer.slice(-cap);
  }
  newestFirst.reverse();
  return newestFirst;
}

/** Live / snapshot caps for {@link boundUpdateBuffer}. */
export function updateBufferCap(opts: {
  snapshotComplete: boolean;
  batchSize: number;
  snapshotRows: number;
}): number {
  const batchFloor = Math.max(1, opts.batchSize | 0) * 40;
  if (!opts.snapshotComplete) {
    // Snapshot may briefly hold a large unique set; still hard-cap.
    return Math.max(batchFloor, Math.max(1, opts.snapshotRows | 0) * 2, 5_000);
  }
  // Live: keep pending WASM writes bounded when flush falls behind the feed.
  return Math.max(batchFloor, 2_500);
}
