/**
 * Cycle 4 / Task 11 (cell-flash patch) — FlashRegistry.
 *
 * Per-cell flash tracker. Keys entries by `(numericRowId: number, colId:
 * string)` because chunks ship numeric IDs in `Uint32Array` — keeping the
 * registry numeric-keyed means the painter's per-cell `getAlpha` lookup
 * is allocation-free (string-key would force a `${num}-${col}` concat
 * per visible cell per paint).
 *
 * Flash lifecycle:
 *   - `flash(rowId, colId, now?)` stores a `FlashEntry` keyed by
 *     `(rowId, colId)`. Re-flashing the same cell restarts the timer.
 *   - Per-rAF `tick(now)` prunes entries past their `flashDuration +
 *     fadeDuration` window. Schedules a repaint when any entries
 *     remain so the fade animation keeps painting; skipped entirely
 *     when the registry is empty (zero rAF cost in the common case).
 *   - Painter calls `getAlpha(rowId, colId, now)` per visible cell.
 *     Returns 0 for non-flashing cells, 1 during flashDuration, linear
 *     1→0 fade across fadeDuration, 0 outside.
 *   - `getEnabled()` / `getReducedMotion()` short-circuit `flash()` so
 *     a disabled grid pays exactly zero registry overhead.
 *
 * The worker side ships a `flashMask: Uint8Array` per `ViewportChunk`
 * (one bit per cell, row-major). `ingestMask` unpacks the bits into
 * `flash()` calls — that's how the chunk-arrival path drives the
 * registry from the worker's diff.
 */

import { shapeFlashAlpha, type FlashMode } from './flashShaper';

export interface FlashEntry {
  /** Numeric rowId from `chunk.rowIds[i]`. The worker's
   *  `RowStore.getNumericId(rowIdString)` is the source of these. */
  rowId: number;
  colId: string;
  /** Time (ms, from `performance.now()`) the flash started. */
  startedAt: number;
  /** Captured at flash() time so a later `setGridOption(
   *  'cellFlashDuration', N)` doesn't retroactively reshape in-flight
   *  flashes. */
  flashDuration: number;
  fadeDuration: number;
  /** Cycle 21e / Task 13 — per-call color override; undefined → theme
   *  `flashFromColor` (unchanged default). */
  color?: string;
  /** Cycle 21e / Task 13 — alpha curve; undefined → 'fade' (unchanged). */
  mode?: FlashMode;
}

/** Cycle 21e / Task 13 — per-call overrides captured into a FlashEntry
 *  at flash() time (same capture-at-start semantics as the durations). */
export interface FlashOverride {
  color?: string;
  mode?: FlashMode;
  flashDuration?: number;
  fadeDuration?: number;
}

export interface FlashRegistryDeps {
  /** Live read so `setGridOption('enableCellChangeFlash', false)` flips
   *  immediately. When false, every `flash()` call is a no-op AND
   *  `getAlpha` returns 0 unconditionally. */
  getEnabled: () => boolean;
  /** Live read for both chunk-driven flashes and `flashCells` calls.
   *  Captured into each `FlashEntry` so in-flight flashes don't re-shape
   *  when the option changes mid-flight. */
  getFlashDuration: () => number;
  /** Live read; same rationale as `getFlashDuration`. */
  getFadeDuration: () => number;
  /** Honors `prefers-reduced-motion: reduce` — cgrid wires this to a
   *  `matchMedia` listener. When true, every `flash()` is a no-op. */
  getReducedMotion: () => boolean;
  /** Schedule a repaint of the canvas. Called from `tick(now)` whenever
   *  active entries remain so the fade animation keeps painting. cgrid
   *  passes `cgridCanvas.requestRepaint`. */
  requestRepaint: () => void;
  /** Cycle 22 / closeout I-3 — called from `tick(now)` with the (deduped)
   *  numeric rowIds whose LAST flash entry just expired: the row has fully
   *  settled and is strip-eligible again. cgrid uses this to issue one
   *  row-level repaint for rows whose Tier-2 strip is missing or stale
   *  (patch bailed at tick time), so the settled row re-captures instead
   *  of staying permanently cold on the ticking workload. Optional — the
   *  registry works unchanged without it. */
  onRowsSettled?: (rowIds: number[]) => void;
}

