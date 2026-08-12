/**
 * RasterCache core — shared LRU byte ledger (Cycle 22 / Task 1).
 *
 * ONE `RasterBudget` is shared by BOTH raster tiers — Tier 1 cell bitmaps
 * (`CellBitmapCache`) and Tier 2 row strips (`RowStripCache`) — so eviction
 * pressure is global: when either store needs room, the globally
 * least-recently-touched entry goes first, no matter which tier owns it.
 *
 * The brief-pinned public core is `charge(bytes, evict)` + `spent()`. The
 * additional ledger methods (`track` / `touch` / `release` / `evictLru` /
 * `credit`) are the shared-LRU machinery the two stores use to realize
 * cross-tier eviction: every cached bitmap registers a ledger entry
 * (insertion-ordered `Map` = LRU order; `touch` re-inserts), and each
 * store passes `() => budget.evictLru()` as its `evict` callback so a
 * charge from EITHER store can reclaim the other's coldest entry.
 *
 * Byte-accounting invariant (two disjoint paths — never mix them):
 *  - `charge`'s evict loop subtracts the bytes `evict()` reports freed;
 *    `evictLru` therefore does NOT credit — it only pops the LRU ledger
 *    entry, runs its owner's `free()` (store-side map removal + canvas
 *    pooling), and reports the byte count for `charge` to subtract.
 *  - Every NON-charge release path (invalidate / epoch bump / dispose /
 *    replace) goes through `release(token)` (or `credit(bytes)` for a
 *    failed allocation refund), which subtracts directly.
 *
 * Pure module: no `Date`, no DOM. Nothing here throws on the hot path.
 */

/** A cached bitmap's ledger registration. `free()` is the OWNING store's
 *  cleanup (remove from its key map + recycle the canvas into its pool);
 *  it must NOT touch the budget — `charge` handles the byte credit. */
export interface RasterLedgerEntry {
  bytes: number;
  free(): void;
}

/** Opaque LRU-ledger handle returned by `track`. */
export type RasterLedgerToken = number;

export class RasterBudget {
  private readonly max: number;
  private used = 0;
  private seq = 0;
  /** Insertion order = LRU order (oldest-touched first). `touch`
   *  re-inserts, moving the entry to the back. */
  private ledger = new Map<RasterLedgerToken, RasterLedgerEntry>();

  constructor(maxBytes: number) {
    this.max = Math.max(0, maxBytes);
  }

  /** Try to reserve `bytes`, calling `evict()` (which frees LRU entries
   *  and returns the bytes freed) as many times as needed until the
   *  charge fits. Returns `false` — with nothing reserved — when the
   *  single charge can never fit (`bytes > maxBytes`, checked BEFORE any
   *  eviction so an impossible entry never flushes the cache) or when
   *  `evict()` runs dry (`<= 0`) first. Bytes genuinely freed by evict
   *  calls stay credited even on a `false` return. */
  charge(bytes: number, evict: () => number): boolean {
    if (bytes < 0 || bytes > this.max) return false;
    while (this.used + bytes > this.max) {
      const freed = evict();
      if (freed <= 0) return false;
      this.used = Math.max(0, this.used - freed);
    }
    this.used += bytes;
    return true;
  }

  /** Bytes currently reserved across both tiers. */
  spent(): number {
    return this.used;
  }

  /** Budget ceiling — used by the stores to bound their canvas pools. */
  maxBytes(): number {
    return this.max;
  }

  /** Register a cached bitmap in the shared LRU ledger (most-recent end).
   *  Call AFTER a successful `charge` for the same byte count. */
  track(entry: RasterLedgerEntry): RasterLedgerToken {
    const token = ++this.seq;
    this.ledger.set(token, entry);
    return token;
  }

  /** LRU-touch: move `token` to the most-recent end. No-op for a token
   *  already evicted/released. */
  touch(token: RasterLedgerToken): void {
    const e = this.ledger.get(token);
    if (e !== undefined) {
      this.ledger.delete(token);
      this.ledger.set(token, e);
    }
  }

  /** Evict the globally least-recently-touched entry: pops it from the
   *  ledger, runs its owner's `free()`, and returns its byte count for
   *  the in-flight `charge` loop to credit. Returns 0 when the ledger is
   *  empty (nothing left to evict). Intended as the `evict` callback:
   *  `budget.charge(bytes, () => budget.evictLru())`. */
  evictLru(): number {
    const first = this.ledger.entries().next();
    if (first.done) return 0;
    const [token, entry] = first.value;
    this.ledger.delete(token);
    entry.free();
    return entry.bytes;
  }

  /** Release a tracked entry OUTSIDE the charge/evict loop (invalidate,
   *  epoch bump, dispose, replace): drops it from the ledger AND credits
   *  its bytes back. The caller does its own store-side cleanup. */
  release(token: RasterLedgerToken): void {
    const e = this.ledger.get(token);
    if (e === undefined) return;
    this.ledger.delete(token);
    this.used = Math.max(0, this.used - e.bytes);
  }

  /** Refund a successful `charge` whose allocation then failed (factory
   *  returned null / context attach threw) before any `track`. */
  credit(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }
}
