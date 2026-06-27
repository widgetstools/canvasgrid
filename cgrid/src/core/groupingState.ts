/**
 * Cycle 15.5 / Task 1 — GroupingState primitive.
 *
 * The single canonical source-of-truth for everything THREE grouping
 * surfaces (row group panel — Cycle 15 / Task 6 + 15.5 / Task 1;
 * columns tool panel Row Groups drop zone — 15.5 / Task 2; column
 * header context menu Group / Un-Group items — 15.5 / Task 2) mutate.
 *
 * Each surface calls one of the primitive verbs below to change the
 * grouping model. The primitive emits a `groupingStateChanged` event;
 * every other surface that subscribed re-renders from the new state.
 * This is the "three views over one ordered list" invariant the
 * Cycle 15.5 worklog calls load-bearing — Task 11's perf gate
 * asserts mutating via any one view re-renders the others.
 *
 *   ┌─────────────────────┐
 *   │  Row group panel    │──┐
 *   └─────────────────────┘  │
 *   ┌─────────────────────┐  │   ┌────────────────────┐
 *   │  Tool panel zone    │──┼──>│   GroupingState    │
 *   └─────────────────────┘  │   │   (this module)    │
 *   ┌─────────────────────┐  │   └────────────────────┘
 *   │  Context menu items │──┘            │
 *   └─────────────────────┘               │  emits
 *                  ▲                       │  groupingStateChanged
 *                  └───────── subscribe ───┘
 *
 * The state shape:
 *  - `rowGroupColumns: string[]` — ordered colIds; index IS nesting
 *    depth (`rowGroupColumns[0]` = outermost group level).
 *  - `perLevelSort: Array<{ asc: boolean } | null>` — parallel to
 *    `rowGroupColumns`; `null` at index i means "no sort applied at
 *    level i" (the auto-group column at that level renders no sort
 *    indicator). The pill at index i carries the sort indicator
 *    derived from this entry.
 *
 * `expandedRoutes` lives on the grid's expansion mirror (Cycle 15 /
 * Task 7) — it is NOT modelled here. This module's mandate is the
 * ORDERED LIST + the per-level sort decoration; expansion lives in
 * a different lifecycle (worker round-trip, persist across model
 * swaps, mirror sentinel for default-all). Folding expansion into
 * this state object would conflate two lifecycles. See worklog
 * "Architecture" section — `expandedRoutes` is listed alongside
 * `rowGroupColumns` for the spec doc; the implementation keeps them
 * apart for clarity.
 *
 * Sort direction names:
 *  - `'asc'` — ascending (smaller → larger).
 *  - `'desc'` — descending (larger → smaller).
 *  - `null` — no sort at this level (the level uses the group key's
 *    natural order, or the worker's default for the column).
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md
 *   § Cycle 15.5 / Task 1.
 */

import { TypedEventEmitter } from './eventEmitter';

/** Sort direction for a per-level grouping sort entry. `null` means
 *  "no sort applied at this level." */
export type GroupingSortDirection = 'asc' | 'desc' | null;

/** Per-level sort entry. `null` at index i in `perLevelSort` means
 *  "no sort at level i." Wrapping in an object instead of using the
 *  raw direction keeps the door open for future fields (e.g. a custom
 *  comparator ref) without breaking the storage shape. */
export interface GroupingSortEntry {
  /** Sort direction at this group level. */
  direction: 'asc' | 'desc';
}

/** Event payload emitted whenever the grouping state mutates via the
 *  primitive API. Carries the NEW state snapshots so subscribers can
 *  diff against their last-known copy. */
export interface GroupingStateChangedEvent {
  type: 'groupingStateChanged';
  /** The current `rowGroupColumns` after the mutation, in nesting
   *  order. Subscribers receive a fresh array each emit — mutations
   *  on this array DO NOT affect state. */
  rowGroupColumns: string[];
  /** Parallel to `rowGroupColumns`. `null` at index i means no sort
   *  applied at level i. Subscribers receive a fresh array each emit. */
  perLevelSort: Array<GroupingSortEntry | null>;
  /** The verb that caused the change. Lets a subscriber distinguish
   *  e.g. a `'move'` from a `'set'` — useful for analytics or for
   *  selectively re-rendering when only sort decoration shifted. */
  source: GroupingStateChangeSource;
}

