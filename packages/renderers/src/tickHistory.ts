// @cgrid/renderers — main-side per-cell rolling tick history. §2.4b.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md §2.4b.
//
// Bounded ring buffers per (rowId, colId) for opted-in columns (`window` size
// per column, default 60); fed by rowsChanged/cellValueChanged; supplies
// arrays to the sparkline family and SpreadBarCell's rolling-σ band. O(1)
// push, evicts on row removal. Memory: window × rows × 8 bytes per watched
// column — documented so hosts can size `window` deliberately.

import type { TickHistorySnapshot } from './types';

/** Default ring-buffer window size per watched column (§2.4b). */
export const DEFAULT_TICK_HISTORY_WINDOW = 60;

export interface TickHistoryOptions {
  defaultWindow?: number;
}

/**
 * Bounded per-(rowId, colId) rolling value history. Instantiated lazily by
 * the bridge only when a builder needs it (sparkline family, SpreadBarCell).
 */
export class TickHistory {
  constructor(_opts?: TickHistoryOptions) {
    throw new Error('not-yet-implemented: TickHistory ships in a later cycle-21f task');
  }

  /** Opts a column into history tracking with a given ring-buffer window size. */
  configure(_colId: string, _window: number): void {
    throw new Error('not-yet-implemented: TickHistory.configure ships in a later cycle-21f task');
  }

  /** O(1) ring-buffer push for one (rowId, colId) cell. */
  push(_rowId: string | number, _colId: string, _value: number): void {
    throw new Error('not-yet-implemented: TickHistory.push ships in a later cycle-21f task');
  }

  /** Current snapshot for one (rowId, colId) cell; `undefined` if unconfigured/unseen. */
  for(_rowId: string | number, _colId: string): TickHistorySnapshot | undefined {
    throw new Error('not-yet-implemented: TickHistory.for ships in a later cycle-21f task');
  }

  /** Evicts every ring buffer belonging to a removed row. */
  removeRow(_rowId: string | number): void {
    throw new Error('not-yet-implemented: TickHistory.removeRow ships in a later cycle-21f task');
  }

  /** Releases any subscriptions the bridge wired on construction. */
  destroy(): void {
    throw new Error('not-yet-implemented: TickHistory.destroy ships in a later cycle-21f task');
  }
}
