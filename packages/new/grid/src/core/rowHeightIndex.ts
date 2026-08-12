/**
 * Cumulative row-height index — a Fenwick (Binary Indexed) tree backed by a
 * pair of `Float32Array`s.
 *
 * Variable row heights make the naive `firstVisibleRow = scrollTop / rowHeight`
 * math wrong, and a linear scan over a million rows is unusable. The Fenwick
 * tree stores prefix sums under a power-of-two layout so `topOf(i)` (the y of
 * row i's top edge) and `rowAt(y)` (the row containing pixel y) both descend
 * in O(log n) — ~20 comparisons at n = 1,000,000.
 *
 * Storage is two parallel buffers: `heights[i]` holds the row's CSS-pixel
 * height; `tree[i+1]` is the BIT prefix-sum cell that covers row i. The +1
 * shift is the standard 1-based BIT layout (index 0 is unused).
 *
 * Allocation discipline: the structure allocates twice — once at construct,
 * once on `insert/remove` (which rebuild). `topOf` / `rowAt` / `update` are
 * pure reads / single-cell writes, no allocation on the hot path.
 *
 * Cycle 5 / Task 7.
 */
export class RowHeightIndex {
  private n: number;
  private heights: Float32Array;
  /** 1-indexed BIT cells; index 0 is unused so the bit-trick math (`i & -i`)
   *  works without an off-by-one. */
  private tree: Float32Array;
  /** Largest power of two ≤ `n`. Cached so `rowAt`'s descent can start from
   *  the right bit without a log call per query. */
  private pow2: number;

  constructor(length: number, heightAt: (i: number) => number) {
    this.n = length;
    this.heights = new Float32Array(length);
    for (let i = 0; i < length; i++) this.heights[i] = heightAt(i);
    this.tree = new Float32Array(length + 1);
    this.buildTree();
    this.pow2 = this.computePow2(length);
  }

  /** Total row count currently indexed. */
  length(): number { return this.n; }

  /** Stored height of row `i`. Returns 0 for out-of-range indices. */
  heightAt(i: number): number {
    if (i < 0 || i >= this.n) return 0;
    return this.heights[i]!;
  }

  /** Total cumulative height — equivalent to `topOf(length())`. O(log n). */
  totalHeight(): number {
    return this.topOf(this.n);
  }

  /**
   * Cumulative top of row `i` — sum of heights[0..i-1]. `topOf(0) === 0`;
   * `topOf(length())` is the total content height. O(log n).
   */
  topOf(i: number): number {
    if (i <= 0) return 0;
    let k = i > this.n ? this.n : i;
    let sum = 0;
    while (k > 0) {
      sum += this.tree[k]!;
      k -= k & -k;
    }
    return sum;
  }

  /**
   * Index of the row containing pixel `y` (top-inclusive, bottom-exclusive).
   * `y <= 0` returns 0; `y >= totalHeight()` returns the last row index.
   * O(log n) via the classic BIT descent.
   */
  rowAt(y: number): number {
    if (this.n === 0) return 0;
    if (y <= 0) return 0;
    // Standard "find largest k where prefix sum heights[0..k-1] <= y" descent:
    // start at the largest power of two ≤ n and greedily step right whenever
    // the running sum + tree[next] would still be ≤ y.
    let pos = 0;
    let r = y;
    let step = this.pow2;
    while (step > 0) {
      const next = pos + step;
      if (next <= this.n && this.tree[next]! <= r) {
        pos = next;
        r -= this.tree[next]!;
      }
      step >>= 1;
    }
    // `pos` is now the largest index where the prefix sum (rows 0..pos-1) is
    // ≤ y. That puts pixel y inside row `pos` itself (top-inclusive). Clamp
    // for the y >= totalHeight() case where pos walks all the way to n.
    return pos >= this.n ? this.n - 1 : pos;
  }

  /** Replace row `i`'s height. Out-of-range indices are silently ignored so
   *  callers can update freely without bounds-checking. O(log n). */
  update(i: number, newHeight: number): void {
    if (i < 0 || i >= this.n) return;
    const delta = newHeight - this.heights[i]!;
    if (delta === 0) return;
    this.heights[i] = newHeight;
    let k = i + 1;
    while (k <= this.n) {
      this.tree[k] = this.tree[k]! + delta;
      k += k & -k;
    }
  }

  /** Insert a row at index `i` with `height`. Shifts later rows one slot
   *  right. O(n) — meant for transaction add, not for scroll-hot paths. */
  insert(i: number, height: number): void {
    const clamped = i < 0 ? 0 : i > this.n ? this.n : i;
    const next = new Float32Array(this.n + 1);
    next.set(this.heights.subarray(0, clamped), 0);
    next[clamped] = height;
    next.set(this.heights.subarray(clamped), clamped + 1);
    this.adopt(next);
  }

  /** Remove the row at index `i`. Shifts later rows one slot left. O(n). */
  remove(i: number): void {
    if (i < 0 || i >= this.n) return;
    const next = new Float32Array(this.n - 1);
    next.set(this.heights.subarray(0, i), 0);
    next.set(this.heights.subarray(i + 1), i);
    this.adopt(next);
  }

  // --- internal -------------------------------------------------------------

  /** O(n) BIT build — the "push up to parent" trick. Each cell starts with
   *  its own height, then propagates to the parent (`i + (i & -i)`). At the
   *  end every BIT cell holds its correct segment sum. */
  private buildTree(): void {
    this.tree.fill(0);
    for (let i = 1; i <= this.n; i++) {
      this.tree[i] = this.tree[i]! + this.heights[i - 1]!;
      const parent = i + (i & -i);
      if (parent <= this.n) this.tree[parent] = this.tree[parent]! + this.tree[i]!;
    }
  }

  private adopt(nextHeights: Float32Array): void {
    this.heights = nextHeights;
    this.n = nextHeights.length;
    this.tree = new Float32Array(this.n + 1);
    this.buildTree();
    this.pow2 = this.computePow2(this.n);
  }

  private computePow2(length: number): number {
    if (length <= 0) return 0;
    let p = 1;
    while ((p << 1) <= length) p <<= 1;
    return p;
  }
}
