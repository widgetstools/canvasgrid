import type { SelectionRange } from '../types';

export type SelectionMode = 'none' | 'single' | 'multiple';

/** Cycle 15.5 / Task 5 — how a group-row checkbox cascades selection.
 *  - `'none'`               → no checkbox / no cascade (default).
 *  - `'self'`               → the group row is itself selectable; clicking
 *                             its checkbox selects/deselects only that row.
 *  - `'descendants'`        → cascade to ALL descendant leaf rows.
 *  - `'filteredDescendants'`→ cascade to only the currently-filtered
 *                             descendant leaf rows. */
export type GroupSelectsMode = 'none' | 'self' | 'descendants' | 'filteredDescendants';

export interface SelectionState {
  focusedRowIndex: number | null;
  focusedColId: string | null;
  selectedRowIndices: Set<number>;
  /** Cell-range selection. Disjoint ranges supported (matches ag-grid).
   *  Cycle 9 / Task 1. */
  ranges: SelectionRange[];
}

/** Cycle 15 / Task 8 — aggregate selection state across a group's
 *  descendants. Drives the auto-group cell's tri-state checkbox:
 *    - `'none'`      → empty checkbox
 *    - `'partial'`   → horizontal dash inside checkbox
 *    - `'all'`       → checkmark inside checkbox
 *
 *  Computed by `SelectionModel.getGroupSelectionState(groupKey)` by
 *  intersecting the persistent selected-id set with the descendant
 *  rowIds the membership resolver reports. */
export type GroupSelectionState = 'none' | 'partial' | 'all';

/** Cycle 15 / Task 8 — main-thread group membership resolver. The
 *  selection model uses this to cascade selection on group-row
 *  checkbox clicks AND to recompute a group's aggregate state for
 *  paint.
 *
 *  cgrid.ts implements this on top of a `groupKey → descendant rowIds`
 *  map populated from the worker's `groupKeysSnapshot` reply. Tests
 *  stub it with a synthetic in-memory map.
 *
 *  Returning `[]` for an unknown / collapsed key is the canonical
 *  "I don't know" answer — the selection model treats it as a group
 *  with zero descendants (selection state collapses to `'none'`),
 *  preserving a defensive paint instead of crashing. */
export interface GroupMembershipResolver {
  getDescendantRowIds(groupKey: string): readonly string[];
}

export class SelectionModel {
  private _state: SelectionState = {
    focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set(), ranges: [],
  };
  // ID-keyed shadow state. The API-driven setters populate this directly; the
  // UI-driven setters (selectSingle / toggleMulti / range) leave it empty.
  // Persistent ids survive a re-sort: cgrid.ts re-asks the worker for fresh
  // indices on `modelUpdated` and calls `rebuildIndices` to refresh
  // `selectedRowIndices` + `focusedRowIndex`.
  private _selectedRowIds: Set<string> = new Set();
  private _focusedRowId: string | null = null;
  private listeners = new Set<(s: Readonly<SelectionState>) => void>();
  /** Cycle 15 / Task 8 — tri-state cascading state. `false` (default)
   *  treats `setGroupSelected` as a no-op and reports every group as
   *  `'none'`; `true` enables the cascade + state computation against
   *  the membership resolver. */
  private _groupSelectsChildren = false;
  /** Cycle 15 / Task 8 — main-thread descendant resolver. Non-null only
   *  when cascading is enabled AND the host (cgrid.ts or a test) has
   *  supplied a resolver. */
  private _membership: GroupMembershipResolver | null = null;

