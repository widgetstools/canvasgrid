/**
 * Single null-safe field merge for SSRM hydrate / tick patches.
 * Skips null/undefined so thin column-window payloads never wipe hydrated fields.
 */
export function mergeRowFields<T extends Record<string, unknown>>(
  prev: T | undefined,
  next: T,
): T {
  if (!prev) return next;
  const out: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}
