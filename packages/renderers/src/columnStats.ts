// @cgrid/renderers — main-side incremental column statistics. §2.4a.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md §2.4a.
//
// Incremental min/max/maxAbs/sum/count per watched column over the full row
// set (scope = ALL rows; a 'visible' scope is a documented follow-up needing
// a visible-set feed). Seeded by `grid.forEachRow`, updated from the 21e
// listener-gated `rowsChanged` event. Consumed by HeatCell/BidirectionalBarCell/
// VolumeBar through their `stats` param (a plain `ColumnStatsSnapshot` — the
// bridge's builders wire `heatCell.params.stats = stats.for('pnl')`).

import type { ColumnStatsSnapshot } from './types';

/** Row-change payload shape ColumnStats consumes (mirrors kernel's `rowsChanged` event). */
export interface RowsChangedPayload {
  added?: ReadonlyArray<Record<string, unknown>>;
  updated?: ReadonlyArray<{ prev: Record<string, unknown>; next: Record<string, unknown> }>;
  removed?: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Incremental min/max/maxAbs/sum/count tracker for a fixed set of watched
 * `colId`s, seeded from the full row set and kept current from row-change
 * events. Instantiated lazily by the bridge only when a builder needs it.
 */
export class ColumnStats {
  constructor(_colIds: readonly string[]) {
    throw new Error('not-yet-implemented: ColumnStats ships in a later cycle-21f task');
  }

  /** Seeds the incremental state from the full row set (`grid.forEachRow`). */
  seed(_rows: Iterable<Record<string, unknown>>): void {
    throw new Error('not-yet-implemented: ColumnStats.seed ships in a later cycle-21f task');
  }

  /** Applies an add/update/remove batch (the 21e listener-gated `rowsChanged` event). */
  onRowsChanged(_payload: RowsChangedPayload): void {
    throw new Error('not-yet-implemented: ColumnStats.onRowsChanged ships in a later cycle-21f task');
  }

  /** Current snapshot for one watched column; `undefined` if unwatched or unseeded. */
  for(_colId: string): ColumnStatsSnapshot | undefined {
    throw new Error('not-yet-implemented: ColumnStats.for ships in a later cycle-21f task');
  }

  /** Releases any subscriptions the bridge wired on construction. */
  destroy(): void {
    throw new Error('not-yet-implemented: ColumnStats.destroy ships in a later cycle-21f task');
  }
}
