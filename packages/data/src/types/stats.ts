/** Live provider diagnostics (Markets ProviderStats parity — subset tracked in hub). */
export interface ProviderStats {
  rowCount: number;
  byteCount: number;
  cacheBytes: number;
  msgCount: number;
  msgPerSec: number;
  snapshotFetchMs: number | null;
  restartRequestMs: number | null;
  firstMessageMs: number | null;
  publishCount: number;
  publishPerSec: number;
  publishPerMin: number;
  subscriberCount: number;
  startedAt: number | null;
  lastMessageAt: number | null;
  errorCount: number;
  lastError: string | null;
  status: string;
}

export function emptyProviderStats(status = 'idle'): ProviderStats {
  return {
    rowCount: 0,
    byteCount: 0,
    cacheBytes: 0,
    msgCount: 0,
    msgPerSec: 0,
    snapshotFetchMs: null,
    restartRequestMs: null,
    firstMessageMs: null,
    publishCount: 0,
    publishPerSec: 0,
    publishPerMin: 0,
    subscriberCount: 0,
    startedAt: null,
    lastMessageAt: null,
    errorCount: 0,
    lastError: null,
    status,
  };
}
