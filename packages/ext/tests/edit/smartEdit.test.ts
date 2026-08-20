// @wellsfargo-starui/velocity-grid-ext/edit — smartEdit.test.ts
// Covers collectTargetCells (async target collection, spec §3.6a) and
// buildSmartEditPatches.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.4, §3.6a.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 5 Step 1 (9 cases).

import { describe, it, expect } from 'vitest';
import { collectTargetCells, buildSmartEditPatches } from '../../src/edit/smartEdit';
import type { CellTarget } from '../../src/edit/patches';
import { createFakeGrid, type FakeRow, type FakeColDef } from './helpers/fakeGrid';

const rows: FakeRow[] = [
  { id: 'r0', qty: 10, price: 1.5, name: 'a' },
  { id: 'r1', qty: 20, price: 2.5, name: 'b' },
  { id: 'r2', qty: 30, price: 3.5, name: 'c' },
  { id: 'r3', qty: 40, price: 4.5, name: 'd' },
];

const colDefs: FakeColDef[] = [
  { colId: 'qty', field: 'qty', cellDataType: 'number' },
  { colId: 'price', field: 'price', cellDataType: 'number' },
  { colId: 'name', field: 'name', cellDataType: 'text' },
  // field-aliased column: colId differs from the underlying data field.
  { colId: 'quantity', field: 'qty', cellDataType: 'number' },
];

describe('collectTargetCells', () => {
  it('single range yields one target per (rowIndex, colId) in range', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }],
    });
    const targets = await collectTargetCells(grid.surface);
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.rowId)).toEqual(['r0', 'r1', 'r2']);
    for (const [i, t] of targets.entries()) {
      expect(t.colId).toBe('qty');
      expect(t.field).toBe('qty');
      expect(t.value).toBe(rows[i]!.qty);
      expect(t.rowIndex).toBe(i);
      expect(t.rowData).toEqual(rows[i]);
      expect(t.cellDataType).toBe('number');
    }
  });

  it('overlapping ranges dedupe rowIndexes into exactly ONE getRowsByIndex call', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [
        { rowStart: 0, rowEnd: 2, colIds: ['qty'] },
        { rowStart: 1, rowEnd: 3, colIds: ['qty'] },
      ],
    });
    const targets = await collectTargetCells(grid.surface);

    expect(grid.getRowsByIndexSpy).toHaveBeenCalledTimes(1);
    const requested = grid.getRowsByIndexSpy.mock.calls[0]![0] as number[];
    expect(new Set(requested)).toEqual(new Set([0, 1, 2, 3]));

    expect(targets).toHaveLength(4);
    const pairs = targets.map((t) => `${t.rowId}:${t.colId}`);
    expect(new Set(pairs).size).toBe(pairs.length); // no duplicate rowId+colId
  });

  it('multi-column range filters out non-numeric columns', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [{ rowStart: 0, rowEnd: 1, colIds: ['qty', 'name'] }],
    });
    const targets = await collectTargetCells(grid.surface);
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.colId === 'qty')).toBe(true);
  });

  it('non-editable cells are filtered out', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }],
      nonEditable: [{ rowIndex: 1, colId: 'qty' }],
    });
    const targets = await collectTargetCells(grid.surface);
    expect(targets.map((t) => t.rowId)).toEqual(['r0', 'r2']);
  });

  it('unknown colId (colMeta null) is skipped without throwing', async () => {
    const grid = createFakeGrid({
      rows,
      colDefs,
      ranges: [{ rowStart: 0, rowEnd: 0, colIds: ['qty', 'unknownCol'] }],
    });
    const targets = await collectTargetCells(grid.surface);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.colId).toBe('qty');
  });

  it('focused-cell fallback used only when there are ZERO ranges', async () => {
    const withFocus = createFakeGrid({
      rows,
      colDefs,
      ranges: [],
      focusedCell: { rowIndex: 1, colId: 'qty' },
    });
    const targets = await collectTargetCells(withFocus.surface);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.rowId).toBe('r1');
    expect(targets[0]!.colId).toBe('qty');

    const noFocus = createFakeGrid({ rows, colDefs, ranges: [], focusedCell: null });
    expect(await collectTargetCells(noFocus.surface)).toEqual([]);
  });

  it('null fetch entries (out-of-range indexes) yield no target', async () => {
    const shortRows = rows.slice(0, 2); // only indexes 0,1 resolve; index 2 -> null
    const grid = createFakeGrid({
      rows: shortRows,
      colDefs,
      ranges: [{ rowStart: 0, rowEnd: 2, colIds: ['qty'] }],
    });
    const targets = await collectTargetCells(grid.surface);
    expect(targets.map((t) => t.rowId)).toEqual(['r0', 'r1']);
  });

  it('empty everything (no ranges, no focus) returns [] and never calls getRowsByIndex', async () => {
    const grid = createFakeGrid({ rows, colDefs, ranges: [], focusedCell: null });
    const targets = await collectTargetCells(grid.surface);
    expect(targets).toEqual([]);
    expect(grid.getRowsByIndexSpy).not.toHaveBeenCalled();
  });
});

describe('buildSmartEditPatches', () => {
  function target(overrides?: Partial<CellTarget>): CellTarget {
    return {
      rowId: 'r1', colId: 'qty', field: 'qty', value: 10, rowIndex: 0,
      rowData: { qty: 10 },
      ...overrides,
    };
  }

  it('multiply: null-current target skipped via applyNumericOp, others patched', () => {
    const t1 = target({ rowId: 'a', value: 10 });
    const t2 = target({ rowId: 'b', value: null });
    const t3 = target({ rowId: 'c', value: 20 });
    const patches = buildSmartEditPatches([t1, t2, t3], 'multiply', 2);
    expect(patches).toEqual([
      { rowId: 'a', colId: 'qty', field: 'qty', oldValue: 10, newValue: 20 },
      { rowId: 'c', colId: 'qty', field: 'qty', oldValue: 20, newValue: 40 },
    ]);
  });

  it('set to the current value produces no patch (Object.is no-op guard)', () => {
    const t = target({ rowId: 'a', value: 10 });
    const patches = buildSmartEditPatches([t], 'set', 10);
    expect(patches).toEqual([]);
  });
});
