import type { SelectionRange } from '../types';

export type SelectionMode = 'none' | 'single' | 'multiple';

export interface SelectionState {
  focusedRowIndex: number | null;
  focusedColId: string | null;
  selectedRowIndices: Set<number>;
  /** Cell-range selection. Disjoint ranges supported (matches ag-grid).
   *  Cycle 9 / Task 1. */
  ranges: SelectionRange[];
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

  constructor(private mode: SelectionMode) {}

  get state(): Readonly<SelectionState> { return this._state; }

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
    // UI-driven focus has no rowId on the main thread (would need a reverse
    // chunk lookup that doesn't exist yet) — drop the persistent id so
    // rebuildIndices doesn't reinstate a stale focus row.
    this._focusedRowId = null;
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
    this._focusedRowId = null;
    if (!alreadyCollapsed) {
      this._state.ranges = [{ rowStart: rowIndex, rowEnd: rowIndex, colIds: [colId] }];
    }
    this.emit();
  }

  selectSingle(rowIndex: number): void {
    if (this.mode === 'none') return;
    this._state.selectedRowIndices.clear();
    this._state.selectedRowIndices.add(rowIndex);
    this._selectedRowIds.clear();
    this.emit();
  }

  toggleMulti(rowIndex: number): void {
    if (this.mode === 'none') return;
    if (this.mode === 'single') return this.selectSingle(rowIndex);
    if (this._state.selectedRowIndices.has(rowIndex)) this._state.selectedRowIndices.delete(rowIndex);
    else this._state.selectedRowIndices.add(rowIndex);
    // UI-driven toggles can't carry rowIds (no reverse index→id lookup on the
    // main thread), so persistent set is cleared — survival across re-sorts is
    // an API-only contract for Cycle 4.
    this._selectedRowIds.clear();
    this.emit();
  }

  range(fromRowIndex: number, toRowIndex: number): void {
    if (this.mode !== 'multiple') return;
    const lo = Math.min(fromRowIndex, toRowIndex);
    const hi = Math.max(fromRowIndex, toRowIndex);
    for (let i = lo; i <= hi; i++) this._state.selectedRowIndices.add(i);
    this._selectedRowIds.clear();
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
    if (this._selectedRowIds.size === 0 && this._focusedRowId === null) return;
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