/** Map-key encoding: `(rowId, colId)` → `"<rowId>\0<colId>"`. NUL
 *  separator is safe because rowIds are numeric and colIds don't
 *  contain it. */
function key(rowId: number, colId: string): string {
  return `${rowId}\0${colId}`;
}

export class FlashRegistry {
  private destroyed = false;
  private entries = new Map<string, FlashEntry>();

  constructor(private deps: FlashRegistryDeps) {}

  /** Mark one cell as flashing. Re-flashing the same cell restarts the
   *  timer. No-op when disabled, reduced-motion, or destroyed. The
   *  duration values are captured into the entry at call time so a
   *  later runtime option change doesn't retroactively re-shape this
   *  flash. */
  flash(rowId: number, colId: string, now: number = performance.now(), override?: FlashOverride): void {
    if (this.destroyed) return;
    if (!this.deps.getEnabled()) return;
    if (this.deps.getReducedMotion()) return;
    const flashDuration = override?.flashDuration ?? this.deps.getFlashDuration();
    const fadeDuration = override?.fadeDuration ?? this.deps.getFadeDuration();
    this.entries.set(key(rowId, colId), {
      rowId,
      colId,
      startedAt: now,
      flashDuration,
      fadeDuration,
      color: override?.color,
      mode: override?.mode,
    });
  }

  /** Bulk variant — flashes every (rowId × colId) pair. Used by
   *  `VelocityGridApi.flashCells({rowIds, colIds})`. Same disabled / reduced-
   *  motion gating as `flash()`. */
  flashMany(rowIds: readonly number[], colIds: readonly string[], now: number = performance.now()): void {
    if (this.destroyed) return;
    if (!this.deps.getEnabled()) return;
    if (this.deps.getReducedMotion()) return;
    for (const r of rowIds) {
      for (const c of colIds) {
        this.flash(r, c, now);
      }
    }
  }

  /** Drain a worker chunk's `flashMask` into the registry. Bits are
   *  packed row-major: bit `r * colIds.length + c` flashes cell
   *  `(rowIds[r], colIds[c])`. Skipping disabled / reduced-motion checks
   *  inside the inner loop — `flash()` already short-circuits. */
  ingestMask(input: {
    rowIds: Uint32Array | readonly number[];
    colIds: readonly string[];
    mask: Uint8Array;
    now?: number;
    /** Cycle 21e / Task 13 — string rowIds parallel to `rowIds` (from
     *  chunk.stringRowIds). Only needed when `getOverride` is set. */
    stringRowIds?: readonly string[];
    /** Cycle 21e / Task 13 — per-cell override lookup, keyed by string
     *  rowId + colId. Return undefined for "no override". */
    getOverride?: (stringRowId: string, colId: string) => FlashOverride | undefined;
  }): void {
    if (this.destroyed) return;
    const { rowIds, colIds, mask } = input;
    const now = input.now ?? performance.now();
    const rowCount = rowIds.length;
    const colCount = colIds.length;
    if (rowCount === 0 || colCount === 0) return;
    const { stringRowIds, getOverride } = input;
    for (let r = 0; r < rowCount; r++) {
      const sid = getOverride && stringRowIds ? stringRowIds[r] ?? '' : '';
      for (let c = 0; c < colCount; c++) {
        const bitIdx = r * colCount + c;
        const byte = mask[bitIdx >>> 3] ?? 0;
        if ((byte & (1 << (bitIdx & 7))) === 0) continue;
        const colId = colIds[c]!;
        const override = getOverride && sid !== '' ? getOverride(sid, colId) : undefined;
        this.flash(rowIds[r]!, colId, now, override);
      }
    }
  }

