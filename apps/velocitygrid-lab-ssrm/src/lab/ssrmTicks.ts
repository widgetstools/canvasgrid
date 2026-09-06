/**
 * How a tick reaches the grid on the server-side path.
 *
 * Its own module, and not because the component was crowded: this is the
 * contract between the feed and the grid, it has nothing to do with React, and
 * a test for it should not have to mount a component to reach it.
 */
import type { BlotterRow } from '../data/domain';

/** Minimal grid surface the stream sink drives. */
export interface SsrmTickTarget {
  applyServerSideTransaction(tx: { update: BlotterRow[] }): void;
  refreshServerSide(params: { purge: boolean }): void;
}

/**
 * What a tick does on the server-side path.
 *
 * Send the rows, do not just invalidate. The book behind the datasource
 * already has them, so a bare `refreshServerSide` repaints the right VALUES —
 * but the grid has no idea which cells moved or what they moved from, because
 * a block re-read carries no old/new pairing. Everything downstream of that
 * pairing then goes quiet on this row model only: cell flash, tick-direction
 * rules, the tick arrows, and relative-change alerts.
 *
 * `applyServerSideTransaction` is the kernel's path for exactly this (see
 * `dispatchServerSideTransaction`): it merges the update into the loaded
 * blocks and emits `rowsChanged` carrying the previous row, which is what the
 * rule engine turns into `[col.old]`. It also re-sorts when a tick crosses the
 * active sort key, so a soft refresh per tick is not needed — and cost a full
 * window re-read besides.
 */
export function applyTick(grid: SsrmTickTarget | null | undefined, rows: BlotterRow[]): void {
  if (!grid || rows.length === 0) return;
  grid.applyServerSideTransaction({ update: rows });
}

/** A new snapshot voids every cached block, so this one IS a purge. */
export function applySnapshot(grid: SsrmTickTarget | null | undefined): void {
  grid?.refreshServerSide({ purge: true });
}
