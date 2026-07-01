/**
 * Cycle 21 — value normalization for the sparkline cell renderer.
 *
 * The cgrid worker's chunkFormat splits columns into numeric and text
 * partitions, so array-typed cell values arrive at the main thread as
 * comma-separated strings. The sparkline dispatcher normalizes the
 * value into a `readonly number[]` before handing off to each variant
 * painter, so the variant painters never re-implement parsing.
 *
 * Parsed strings are memoized by reference. Each chunk produces a
 * fixed set of decoded strings (via `decodeText`), so the cache stays
 * bounded by the visible-cell set: every paint frame after the first
 * is a single map lookup per cell.
 */

const PARSE_CACHE = new Map<string, readonly number[] | null>();
const PARSE_CACHE_MAX = 4096;

export function coerceToNumberArray(value: unknown): readonly number[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    // Fast path — already an array. Trust the caller; if a stray non-
    // number sneaks through, the painter's normalize-min/max loop will
    // produce NaN-tainted output, not a crash.
    return value as readonly number[];
  }
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    const cached = PARSE_CACHE.get(value);
    if (cached !== undefined) return cached;
    const parsed = parseCsv(value);
    if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear();
    PARSE_CACHE.set(value, parsed);
    return parsed;
  }
  return null;
}

function parseCsv(s: string): readonly number[] | null {
  const out: number[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || s.charCodeAt(i) === 44 /* , */) {
      // Empty token (e.g. trailing comma, or value that's just commas)
      // means this string isn't a usable numeric series. Returning null
      // for any malformed input keeps the painter's "empty data = no
      // paint" contract intact.
      if (i === start) return null;
      const slice = s.slice(start, i);
      const n = Number(slice);
      if (!Number.isFinite(n)) return null;
      out.push(n);
      start = i + 1;
    }
  }
  return out.length === 0 ? null : out;
}

/** Test hook — clears the memo cache so unit tests start with a
 *  predictable state. Production code should never call this. */
export function _resetCoerceCacheForTests(): void {
  PARSE_CACHE.clear();
}
