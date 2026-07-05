/**
 * Cycle 23 / Task 7 — coalesced `stateUpdated` emitter.
 *
 * Subscribes to the grid's own event emitter for every state-affecting
 * event (filterChanged, sortChanged, columnMoved, rowGroupOpened,
 * selectionChanged, bodyScrollEnd, etc.), maps each to the
 * corresponding `keyof GridState`, and accumulates the set. A single
 * `requestAnimationFrame` callback then emits ONE `stateUpdated` event
 * carrying the full snapshot + the merged changedKeys list, so apps
 * see at most one event per frame regardless of how many discrete
 * mutations landed.
 *
 * Source tagging: setState / initialState bump `source` to `'api'` /
 * `'init'` for the next coalesced emit (cleared after dispatch).
 * Everything else defaults to `'ui'`.
 */

import type { TypedEventEmitter } from './eventEmitter';
import type { CGridEvent } from '../types';
import type { GridState } from './stateSnapshot';

/** Persist keys the bus can mark dirty: every `GridState` field, plus the
 *  virtual `'layouts'` slot (Grid Layouts / A5) the layouts bundle folds
 *  into the persisted blob. */
type StateKey = keyof GridState | 'layouts';

/** Map of source-event type → the persist key it dirties. */
const EVENT_TO_KEY: Record<string, StateKey> = {
  filterChanged: 'filterModel',
  sortChanged: 'sortModel',
  columnMoved: 'columnState',
  columnResized: 'columnState',
  columnPinned: 'columnState',
  columnVisible: 'columnState',
  columnsReset: 'columnState',
  // Cycle 21i Phase 2 / T2 — the column-group overlay + open state live
  // in the `modules` envelope now, so both source events dirty `modules`;
  // engine slices signal through the generic `moduleStateChanged`.
  columnDefsChanged: 'modules',
  columnGroupOpened: 'modules',
  moduleStateChanged: 'modules',
  columnRowGroupChanged: 'rowGroupColumns',
  pivotStateChanged: 'pivotCols',
  rowGroupOpened: 'expandedRouteIds',
  expandOrCollapseAll: 'expandedRouteIds',
  selectionChanged: 'rowSelection',
  rangeSelectionChanged: 'cellSelection',
  cellSelectionChanged: 'cellSelection',
  sideBarVisibleChanged: 'sideBar',
  toolPanelVisibleChanged: 'sideBar',
  bodyScrollEnd: 'scroll',
  // Grid Layouts (A5) — any layout mutation dirties the virtual `layouts`
  // slot so the debounced autosave re-folds the bundle into the blob, even
  // when the mutation didn't change the live view (save/rename/delete-other).
  layoutChanged: 'layouts',
};

export class StateUpdatedBus {
  private pendingKeys = new Set<StateKey>();
  private pendingSource: 'api' | 'ui' | 'init' = 'ui';
  private frameHandle: ReturnType<typeof requestAnimationFrame> | null = null;
  private unsubscribers: Array<() => void> = [];
  private destroyed = false;

  constructor(
    private events: TypedEventEmitter<CGridEvent>,
    private snapshotState: () => GridState,
  ) {
    // Subscribe to every state-affecting event type. The handler
    // accumulates the changedKey + schedules the rAF emit.
    for (const [eventType, stateKey] of Object.entries(EVENT_TO_KEY)) {
      const unsub = this.events.on(eventType as any, () => this.markChanged(stateKey));
      this.unsubscribers.push(unsub);
    }
  }

  /** Tag the source for the NEXT coalesced emit. Cleared after dispatch.
   *  setState / initialState call this before mutating so the resulting
   *  cascade of internal events all collapse into one `stateUpdated`
   *  with the right tag. */
  setNextSource(source: 'api' | 'ui' | 'init'): void {
    this.pendingSource = source;
  }

  /** Hint that an explicit changedKey set should be merged into the next
   *  emit — used by setState to include every key the snapshot carried
   *  (not just the ones that fired internal events). */
  markChanged(key: StateKey): void {
    if (this.destroyed) return;
    this.pendingKeys.add(key);
    if (this.frameHandle === null) {
      this.frameHandle = requestAnimationFrame(() => this.flush());
    }
  }

  /** Force-emit the pending changes now. Used by tests + by
   *  `setState` when an app needs synchronous notification. */
  flush(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.pendingKeys.size === 0) return;
    const changedKeys = Array.from(this.pendingKeys);
    const source = this.pendingSource;
    this.pendingKeys.clear();
    this.pendingSource = 'ui';
    this.events.emit({
      type: 'stateUpdated',
      state: this.snapshotState(),
      changedKeys,
      source,
    } as any);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.pendingKeys.clear();
  }
}
