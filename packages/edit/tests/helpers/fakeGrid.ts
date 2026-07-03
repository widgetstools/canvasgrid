// @cgrid/edit — shared fake TargetSurface + fake KernelGridSurface for tests.
// Factory over an in-memory `rows` array (array index = visible row order),
// with overridable ranges / focused cell / editability. `getRowsByIndex` is a
// vi.fn spy so tests can assert batching behavior (spec §3.6a).
//
// SHARED: Task 5 (smart-edit) and Task 7 (bulk-update) consume `createFakeGrid`
// (the `TargetSurface` factory, UNCHANGED). Task 11 (bridge) additionally
// consumes `createFakeKernelGrid` below — a structural fake modeled on
// `packages/renderers/tests/bridge/wire.test.ts:14-66` (`on`/`addEventListener`
// handler map + `emit(type, e)` escape hatch + `_rows` same-array mutation
// hook for the mirror-staleness regression) and
// `packages/format/tests/bridge.test.ts` (structural-fake precedent). NO
// kernel imports anywhere in this file (Global Constraints).

import { vi } from 'vitest';
import type { TargetSurface } from '../../src/smartEdit';

export interface FakeRow {
  id: string;
  [field: string]: unknown;
}

export interface FakeColDef {
  colId: string;
  field: string;
  cellDataType?: string;
  /** Bridge-shaped (Task 11) — unused by Task 5/7's plain TargetSurface
   *  factory below, consumed by `createFakeKernelGrid`'s `getGridOption`
   *  leaf-walk for editability + valueParser/valueSetter replication. */
  editable?: boolean | ((p: { data: unknown; colId: string; rowIndex: number; value: unknown }) => boolean);
  valueParser?: (p: { newValue: unknown; oldValue: unknown; data: unknown; colDef: unknown }) => unknown;
  valueSetter?: (p: { data: unknown; newValue: unknown; oldValue: unknown; colDef: unknown }) => boolean | void;
}

export interface FakeGridOptions {
  rows: FakeRow[];
  colDefs: FakeColDef[];
  ranges?: Array<{ rowStart: number; rowEnd: number; colIds: string[] }>;
  focusedCell?: { rowIndex: number; colId: string } | null;
  /** Cells reported as NOT editable; everything else defaults to editable. */
  nonEditable?: Array<{ rowIndex: number; colId: string }>;
}

export interface FakeGrid {
  surface: TargetSurface;
  getRowsByIndexSpy: ReturnType<typeof vi.fn>;
  setRanges(ranges: Array<{ rowStart: number; rowEnd: number; colIds: string[] }>): void;
  setFocusedCell(cell: { rowIndex: number; colId: string } | null): void;
  setNonEditable(cells: Array<{ rowIndex: number; colId: string }>): void;
}

export function createFakeGrid(options: FakeGridOptions): FakeGrid {
  const { rows, colDefs } = options;
  let ranges = options.ranges ?? [];
  let focusedCell = options.focusedCell ?? null;
  let nonEditable = options.nonEditable ?? [];

  const colDefByColId = new Map(colDefs.map((c) => [c.colId, c]));

  const getRowsByIndexSpy = vi.fn(async (rowIndexes: number[]) => {
    return rowIndexes.map((rowIndex) => {
      const row = rows[rowIndex];
      if (!row) return null;
      return { rowIndex, rowId: row.id, data: row as Record<string, unknown> };
    });
  });

  const surface: TargetSurface = {
    getCellRanges: () => ranges,
    getFocusedCell: () => focusedCell,
    getRowsByIndex: getRowsByIndexSpy,
    isCellEditable: (rowIndex, colId) =>
      !nonEditable.some((c) => c.rowIndex === rowIndex && c.colId === colId),
    colMeta: (colId) => {
      const colDef = colDefByColId.get(colId);
      return colDef ? { field: colDef.field, cellDataType: colDef.cellDataType } : null;
    },
  };

  return {
    surface,
    getRowsByIndexSpy,
    setRanges(next) {
      ranges = next;
    },
    setFocusedCell(next) {
      focusedCell = next;
    },
    setNonEditable(next) {
      nonEditable = next;
    },
  };
}

// ─── Task 11 — fake KernelGridSurface (bridge tests) ────────────────────────

export interface FakeKernelRange {
  rowStart: number;
  rowEnd: number;
  colIds: string[];
}

export interface FakeKernelFocusedCell {
  rowId: string;
  colId: string;
}

export interface FakeKernelGridOptions {
  rows: FakeRow[];
  colDefs: FakeColDef[];
  ranges?: FakeKernelRange[];
  focusedCell?: FakeKernelFocusedCell | null;
  selectedRowIds?: string[];
}

export interface FakeKernelGrid {
  /** The structural surface passed to `wireEditIntoKernel`. */
  grid: Record<string, unknown>;
  emit(type: string, event: unknown): void;
  applyTransactionSpy: ReturnType<typeof vi.fn>;
  getDistinctValuesSpy: ReturnType<typeof vi.fn>;
  getRowsByIndexSpy: ReturnType<typeof vi.fn>;
  clearCellRangesSpy: ReturnType<typeof vi.fn>;
  addCellRangeSpy: ReturnType<typeof vi.fn>;
  setFocusedCellSpy: ReturnType<typeof vi.fn>;
  setSelectedRowIdsSpy: ReturnType<typeof vi.fn>;
  /** Ordered log of selection-mutation calls (`'clear' | 'add' | 'focus' |
   *  'rowIds'`) — asserts the snapshot/restore SEQUENCE (spec §3.3): clear
   *  → addCellRange loop → setFocusedCell → setSelectedRowIds. */
  selectionCallLog: string[];
  setRanges(ranges: FakeKernelRange[]): void;
  getRanges(): FakeKernelRange[];
  setFocusedCell(cell: FakeKernelFocusedCell | null): void;
  getFocusedCell(): FakeKernelFocusedCell | null;
  setSelectedRowIds(ids: string[]): void;
  getSelectedRowIds(): string[];
  setColDefs(colDefs: FakeColDef[]): void;
  /** SAME array `forEachRow`/`getRowsByIndex` read — mutating elements in
   *  place (new row objects, same rowIds) simulates a same-rowId
   *  `setRowData` WITHOUT a `rowsChanged` event (the mirror-staleness
   *  regression, renderers `wire.test.ts` `_rows` precedent). */
  _rows: FakeRow[];
}

