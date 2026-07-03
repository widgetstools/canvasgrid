// @cgrid/edit — shared fake TargetSurface for tests.
// Factory over an in-memory `rows` array (array index = visible row order),
// with overridable ranges / focused cell / editability. `getRowsByIndex` is a
// vi.fn spy so tests can assert batching behavior (spec §3.6a).
//
// SHARED: Task 5 (smart-edit) and Task 7 (bulk-update) both consume this.

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
