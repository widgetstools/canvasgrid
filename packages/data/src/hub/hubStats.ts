/**
 * Sliding-window provider stats for {@link DataServicesHub} (Markets hubStats subset).
 */
import type { ProviderStats } from '../types/stats';
import { emptyProviderStats } from '../types/stats';

const SEC_WINDOW = 5;
const MIN_WINDOW = 60;

export type SlotStatsState = {
  byteCount: number;
  msgCount: number;
  msgsByBucket: number[];
  pubsByBucket: number[];
  pubsByMinBucket: number[];
  bucketIdx: number;
  minBucketIdx: number;
  publishWindowSeconds: number;
  publishCount: number;
  snapshotStartedAt: number | null;
  snapshotFetchMs: number | null;
  restartStartedAt: number | null;
  restartRequestMs: number | null;
  firstMessageMs: number | null;
  awaitingFirstMessage: boolean;
  startedAt: number | null;
  lastMessageAt: number | null;
  errorCount: number;
  lastError: string | null;
  /** True after Restart until connecting/snapshot — used for restartRequestMs. */
  awaitingRestartRequest: boolean;
  lastRotateAt: number;
};

export function createSlotStats(): SlotStatsState {
  return {
    byteCount: 0,
    msgCount: 0,
    msgsByBucket: Array.from({ length: SEC_WINDOW }, () => 0),
    pubsByBucket: Array.from({ length: SEC_WINDOW }, () => 0),
    pubsByMinBucket: Array.from({ length: MIN_WINDOW }, () => 0),
    bucketIdx: 0,
    minBucketIdx: 0,
    publishWindowSeconds: 0,
    publishCount: 0,
    snapshotStartedAt: null,
    snapshotFetchMs: null,
    restartStartedAt: null,
    restartRequestMs: null,
    firstMessageMs: null,
    awaitingFirstMessage: false,
    startedAt: null,
    lastMessageAt: null,
    errorCount: 0,
    lastError: null,
    awaitingRestartRequest: false,
    lastRotateAt: Date.now(),
  };
}

/** Advance 1 Hz buckets if wall clock moved. */
export function maybeRotateStats(stats: SlotStatsState, now = Date.now()): void {
  let elapsed = Math.floor((now - stats.lastRotateAt) / 1000);
  if (elapsed <= 0) return;
  elapsed = Math.min(elapsed, SEC_WINDOW + MIN_WINDOW);
  for (let i = 0; i < elapsed; i++) {
    stats.bucketIdx = (stats.bucketIdx + 1) % stats.msgsByBucket.length;
    stats.msgsByBucket[stats.bucketIdx] = 0;
    stats.pubsByBucket[stats.bucketIdx] = 0;
    stats.minBucketIdx = (stats.minBucketIdx + 1) % stats.pubsByMinBucket.length;
    stats.pubsByMinBucket[stats.minBucketIdx] = 0;
    if (stats.startedAt != null) {
      stats.publishWindowSeconds = Math.min(MIN_WINDOW, stats.publishWindowSeconds + 1);
    }
  }
  stats.lastRotateAt += elapsed * 1000;
}

export function resetRuntimeCounters(stats: SlotStatsState, now = Date.now()): void {
  stats.byteCount = 0;
  stats.msgCount = 0;
  stats.msgsByBucket.fill(0);
  stats.pubsByBucket.fill(0);
  stats.pubsByMinBucket.fill(0);
  stats.publishCount = 0;
  stats.publishWindowSeconds = 0;
  stats.snapshotFetchMs = null;
  stats.firstMessageMs = null;
  stats.awaitingFirstMessage = true;
  stats.snapshotStartedAt = now;
  stats.startedAt = now;
  stats.lastMessageAt = null;
  stats.lastRotateAt = now;
}

export function markRestart(stats: SlotStatsState, now = Date.now()): void {
  resetRuntimeCounters(stats, now);
  stats.restartStartedAt = now;
  stats.restartRequestMs = null;
  stats.awaitingRestartRequest = true;
}