  /** Cycle 15.5 / Task 5 — current group-selects mode. `'none'` disables
   *  all group checkbox machinery. `'self'` selects the group node itself.
   *  `'descendants'` / `'filteredDescendants'` cascade to leaf rows. */
  private _groupSelects: GroupSelectsMode = 'none';
  /** Cycle 15.5 / Task 5 — selected group keys for `'self'` mode. The
   *  keys are the same composite group key strings used everywhere else
   *  (e.g. `"desk:APAC"`). Not mixed into `_selectedRowIds` since they
   *  are group-node IDs, not data-row IDs. */
  private _selectedGroupKeys: Set<string> = new Set();
  /** Cycle 15.5 / Task 5 — filtered data-row ID set for
   *  `'filteredDescendants'` mode. Intersection gates which descendants
   *  get selected / count toward the tri-state. */
  private _filteredIds: ReadonlySet<string> | null = null;
  /** Cycle 21i / Phase 1 — main-thread index→rowId resolver. When set,
   *  the UI-driven setters (selectSingle / toggleMulti / range) record the
   *  selected row IDs so the selection survives `modelUpdated` (live
   *  transactions fire it constantly; `rebuildIndices` rebuilds the paint
   *  indices from these IDs). Was impossible when those setters were
   *  written — `rowIdAt` now resolves visible rows on the main thread. */
  private _resolveRowId: ((rowIndex: number) => string | null) | null = null;

  constructor(private mode: SelectionMode) {}

  /** Cycle 21i / Phase 1 — inject the index→rowId resolver (cgrid wires
   *  `rowIdAt`). Enables UI selection to persist across `modelUpdated`. */
  setRowIdResolver(fn: ((rowIndex: number) => string | null) | null): void {
    this._resolveRowId = fn;
  }

  /** Rebuild `_selectedRowIds` from the current paint indices via the
   *  resolver. No-op (clears IDs, legacy behaviour) when no resolver is
   *  wired. Called by the UI setters so a following `modelUpdated`
   *  preserves the selection instead of wiping it. */
  private syncIdsFromIndices(): void {
    if (!this._resolveRowId) { this._selectedRowIds.clear(); return; }
    const ids = new Set<string>();
    for (const idx of this._state.selectedRowIndices) {
      const id = this._resolveRowId(idx);
      if (id != null) ids.add(id);
    }
    this._selectedRowIds = ids;
  }

  get state(): Readonly<SelectionState> { return this._state; }
  /** Cycle 24 / Task 1 — expose the current selection mode so callers
   *  (e.g., `selectAll`) can gate themselves on whether multi-select is
   *  in effect. */
  getMode(): SelectionMode { return this.mode; }