  /** Per-rAF tick. Prunes entries whose `now` is past their fade
   *  window. Requests a repaint when any entries remain so the fade
   *  animation keeps re-painting. Cheap when the active set is empty
   *  (the common case). */
  tick(now: number): void {
    if (this.destroyed) return;
    if (this.entries.size === 0) return;
    // Cycle 22 / closeout I-3 — collect rows whose flashes are expiring so
    // `onRowsSettled` can fire for rows with NO remaining entry (a row is
    // only "settled" once its last flashing cell expires).
    let expiredRows: Set<number> | null = null;
    for (const [k, e] of this.entries) {
      if (now > e.startedAt + e.flashDuration + e.fadeDuration) {
        this.entries.delete(k);
        if (this.deps.onRowsSettled !== undefined) (expiredRows ??= new Set()).add(e.rowId);
      }
    }
    if (expiredRows !== null) {
      for (const rowId of expiredRows) {
        if (this.hasRow(rowId)) expiredRows.delete(rowId); // another cell still fading
      }
      if (expiredRows.size > 0) this.deps.onRowsSettled!([...expiredRows]);
    }
    if (this.entries.size > 0) {
      this.deps.requestRepaint();
    }
  }

  /** Per-cell alpha. Returns 0 for non-flashing cells (zero-alloc fast
   *  path). 1 during the flash window; linear 1→0 fade across the fade
   *  window; 0 outside. */
  getAlpha(rowId: number, colId: string, now: number): number {
    if (this.destroyed) return 0;
    if (!this.deps.getEnabled()) return 0;
    if (this.deps.getReducedMotion()) return 0;
    const e = this.entries.get(key(rowId, colId));
    if (e === undefined) return 0;
    const elapsed = now - e.startedAt;
    // Cycle 21e / Task 13 — mode-shaped curve. 'fade' (the default when
    // no per-call mode was captured) reproduces the original math
    // exactly; see flashShaper.ts.
    return shapeFlashAlpha(e.mode ?? 'fade', elapsed, e.flashDuration, e.fadeDuration);
  }

  /** Cycle 21e / Task 13 — per-call color override for an active flash
   *  entry; undefined for the default theme blend. Callers pair this
   *  with a non-zero getAlpha. */
  getColor(rowId: number, colId: string): string | undefined {
    if (this.destroyed) return undefined;
    return this.entries.get(key(rowId, colId))?.color;
  }

  /** Number of currently-tracked entries. Test seam. */
  size(): number {
    return this.entries.size;
  }

  /** Cycle 22 / Task 3 — row-level probe for the Tier-2 strip eligibility
   *  contract ("no live flash on any of its cells"). Conservative: a
   *  tracked-but-past-fade entry (not yet pruned by `tick`) still counts —
   *  a bypass is a perf miss, a stale strip is a bug. O(entries), but
   *  callers short-circuit on `size() === 0` (the common case) and the
   *  active set is small by construction (flashes fade out fast). */
  hasRow(rowId: number): boolean {
    if (this.destroyed || this.entries.size === 0) return false;
    for (const e of this.entries.values()) {
      if (e.rowId === rowId) return true;
    }
    return false;
  }

  /** Damage-region rendering (Task 3) — active (non-expired) cell keys, for
   *  the registry's repaint dep to hand `VelocityGrid.repaintCells` an exact damage
   *  set instead of a bare `requestRepaint()` (which the ledger would
   *  resolve to a full repaint). Cheap: one array per tick, sized to the
   *  live entry count (typically small — flashes fade out fast). */
  activeCells(): Array<{ rowId: number; colId: string }> {
    // I6 fix — pre-size the output array instead of `push`ing (avoids the
    // dynamic-growth reallocation churn `push` can trigger). Called every
    // rAF while any entry is fading (up to ~1.5s of frames per flash
    // generation) via the `requestRepaint` dep, so this is a genuine
    // per-frame hot path, not a one-off. The returned array is handed
    // straight to `VelocityGrid.repaintCells` → `DamageLedger.add({kind:'cells'})`,
    // which only reads it (never retains it past the next `takeResolved`),
    // so pooling the {rowId,colId} objects THEMSELVES across calls isn't
    // safe here — a skipped paint frame could leave a queued ledger entry
    // aliasing objects this method then overwrites on the next tick.
    const out = new Array<{ rowId: number; colId: string }>(this.entries.size);
    let i = 0;
    for (const e of this.entries.values()) out[i++] = { rowId: e.rowId, colId: e.colId };
    return out;
  }

  /** Tear down — clears entries and makes future `flash()` calls
   *  no-op. Idempotent. */
  destroy(): void {
    this.destroyed = true;
    this.entries.clear();
  }
}