/** Structural fake for the bridge's `KernelGridSurface` (Task 11). Public-API
 *  shaped: `on`/`addEventListener`/`removeEventListener` + `emit` escape
 *  hatch, `applyTransaction` spy, `forEachRow`, `getRowsByIndex` (resolves
 *  from `_rows` by index, kernel shape), `getCellRanges`/`addCellRange`/
 *  `clearCellRanges`, `getFocusedCell`/`setFocusedCell` (kernel shape —
 *  `{rowId, colId}`, NOT `{rowIndex, colId}` — distinct from
 *  `createFakeGrid`'s `TargetSurface.getFocusedCell`), `getSelectedRowIds`/
 *  `setSelectedRowIds`, `getDistinctValues` spy, `getGridOption('columnDefs')`
 *  returning the configurable `colDefs` (with `editable`/`valueParser`/
 *  `valueSetter`/`cellDataType`). */
export function createFakeKernelGrid(options: FakeKernelGridOptions): FakeKernelGrid {
  const rows = options.rows;
  let colDefs = options.colDefs;
  let ranges: FakeKernelRange[] = options.ranges ?? [];
  let focusedCell: FakeKernelFocusedCell | null = options.focusedCell ?? null;
  let selectedRowIds: string[] = options.selectedRowIds ?? [];

  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const selectionCallLog: string[] = [];

  const applyTransactionSpy = vi.fn();
  const getDistinctValuesSpy = vi.fn(async (colId: string, limit?: number) => {
    const seen: string[] = [];
    for (const row of rows) {
      const raw = row[colId];
      if (raw === undefined || raw === null) continue;
      const str = String(raw);
      if (!seen.includes(str)) seen.push(str);
      if (limit !== undefined && seen.length >= limit) break;
    }
    return seen;
  });
  const getRowsByIndexSpy = vi.fn(async (rowIndexes: number[]) => {
    return rowIndexes.map((rowIndex) => {
      const row = rows[rowIndex];
      if (!row) return null;
      return { rowIndex, rowId: row.id, data: row as Record<string, unknown> };
    });
  });
  const clearCellRangesSpy = vi.fn(() => {
    selectionCallLog.push('clear');
    ranges = [];
  });
  const addCellRangeSpy = vi.fn((range: FakeKernelRange) => {
    selectionCallLog.push('add');
    ranges = [...ranges, range];
  });
  const setFocusedCellSpy = vi.fn((rowId: string, colId: string) => {
    selectionCallLog.push('focus');
    focusedCell = { rowId, colId };
  });
  const setSelectedRowIdsSpy = vi.fn((ids: string[]) => {
    selectionCallLog.push('rowIds');
    selectedRowIds = ids;
  });

  const grid: Record<string, unknown> = {
    on(type: string, fn: (e: unknown) => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      return () => {
        const list = handlers.get(type) ?? [];
        handlers.set(type, list.filter((h) => h !== fn));
      };
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      return (grid.on as (t: string, f: (e: unknown) => void) => () => void)(type, fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      const list = handlers.get(type) ?? [];
      handlers.set(type, list.filter((h) => h !== fn));
    },
    emit(type: string, e: unknown) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn(e);
    },
    applyTransaction: applyTransactionSpy,
    forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void) {
      for (const r of rows) fn(r.id, r as Record<string, unknown>);
    },
    getRowsByIndex: getRowsByIndexSpy,
    getGridOption(key: string) {
      if (key === 'columnDefs') return colDefs;
      return undefined;
    },
    getCellRanges: () => ranges,
    addCellRange: addCellRangeSpy,
    clearCellRanges: clearCellRangesSpy,
    getFocusedCell: () => focusedCell,
    setFocusedCell: setFocusedCellSpy,
    getSelectedRowIds: () => selectedRowIds,
    setSelectedRowIds: setSelectedRowIdsSpy,
    getDistinctValues: getDistinctValuesSpy,
    _rows: rows,
  };

  return {
    grid,
    emit: grid.emit as (type: string, event: unknown) => void,
    applyTransactionSpy,
    getDistinctValuesSpy,
    getRowsByIndexSpy,
    clearCellRangesSpy,
    addCellRangeSpy,
    setFocusedCellSpy,
    setSelectedRowIdsSpy,
    selectionCallLog,
    setRanges(next) {
      ranges = next;
    },
    getRanges: () => ranges,
    setFocusedCell(next) {
      focusedCell = next;
    },
    getFocusedCell: () => focusedCell,
    setSelectedRowIds(next) {
      selectedRowIds = next;
    },
    getSelectedRowIds: () => selectedRowIds,
    setColDefs(next) {
      colDefs = next;
    },
    _rows: rows,
  };
}