  /** Swap the selection mode at runtime. Demotes the current selection when
   *  moving to a stricter mode (multiple→single drops all but one;
   *  any→'none' clears everything). Matches the runtime contract of
   *  `api.setGridOption('rowSelection', ...)`. */
  setMode(mode: SelectionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'none' && this._state.selectedRowIndices.size > 0) {
      this._state.selectedRowIndices.clear();
      this._selectedRowIds.clear();
      this.emit();
    } else if (mode === 'single' && this._state.selectedRowIndices.size > 1) {
      const first = this._state.selectedRowIndices.values().next().value;
      this._state.selectedRowIndices.clear();
      if (first !== undefined) this._state.selectedRowIndices.add(first);
      // Demote the persistent id set in lockstep so a later rebuild doesn't
      // re-inflate the selection past a single row.
      const firstId = this._selectedRowIds.values().next().value;
      this._selectedRowIds.clear();
      if (firstId !== undefined) this._selectedRowIds.add(firstId);
      this.emit();
    }
  }

  setFocus(rowIndex: number | null, colId: string | null): void {
    if (this._state.focusedRowIndex === rowIndex && this._state.focusedColId === colId) return;
    this._state.focusedRowIndex = rowIndex;
    this._state.focusedColId = colId;
    // Cycle 21i — record the focused rowId (via the resolver) so the focus
    // ring survives `modelUpdated`; null when no resolver / no row.
    this._focusedRowId = rowIndex != null && this._resolveRowId
      ? this._resolveRowId(rowIndex)
      : null;
    this.emit();
  }

  /** Move focus to (rowIndex, colId) AND collapse ranges to a 1×1 range at
   *  the new focused cell — in a single emit, so the focus ring + range
   *  overlay always paint at the same place. Used by every keyboard
   *  navigation path (Arrow / Tab / Home / End / PageUp / PageDown /
   *  Enter-nav). Mouse-driven focus moves keep `setFocus` so the multi-cell
   *  range built by drag / shift-click survives the trailing `setFocus`
   *  in `CellSelection.handleMouseDown`. */
  setFocusAndCollapseRanges(rowIndex: number, colId: string): void {
    const focusChanged = this._state.focusedRowIndex !== rowIndex
      || this._state.focusedColId !== colId;
    const current = this._state.ranges;
    const alreadyCollapsed = current.length === 1
      && current[0]!.rowStart === rowIndex
      && current[0]!.rowEnd === rowIndex
      && current[0]!.colIds.length === 1
      && current[0]!.colIds[0] === colId;
    if (!focusChanged && alreadyCollapsed) return;
    this._state.focusedRowIndex = rowIndex;
    this._state.focusedColId = colId;
    // Cycle 21i — record focused rowId so the focus ring survives modelUpdated.
    this._focusedRowId = this._resolveRowId ? this._resolveRowId(rowIndex) : null;
    if (!alreadyCollapsed) {
      this._state.ranges = [{ rowStart: rowIndex, rowEnd: rowIndex, colIds: [colId] }];
    }
    this.emit();
  }

  selectSingle(rowIndex: number): void {
    if (this.mode === 'none') return;
    this._state.selectedRowIndices.clear();
    this._state.selectedRowIndices.add(rowIndex);
    this.syncIdsFromIndices();
    this.emit();
  }

  toggleMulti(rowIndex: number): void {
    if (this.mode === 'none') return;
    if (this.mode === 'single') return this.selectSingle(rowIndex);
    if (this._state.selectedRowIndices.has(rowIndex)) this._state.selectedRowIndices.delete(rowIndex);
    else this._state.selectedRowIndices.add(rowIndex);
    // Cycle 21i — record the row IDs (via the injected resolver) so the
    // toggle survives `modelUpdated`; falls back to clearing when no
    // resolver is wired.
    this.syncIdsFromIndices();
    this.emit();
  }

  range(fromRowIndex: number, toRowIndex: number): void {
    if (this.mode !== 'multiple') return;
    const lo = Math.min(fromRowIndex, toRowIndex);
    const hi = Math.max(fromRowIndex, toRowIndex);
    for (let i = lo; i <= hi; i++) this._state.selectedRowIndices.add(i);
    this.syncIdsFromIndices();
    this.emit();
  }

  clear(): void {
    this._state.selectedRowIndices.clear();
    this._selectedRowIds.clear();
    this.emit();
  }

  /** Replace the entire ranges list. Pass `[]` to clear. Fires onChange.
   *  Cycle 9 / Task 1. */
  setRanges(ranges: SelectionRange[]): void {
    this._state.ranges = ranges.slice();
    this.emit();
  }

  /** Append a range to the list. Fires onChange. Cycle 9 / Task 1. */
  addRange(range: SelectionRange): void {
    this._state.ranges.push(range);
    this.emit();
  }

  /** Widen the LAST range to cover the new anchor:
   *  rowEnd = max(rowEnd, rowIndex); colIds gains `colId` if not already
   *  present. No-op (and no emit) when the ranges list is empty.
   *  Cycle 9 / Task 1. */
  extendRange(rowIndex: number, colId: string): void {
    const ranges = this._state.ranges;
    if (ranges.length === 0) return;
    const last = ranges[ranges.length - 1]!;
    const nextRowEnd = Math.max(last.rowEnd, rowIndex);
    const hasCol = last.colIds.includes(colId);
    const nextColIds = hasCol ? last.colIds : [...last.colIds, colId];
    ranges[ranges.length - 1] = { rowStart: last.rowStart, rowEnd: nextRowEnd, colIds: nextColIds };
    this.emit();
  }

  /** Widen the LAST range so it covers the clicked cell as a contiguous
   *  rect: `rowStart = min(last.rowStart, rowIndex)`,
   *  `rowEnd = max(last.rowEnd, rowIndex)`, and colIds becomes the
   *  contiguous render-order slice from the smallest to the largest of
   *  the last range's first/last colId index + the clicked colId index.
   *  No-op (no emit) when the ranges list is empty or `colId` isn't in
   *  `allColIds`. Cycle 9 / Task 4 (shift-click extend). */
  extendLastRangeToCell(
    rowIndex: number,
    colId: string,
    allColIds: readonly string[],
  ): void {
    const ranges = this._state.ranges;
    if (ranges.length === 0) return;
    const clickedIdx = allColIds.indexOf(colId);
    if (clickedIdx < 0) return;
    const last = ranges[ranges.length - 1]!;
    const firstIdx = allColIds.indexOf(last.colIds[0]!);
    const lastIdx = allColIds.indexOf(last.colIds[last.colIds.length - 1]!);
    const lo = Math.min(firstIdx, lastIdx, clickedIdx);
    const hi = Math.max(firstIdx, lastIdx, clickedIdx);
    const nextColIds = allColIds.slice(lo, hi + 1);
    const nextRowStart = Math.min(last.rowStart, rowIndex);
    const nextRowEnd = Math.max(last.rowEnd, rowIndex);
    ranges[ranges.length - 1] = { rowStart: nextRowStart, rowEnd: nextRowEnd, colIds: nextColIds };
    this.emit();
  }

  /** Select a whole column band: ranges become a single rect
   *  `{rowStart: 0, rowEnd: rowCount-1, colIds: [colId]}`. When
   *  `extend` is true AND the last range is already a full column
   *  band (its row span covers every row), expand its colIds to
   *  include every column between its existing span and `colId` in
   *  render order. When `extend` is true but the last range is not a
   *  full column band, falls through to the plain replacement so the
   *  header click still produces a deterministic single-column band.
   *  No-op (no emit) when `rowCount` is 0 or `colId` is unknown.
   *  Cycle 9 / Task 4 (header-click whole-column + shift-extend). */
  selectColumnBand(
    colId: string,
    allColIds: readonly string[],
    rowCount: number,
    extend: boolean,
  ): void {
    if (rowCount <= 0) return;
    const clickedIdx = allColIds.indexOf(colId);
    if (clickedIdx < 0) return;
    const rowEnd = rowCount - 1;
    const ranges = this._state.ranges;
    const last = ranges.length > 0 ? ranges[ranges.length - 1]! : null;
    const isColumnBand = last !== null && last.rowStart === 0 && last.rowEnd === rowEnd;
    if (extend && isColumnBand && last) {
      const firstIdx = allColIds.indexOf(last.colIds[0]!);
      const lastIdx = allColIds.indexOf(last.colIds[last.colIds.length - 1]!);
      const lo = Math.min(firstIdx, lastIdx, clickedIdx);
      const hi = Math.max(firstIdx, lastIdx, clickedIdx);
      const nextColIds = allColIds.slice(lo, hi + 1);
      ranges[ranges.length - 1] = { rowStart: 0, rowEnd, colIds: nextColIds };
      this.emit();
      return;
    }
    this._state.ranges = [{ rowStart: 0, rowEnd, colIds: [colId] }];
    this.emit();
  }

  /** Drop every range. No-op (no emit) when already empty. Row selection
   *  and focused cell are unaffected. Cycle 9 / Task 1. */
  clearRanges(): void {
    if (this._state.ranges.length === 0) return;
    this._state.ranges = [];
    this.emit();
  }

  /** Snapshot of the current ranges. Mutating the returned array does
   *  not affect selection state. Cycle 9 / Task 1. */
  getRanges(): SelectionRange[] {
    return this._state.ranges.slice();
  }

  /** True when `(rowIndex, colId)` falls inside any rect in `state.ranges`.
   *  Used by mousedown handlers to decide whether a right-click should
   *  preserve the existing range (click landed INSIDE) or replace it
   *  (click landed OUTSIDE). Cycle 9 patch / Task 1. */
  isInsideAnyRange(rowIndex: number, colId: string): boolean {
    const ranges = this._state.ranges;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      if (rowIndex >= r.rowStart && rowIndex <= r.rowEnd && r.colIds.includes(colId)) {
        return true;
      }
    }
    return false;
  }

  /** API path: set focus by rowId. Caller resolves the index via the worker
   *  (or passes -1 / null when the row is unknown). The persistent id is
   *  kept even when the index is unresolved so a later rebuild can restore
   *  paint after the row reappears. */
  setFocusByRowId(rowId: string | null, colId: string | null, rowIndex: number | null): void {
    const paintIdx = rowIndex !== null && rowIndex >= 0 ? rowIndex : null;
    if (this._focusedRowId === rowId
      && this._state.focusedColId === colId
      && this._state.focusedRowIndex === paintIdx) return;
    this._focusedRowId = rowId;
    this._state.focusedRowIndex = paintIdx;
    this._state.focusedColId = colId;
    this.emit();
  }

  /** API path: set selection by rowIds. `resolvedIndices[i]` is the current
   *  visible-row index for `ids[i]`, or -1 when filtered out / unknown.
   *  Persistent ids are kept verbatim; only ids with a non-negative index
   *  enter the paint set. `mode='single'` truncates to the first id; `'none'`
   *  is a no-op. */
  setSelectedRowIds(ids: string[], resolvedIndices: number[]): void {
    if (this.mode === 'none') return;
    let acceptedIds: string[];
    let acceptedIndices: number[];
    if (this.mode === 'single') {
      acceptedIds = ids.length > 0 ? [ids[0]!] : [];
      acceptedIndices = resolvedIndices.length > 0 ? [resolvedIndices[0]!] : [];
    } else {
      acceptedIds = ids;
      acceptedIndices = resolvedIndices;
    }
    this._selectedRowIds = new Set(acceptedIds);
    const next = new Set<number>();
    for (let i = 0; i < acceptedIndices.length; i++) {
      const idx = acceptedIndices[i]!;
      if (idx >= 0) next.add(idx);
    }
    this._state.selectedRowIndices = next;
    this.emit();
  }

  /** Re-derive `selectedRowIndices` + `focusedRowIndex` from the persistent
   *  id set, using a freshly-built rowId → index map. Called by cgrid.ts on
   *  `modelUpdated` (after sort / transaction / column-defs change). Skips
   *  the emit when nothing actually changes so a steady-state model update
   *  doesn't churn paint. */
  rebuildIndices(rowIdToIndex: ReadonlyMap<string, number>): void {
    // Skip only when there is genuinely nothing to update — both the
    // persistent id sets are empty AND the paint indices are already clear.
    // Without the selectedRowIndices guard, a deselect-all that empties
    // _selectedRowIds would skip the loop and leave stale paint highlights.
    if (this._selectedRowIds.size === 0 && this._focusedRowId === null
        && this._state.selectedRowIndices.size === 0 && this._state.focusedRowIndex === null) return;
    let changed = false;

    const nextSelectedIndices = new Set<number>();
    for (const id of this._selectedRowIds) {
      const idx = rowIdToIndex.get(id);
      if (idx !== undefined && idx >= 0) nextSelectedIndices.add(idx);
    }
    if (nextSelectedIndices.size !== this._state.selectedRowIndices.size
      || ![...nextSelectedIndices].every((i) => this._state.selectedRowIndices.has(i))) {
      this._state.selectedRowIndices = nextSelectedIndices;
      changed = true;
    }

    if (this._focusedRowId !== null) {
      const idx = rowIdToIndex.get(this._focusedRowId);
      const nextFocus = idx === undefined || idx < 0 ? null : idx;
      if (this._state.focusedRowIndex !== nextFocus) {
        this._state.focusedRowIndex = nextFocus;
        changed = true;
      }
    }

    if (changed) this.emit();
  }

  /** Snapshot of the persistent selected-id set, in insertion order. */
  getPersistentSelectedRowIds(): string[] { return Array.from(this._selectedRowIds); }

  /** Cycle 15 / Task 8 — enable or disable `groupSelectsChildren`
   *  semantics. The membership resolver is consulted by
   *  `setGroupSelected` to cascade selection and by
   *  `getGroupSelectionState` to recompute the aggregate state for
   *  paint.
   *
   *  Disabling does NOT clear the existing selected-id set — leaf rows
   *  selected while cascading was on stay selected; the model just
   *  reverts to plain leaf-row semantics for subsequent calls. This
   *  mirrors the runtime contract of `setGridOption('rowSelection', …)`
   *  (Cycle 4): runtime toggles preserve in-flight state where
   *  possible. */
  setGroupSelectsChildren(enabled: boolean, membership: GroupMembershipResolver | null): void {
    this._groupSelectsChildren = enabled;
    this._membership = enabled ? membership : null;
  }

  /** Cycle 15 / Task 8 — current `groupSelectsChildren` setting.
   *  Used by tests + the auto-group renderer's `'checkbox visible'`
   *  gate (the renderer omits the checkbox entirely when cascading
   *  is off — there is no "leaf-row" auto-group cell in Cycle 15). */
  isGroupSelectsChildren(): boolean { return this._groupSelectsChildren; }

  /** Cycle 15.5 / Task 5 — read the current group-selects mode. */
  getGroupSelects(): GroupSelectsMode { return this._groupSelects; }

  /** Cycle 15.5 / Task 5 — configure the group-selects mode atomically.
   *  Replaces the Task 8 `setGroupSelectsChildren` escape hatch with a
   *  3-mode discriminated union. `membership` is required for
   *  `'descendants'` / `'filteredDescendants'`; pass `null` otherwise.
   *  `filteredIds` is used only by `'filteredDescendants'` — supply it
   *  from the worker's current filtered-row set, refreshed on every
   *  transaction or filter change.
   *
   *  Calling this with `'none'` disables group checkbox machinery but
   *  does NOT clear the current selected-id set — leaf rows selected
   *  during a prior cascade remain selected (mirrors the runtime toggle
   *  contract of `setGridOption('rowSelection', …)`). */
  setGroupSelects(
    mode: GroupSelectsMode,
    membership: GroupMembershipResolver | null,
    filteredIds?: ReadonlySet<string>,
  ): void {
    this._groupSelects = mode;
    this._membership = (mode === 'descendants' || mode === 'filteredDescendants') ? membership : null;
    this._filteredIds = filteredIds ?? null;
    // Keep the Task 8 bool in sync for any callers that still use the old API.
    this._groupSelectsChildren = mode === 'descendants' || mode === 'filteredDescendants';
  }

  /** Cycle 15.5 / Task 5 — update the filtered ID set used by
   *  `'filteredDescendants'` mode (call on every filter change). Has no
   *  effect in other modes. No emit: changes take effect on the next
   *  `getGroupSelectionState` / `setGroupSelected` call. */
  setFilteredIds(filteredIds: ReadonlySet<string>): void {
    this._filteredIds = filteredIds;
  }

  /** Cycle 15.5 / Task 5 — clear the `'self'` group-key selection set.
   *  Does not touch the data-row selection set. No-op when the set is
   *  already empty (no emit). */
  clearGroupKeySelection(): void {
    if (this._selectedGroupKeys.size === 0) return;
    this._selectedGroupKeys.clear();
    this.emit();
  }

  /** Cycle 15.5 / Task 5 — snapshot of the selected group keys in
   *  `'self'` mode. Empty array when in other modes or nothing is
   *  selected. */
  getSelectedGroupKeys(): string[] { return Array.from(this._selectedGroupKeys); }

  /** Cycle 15 / Task 8 — cascade-select / deselect every descendant
   *  leaf row under `groupKey`. No-op when cascading is off, when
   *  membership isn't wired, or when the resolver reports zero
   *  descendants (unknown / collapsed key).
   *
   *  Idempotent — if every descendant is already in the requested
   *  state, the selected-id set is unchanged AND no emit fires.
   *  Triggers a single `emit()` when the set actually mutates.
   *
   *  In `'single'` mode this is a no-op: a group click would imply
   *  selecting many rows at once, which violates the "single" contract.
   *  Callers in `'single'` mode should not surface group checkboxes
   *  at all (`groupSelectsChildren` is meaningless under single
   *  selection); the no-op here is purely a defensive guard. */
  setGroupSelected(groupKey: string, selected: boolean): void {
    // Cycle 15.5 / Task 5 — 'self' mode: select the group node itself.
    if (this._groupSelects === 'self') {
      if (this.mode === 'none') return;
      const had = this._selectedGroupKeys.has(groupKey);
      if (selected === had) return;
      if (selected) this._selectedGroupKeys.add(groupKey);
      else this._selectedGroupKeys.delete(groupKey);
      this.emit();
      return;
    }
    if (!this._groupSelectsChildren) return;
    if (this.mode !== 'multiple') return;
    if (!this._membership) return;
    let descendants: readonly string[] = this._membership.getDescendantRowIds(groupKey);
    // Cycle 15.5 / Task 5 — 'filteredDescendants': gate on the current
    // filter set. Descendants that don't pass the filter are invisible
    // to the cascade and to the tri-state count.
    if (this._groupSelects === 'filteredDescendants' && this._filteredIds !== null) {
      const filtered = this._filteredIds;
      descendants = descendants.filter(id => filtered.has(id));
    }
    if (descendants.length === 0) return;
    const before = this._selectedRowIds.size;
    if (selected) {
      for (const id of descendants) this._selectedRowIds.add(id);
    } else {
      for (const id of descendants) this._selectedRowIds.delete(id);
    }
    if (this._selectedRowIds.size === before) {
      return;
    }
    this.emit();
  }

  /** Cycle 15 / Task 8 — aggregate selection state across every
   *  descendant of `groupKey`. Returns:
   *    - `'none'` when no descendant is selected (OR when cascading is
   *      off / membership isn't wired / the key is unknown — every
   *      "I don't know" answer collapses to `'none'` so paint
   *      defensively shows an empty checkbox).
   *    - `'all'` when every descendant is in the persistent selected set.
   *    - `'partial'` when at least one but not every descendant is
   *      selected.
   *
   *  Reads from the persistent id set (not the index set) so the
   *  computation is correct even when the grid is partially scrolled,
   *  filtered, or collapsed — the descendants that aren't currently
   *  visible still count. */
  getGroupSelectionState(groupKey: string): GroupSelectionState {
    // Cycle 15.5 / Task 5 — 'self' mode: binary state (no tri-state partial).
    if (this._groupSelects === 'self') {
      return this._selectedGroupKeys.has(groupKey) ? 'all' : 'none';
    }
    if (!this._groupSelectsChildren) return 'none';
    if (!this._membership) return 'none';
    let descendants: readonly string[] = this._membership.getDescendantRowIds(groupKey);
    // Cycle 15.5 / Task 5 — 'filteredDescendants': count only those that
    // pass the filter. Matches the cascade in setGroupSelected.
    if (this._groupSelects === 'filteredDescendants' && this._filteredIds !== null) {
      const filtered = this._filteredIds;
      descendants = descendants.filter(id => filtered.has(id));
    }
    if (descendants.length === 0) return 'none';
    let selectedCount = 0;
    for (const id of descendants) {
      if (this._selectedRowIds.has(id)) selectedCount++;
    }
    if (selectedCount === 0) return 'none';
    if (selectedCount === descendants.length) return 'all';
    return 'partial';
  }

  /** The persistent focused rowId, or null when focus is index-only / cleared. */
  getPersistentFocusedRowId(): string | null { return this._focusedRowId; }

  onChange(fn: (s: Readonly<SelectionState>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this._state);
  }
}