/** Discriminant for the verb that produced a `groupingStateChanged`
 *  event. Mirrors the public API surface verbs one-for-one. */
export type GroupingStateChangeSource =
  | 'set'
  | 'add'
  | 'remove'
  | 'move'
  | 'sort';

/** The single state primitive. One instance lives on `CGrid`; the
 *  three grouping UIs read from + mutate via it.
 *
 *  Construction:
 *    `new GroupingState({ rowGroupColumns: [...] })` — seeds with an
 *    initial column order (passed by the grid from `options.groupModel`
 *    or `setGroupModel`). All sort entries default to `null`.
 *
 *  Mutation:
 *    `setRowGroupColumns`, `addRowGroupColumn`, `removeRowGroupColumn`,
 *    `moveRowGroupColumn(from, to)`, `setRowGroupColumnSort(colId, dir)`.
 *
 *  Subscribe:
 *    `on('groupingStateChanged', handler) → unsubscribe()`. The
 *    handler receives a fresh state snapshot on every change.
 */
export class GroupingState {
  private rowGroupColumns: string[];
  /** Parallel to `rowGroupColumns`. `null` at index i means no sort
   *  applied at level i. Length is always `rowGroupColumns.length`. */
  private perLevelSort: Array<GroupingSortEntry | null>;
  private readonly events = new TypedEventEmitter<GroupingStateChangedEvent>();
  private destroyed = false;

  constructor(init?: { rowGroupColumns?: string[] }) {
    this.rowGroupColumns = [...(init?.rowGroupColumns ?? [])];
    this.perLevelSort = this.rowGroupColumns.map(() => null);
  }

  /** Read-only snapshot of the current ordered column id list. Returns
   *  a fresh array — callers are free to mutate without affecting
   *  state. */
  getRowGroupColumns(): string[] {
    return [...this.rowGroupColumns];
  }

  /** Read-only snapshot of the per-level sort entries. Returns a fresh
   *  array — callers are free to mutate without affecting state. */
  getPerLevelSort(): Array<GroupingSortEntry | null> {
    return this.perLevelSort.map((entry) => (entry === null ? null : { direction: entry.direction }));
  }

  /** Look up the sort entry at the level for `colId`. Returns `null`
   *  when no sort is applied OR when `colId` isn't in the row group
   *  column list. */
  getSortFor(colId: string): GroupingSortEntry | null {
    const idx = this.rowGroupColumns.indexOf(colId);
    if (idx < 0) return null;
    const entry = this.perLevelSort[idx];
    if (entry === undefined || entry === null) return null;
    return { direction: entry.direction };
  }

  /** Replace the entire ordered column list with `nextColumns`. Any
   *  columns shared with the previous list KEEP their per-level sort
   *  entry (looked up by colId); columns dropped from the list lose
   *  their sort entry; columns added gain a `null` sort entry. This is
   *  the "load model from outside" verb — used by `setGroupModel` and
   *  by Grid State restore. */
  setRowGroupColumns(nextColumns: string[]): void {
    if (this.destroyed) return;
    const next = [...nextColumns];
    if (arrayEqual(next, this.rowGroupColumns)) return;
    // Preserve per-level sort by colId: a column that survives the
    // swap keeps its sort entry; a column added gains null; a column
    // dropped loses its entry.
    const prevByColId = new Map<string, GroupingSortEntry | null>();
    for (let i = 0; i < this.rowGroupColumns.length; i++) {
      prevByColId.set(this.rowGroupColumns[i]!, this.perLevelSort[i] ?? null);
    }
    this.rowGroupColumns = next;
    this.perLevelSort = next.map((colId) => {
      const entry = prevByColId.get(colId);
      if (entry === undefined || entry === null) return null;
      return { direction: entry.direction };
    });
    this.emitChanged('set');
  }