export function noteStatus(
  stats: SlotStatsState,
  status: string,
  error?: string,
  now = Date.now(),
): void {
  if (status === 'error') {
    stats.errorCount += 1;
    stats.lastError = error ?? 'error';
  }
  if (
    stats.awaitingRestartRequest
    && (status === 'connecting' || status === 'snapshot')
  ) {
    stats.restartRequestMs = now - (stats.restartStartedAt ?? now);
    stats.awaitingRestartRequest = false;
  }
  if (status === 'ready' && stats.snapshotStartedAt != null && stats.snapshotFetchMs == null) {
    stats.snapshotFetchMs = now - stats.snapshotStartedAt;
  }
  if (status === 'disconnected' || status === 'idle') {
    stats.awaitingFirstMessage = false;
    stats.awaitingRestartRequest = false;
  }
}

export function noteMessage(stats: SlotStatsState, byteSize: number, now = Date.now()): void {
  maybeRotateStats(stats, now);
  stats.msgCount += 1;
  stats.byteCount += Math.max(0, byteSize);
  const msgBucket = stats.msgsByBucket[stats.bucketIdx] ?? 0;
  stats.msgsByBucket[stats.bucketIdx] = msgBucket + 1;
  stats.lastMessageAt = now;
  if (stats.awaitingFirstMessage) {
    const origin = stats.restartStartedAt ?? stats.startedAt ?? now;
    stats.firstMessageMs = now - origin;
    stats.awaitingFirstMessage = false;
  }
}

export function notePublish(stats: SlotStatsState, now = Date.now()): void {
  maybeRotateStats(stats, now);
  stats.publishCount += 1;
  const pubBucket = stats.pubsByBucket[stats.bucketIdx] ?? 0;
  stats.pubsByBucket[stats.bucketIdx] = pubBucket + 1;
  const minBucket = stats.pubsByMinBucket[stats.minBucketIdx] ?? 0;
  stats.pubsByMinBucket[stats.minBucketIdx] = minBucket + 1;
}

export function estimateBytes(rows: readonly unknown[]): number {
  try {
    return JSON.stringify(rows).length;
  } catch {
    return rows.length * 64;
  }
}

export function cacheFootprintBytes(rowCount: number, sample: unknown | undefined): number {
  if (rowCount <= 0 || sample == null) return 0;
  try {
    return JSON.stringify(sample).length * rowCount;
  } catch {
    return rowCount * 64;
  }
}

export function snapshotProviderStats(
  stats: SlotStatsState,
  opts: {
    rowCount: number;
    sampleRow?: unknown;
    subscriberCount: number;
    status: string;
  },
): ProviderStats {
  maybeRotateStats(stats);
  const msgSum = stats.msgsByBucket.reduce((a, b) => a + b, 0);
  const pubSum = stats.pubsByBucket.reduce((a, b) => a + b, 0);
  const minTotal = stats.pubsByMinBucket.reduce((a, b) => a + b, 0);
  const minWindow = Math.max(1, Math.min(stats.publishWindowSeconds || 1, MIN_WINDOW));
  return {
    rowCount: opts.rowCount,
    byteCount: stats.byteCount,
    cacheBytes: cacheFootprintBytes(opts.rowCount, opts.sampleRow),
    msgCount: stats.msgCount,
    msgPerSec: msgSum / SEC_WINDOW,
    snapshotFetchMs: stats.snapshotFetchMs,
    restartRequestMs: stats.restartRequestMs,
    firstMessageMs: stats.firstMessageMs,
    publishCount: stats.publishCount,
    publishPerSec: pubSum / SEC_WINDOW,
    publishPerMin: (minTotal / minWindow) * 60,
    subscriberCount: opts.subscriberCount,
    startedAt: stats.startedAt,
    lastMessageAt: stats.lastMessageAt,
    errorCount: stats.errorCount,
    lastError: stats.lastError,
    status: opts.status,
  };
}

export function zeroedStats(status = 'idle'): ProviderStats {
  return emptyProviderStats(status);
}
