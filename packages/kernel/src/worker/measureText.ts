/**
 * Worker-side text-measurement utilities for the `autoHeight` pass.
 *
 * Hot path: `OffscreenCanvas.measureText` (Chrome ≥ 100, Firefox ≥ 105,
 * Safari ≥ 16.4). Older Safari/Firefox needing the main-thread fallback
 * (Safari 15.4–16.3, Firefox 100–104) is handled in `worker.ts` by emitting
 * a `measureTextRequest` push and awaiting a `measureTextResponse` — this
 * module exposes the shared `wrapTextToHeight` algorithm both paths reuse.
 *
 * `MeasureCache` is an LRU keyed by `(font, width, text)` so streaming
 * updates never grow the cache unboundedly. Bounded at 1024 entries by
 * default per the cycle-5 performance budget.
 *
 * Cycle 5 / Task 8.
 */

let cachedSupport: boolean | null = null;

/** Feature-detect `OffscreenCanvas.measureText` once and memoise. Returns
 *  false in environments without `OffscreenCanvas` (Node test runners,
 *  Safari 15.4–16.3 workers without the API). */
export function workerCanMeasure(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  try {
    if (typeof OffscreenCanvas === 'undefined') return (cachedSupport = false);
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    return (cachedSupport = !!(ctx && typeof ctx.measureText === 'function'));
  } catch {
    return (cachedSupport = false);
  }
}

/** Test hook — clears the memoised feature-detect result so unit tests can
 *  exercise both branches against a stubbed `OffscreenCanvas`. */
export function __resetWorkerCanMeasure(): void {
  cachedSupport = null;
}

/**
 * Simple LRU built on a plain `Map` — Map iteration is insertion-ordered,
 * so deleting + re-setting on access moves the key to the most-recent end.
 * Capacity is a hard ceiling: a `set` that exceeds it drops the oldest key.
 */
export class MeasureCache {
  private map = new Map<string, number>();

  constructor(private capacity = 1024) {}

  get(key: string): number | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  has(key: string): boolean { return this.map.has(key); }

  set(key: string, value: number): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict oldest. Map iteration order is insertion order; the first key
      // returned by `keys()` is the LRU.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  size(): number { return this.map.size; }

  clear(): void { this.map.clear(); }
}

/** Build the cache key. Kept here so callers can't drift on separator/order. */
export function measureKey(font: string, width: number, text: string): string {
  return `${font}|${width}|${text}`;
}

/**
 * Greedy word-wrap. Counts how many lines `text` occupies when constrained
 * to `width` pixels with the given per-word `measure` function, then returns
 * `lineCount * lineHeight + 2 * padding`.
 *
 * Rules:
 * - A word wider than `width` occupies one line by itself (we never split a
 *   word). Matches what most text engines do on overflow-wrap: normal.
 * - Empty input still returns one line so a row never shrinks below the
 *   single-line height.
 * - `width <= 0` short-circuits to one line — the caller is mid-resize and
 *   the column width has not landed yet.
 */
export function wrapTextToHeight(
  text: string,
  width: number,
  lineHeight: number,
  padding: number,
  measure: (s: string) => number,
): number {
  if (!text || width <= 0) {
    return lineHeight + 2 * padding;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return lineHeight + 2 * padding;
  }
  let lines = 1;
  let current = '';
  for (const word of words) {
    if (!current) {
      // First word on a line is always accepted, even if it overflows. We
      // never split a word — overflow is the column's problem to clip.
      current = word;
      continue;
    }
    const next = current + ' ' + word;
    if (measure(next) <= width) {
      current = next;
    } else {
      lines++;
      current = word;
    }
  }
  return lines * lineHeight + 2 * padding;
}

/** Build a `measure(s) => width` function backed by an `OffscreenCanvas`
 *  context. Returns null when the worker has no support — the autoHeight
 *  pass then falls back to the main-thread RPC. */
export function offscreenMeasurer(font: string): ((s: string) => number) | null {
  if (!workerCanMeasure()) return null;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = font;
    return (s: string) => ctx.measureText(s).width;
  } catch {
    return null;
  }
}
