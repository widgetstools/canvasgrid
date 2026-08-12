/**
 * Cross-tab feed stop epoch — written BEFORE Web Lock release so takeover
 * cannot restart STOMP while BroadcastChannel is still in flight.
 */

export function feedStopStorageKey(schemaKey: string): string {
  return `vg-new:feed-stop:${schemaKey}`;
}

export function writeSharedFeedStop(schemaKey: string, epoch: number): void {
  try {
    localStorage.setItem(feedStopStorageKey(schemaKey), String(epoch));
  } catch { /* private mode */ }
}

export function clearSharedFeedStop(schemaKey: string): void {
  try {
    localStorage.removeItem(feedStopStorageKey(schemaKey));
  } catch { /* private mode */ }
}

export function isSharedFeedStopped(schemaKey: string): boolean {
  try {
    return localStorage.getItem(feedStopStorageKey(schemaKey)) != null;
  } catch {
    return false;
  }
}