  /** Append `colId` to the end of the list. Idempotent — appending a
   *  column already in the list is a no-op (no event fires). */
  addRowGroupColumn(colId: string): void {
    if (this.destroyed) return;
    if (this.rowGroupColumns.includes(colId)) return;
    this.rowGroupColumns = [...this.rowGroupColumns, colId];
    this.perLevelSort = [...this.perLevelSort, null];
    this.emitChanged('add');
  }

  /** Remove `colId` from the list. Idempotent — removing a column that
   *  isn't in the list is a no-op (no event fires). */
  removeRowGroupColumn(colId: string): void {
    if (this.destroyed) return;
    const idx = this.rowGroupColumns.indexOf(colId);
    if (idx < 0) return;
    this.rowGroupColumns = [
      ...this.rowGroupColumns.slice(0, idx),
      ...this.rowGroupColumns.slice(idx + 1),
    ];
    this.perLevelSort = [
      ...this.perLevelSort.slice(0, idx),
      ...this.perLevelSort.slice(idx + 1),
    ];
    this.emitChanged('remove');
  }

  /** Move the column at index `from` to index `to`. Both indices are
   *  clamped to `[0, length]` — `to === length` slots the column at
   *  the end of the list. The corresponding per-level sort entry
   *  travels with the column. No-op when `from === to` OR `from` is
   *  out of range OR both indices resolve to the same final slot. */
  moveRowGroupColumn(from: number, to: number): void {
    if (this.destroyed) return;
    const len = this.rowGroupColumns.length;
    if (from < 0 || from >= len) return;
    const targetIdx = to < 0 ? 0 : to > len ? len : to;
    // Splice semantics: removing element shifts the array, so when
    // moving forward, target index resolves to (to - 1) once the
    // source is plucked. We normalise both directions to land at the
    // "after this many remaining elements" slot the caller intends.
    let normalised = targetIdx;
    if (targetIdx > from) normalised = targetIdx - 1;
    if (normalised === from) return;
    const nextCols = [...this.rowGroupColumns];
    const nextSort = [...this.perLevelSort];
    const [pluckedCol] = nextCols.splice(from, 1);
    const [pluckedSort] = nextSort.splice(from, 1);
    nextCols.splice(normalised, 0, pluckedCol!);
    nextSort.splice(normalised, 0, pluckedSort ?? null);
    this.rowGroupColumns = nextCols;
    this.perLevelSort = nextSort;
    this.emitChanged('move');
  }

  /** Set the sort entry for the level holding `colId`. `direction`
   *  `null` clears the sort at that level. No-op when `colId` isn't in
   *  the list OR the requested direction equals the current entry. */
  setRowGroupColumnSort(colId: string, direction: GroupingSortDirection): void {
    if (this.destroyed) return;
    const idx = this.rowGroupColumns.indexOf(colId);
    if (idx < 0) return;
    const current = this.perLevelSort[idx] ?? null;
    if (direction === null) {
      if (current === null) return;
      const next = [...this.perLevelSort];
      next[idx] = null;
      this.perLevelSort = next;
    } else {
      if (current !== null && current.direction === direction) return;
      const next = [...this.perLevelSort];
      next[idx] = { direction };
      this.perLevelSort = next;
    }
    this.emitChanged('sort');
  }

  /** Subscribe to mutations. Returns the unsubscribe function. */
  on(
    type: 'groupingStateChanged',
    handler: (event: GroupingStateChangedEvent) => void,
  ): () => void {
    return this.events.on(type, handler);
  }

  /** Tear down. Releases all subscribers. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.destroy();
  }

  private emitChanged(source: GroupingStateChangeSource): void {
    this.events.emit({
      type: 'groupingStateChanged',
      rowGroupColumns: [...this.rowGroupColumns],
      perLevelSort: this.perLevelSort.map((entry) =>
        entry === null ? null : { direction: entry.direction },
      ),
      source,
    });
  }
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
