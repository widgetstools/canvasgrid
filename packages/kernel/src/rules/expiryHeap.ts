// Binary min-heap of activation deadlines with ONE coalesced timer armed
// for the heap top. Injectable clock + timer fns keep the package Date-free
// (Global Constraints) and the tests deterministic. Expired entries ship in
// batches: every entry whose deadline <= now() at flush time.
//
// Authoritative reference: spec §1.1 item 8 (activeDurationMs auto-expire).

export interface ExpiryEntry {
  deadline: number;
  rowId: string;
  colId: string | null;
  ruleId: string;
}

function keyOf(rowId: string, colId: string | null, ruleId: string): string {
  return `${rowId}\0${colId ?? ''}\0${ruleId}`;
}

export class ExpiryHeap {
  #heap: ExpiryEntry[] = [];
  /** key → latest deadline. Re-pushing a key extends its window; superseded
   *  heap entries are skipped lazily at flush (deadline mismatch). */
  #active = new Map<string, number>();
  #subs = new Set<(expired: ExpiryEntry[]) => void>();
  #now: () => number;
  #setTimer: (fn: () => void, ms: number) => unknown;
  #clearTimer: (h: unknown) => void;
  #timer: unknown = null;
  #armedFor: number | null = null;

  constructor(opts: {
    now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (h: unknown) => void;
  }) {
    this.#now = opts.now;
    this.#setTimer = opts.setTimer;
    this.#clearTimer = opts.clearTimer;
  }

  push(e: ExpiryEntry): void {
    this.#active.set(keyOf(e.rowId, e.colId, e.ruleId), e.deadline);
    this.#heap.push(e);
    this.#siftUp(this.#heap.length - 1);
    this.#arm();
  }

  /** Currently-active (unexpired) key check: `rowId\0colId\0ruleId`. */
  isActive(rowId: string, colId: string | null, ruleId: string): boolean {
    const deadline = this.#active.get(keyOf(rowId, colId, ruleId));
    return deadline !== undefined && deadline > this.#now();
  }

  onExpire(fn: (expired: ExpiryEntry[]) => void): () => void {
    this.#subs.add(fn);
    return () => {
      this.#subs.delete(fn);
    };
  }

  clear(): void {
    this.#heap.length = 0;
    this.#active.clear();
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    this.#armedFor = null;
  }

  #arm(): void {
    const top = this.#heap[0];
    if (top === undefined) {
      if (this.#timer !== null) {
        this.#clearTimer(this.#timer);
        this.#timer = null;
        this.#armedFor = null;
      }
      return;
    }
    if (this.#timer !== null && this.#armedFor !== null && this.#armedFor <= top.deadline) {
      return; // already armed at-or-before the top — coalesced
    }
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#armedFor = top.deadline;
    this.#timer = this.#setTimer(() => this.#flush(), Math.max(0, top.deadline - this.#now()));
  }

  #flush(): void {
    this.#timer = null;
    this.#armedFor = null;
    const now = this.#now();
    const expired: ExpiryEntry[] = [];
    while (this.#heap.length > 0 && this.#heap[0]!.deadline <= now) {
      const e = this.#pop();
      const key = keyOf(e.rowId, e.colId, e.ruleId);
      if (this.#active.get(key) === e.deadline) {
        this.#active.delete(key);
        expired.push(e);
      }
      // else: superseded by a later re-push — stale entry, skip silently.
    }
    if (expired.length > 0) {
      for (const fn of [...this.#subs]) fn(expired);
    }
    this.#arm();
  }

  #pop(): ExpiryEntry {
    const top = this.#heap[0]!;
    const last = this.#heap.pop()!;
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  #siftUp(i: number): void {
    const heap = this.#heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]!.deadline <= heap[i]!.deadline) break;
      [heap[parent]!, heap[i]!] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  }

  #siftDown(i: number): void {
    const heap = this.#heap;
    const n = heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && heap[left]!.deadline < heap[smallest]!.deadline) smallest = left;
      if (right < n && heap[right]!.deadline < heap[smallest]!.deadline) smallest = right;
      if (smallest === i) break;
      [heap[smallest]!, heap[i]!] = [heap[i]!, heap[smallest]!];
      i = smallest;
    }
  }
}
