// @wellsfargo-starui/velocity-grid-ext/edit — patches.test.ts
// Covers dedupePatches, buildPatchesFromTargets, buildRowUpdatesFromPatches,
// assertSingleColumnSelection.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.2, §2.3.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 3 Step 1 (8 cases).

import { describe, it, expect } from 'vitest';
import {
  dedupePatches,
  buildPatchesFromTargets,
  buildRowUpdatesFromPatches,
  assertSingleColumnSelection,
} from '../../src/edit/patches';
import type { CellTarget } from '../../src/edit/patches';
import type { CellPatch } from '../../src/edit/types';

function target(overrides?: Partial<CellTarget>): CellTarget {
  return {
    rowId: 'r1',
    colId: 'px',
    field: 'px',
    value: 10,
    rowIndex: 0,
    rowData: { px: 10 },
    ...overrides,
  };
}

describe('dedupePatches', () => {
  it('last-write-wins by rowId+colId, surviving at the first occurrence position', () => {
    const a1: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 2 };
    const b: CellPatch = { rowId: 'r2', colId: 'px', field: 'px', oldValue: 5, newValue: 6 };
    const a2: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 2, newValue: 3 };

    const result = dedupePatches([a1, b, a2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ rowId: 'r1', colId: 'px', field: 'px', oldValue: 2, newValue: 3 });
    expect(result[1]).toEqual(b);
  });

  it('never merges across rows or across columns; handles empty and already-unique input', () => {
    const p1: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 2 };
    const p2: CellPatch = { rowId: 'r2', colId: 'px', field: 'px', oldValue: 1, newValue: 2 };
    const p3: CellPatch = { rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 1, newValue: 2 };

    expect(dedupePatches([p1, p2, p3])).toEqual([p1, p2, p3]);
    expect(dedupePatches([])).toEqual([]);
  });
});

describe('buildPatchesFromTargets', () => {
  it('computes patches, skipping null results and Object.is no-ops', () => {
    const t1 = target({ rowId: 'r1', value: 10 });
    const t2 = target({ rowId: 'r2', value: 10 });
    const t3 = target({ rowId: 'r3', value: 10 });
    const patches = buildPatchesFromTargets([t1, t2, t3], (t) => {
      if (t.rowId === 'r1') return 20;
      if (t.rowId === 'r2') return null;
      return t.value; // unchanged -> Object.is no-op
    });
    expect(patches).toEqual([
      { rowId: 'r1', colId: 'px', field: 'px', oldValue: 10, newValue: 20 },
    ]);
  });

  it('Object.is edge cases: NaN->NaN skipped, 0->-0 produces a patch', () => {
    const nanTarget = target({ rowId: 'rn', value: NaN });
    const zeroTarget = target({ rowId: 'rz', value: 0 });
    const patches = buildPatchesFromTargets([nanTarget, zeroTarget], (t) =>
      t.rowId === 'rn' ? NaN : -0,
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]!.rowId).toBe('rz');
    expect(Object.is(patches[0]!.newValue, -0)).toBe(true);
  });
});

describe('buildRowUpdatesFromPatches', () => {
  const mirrorR1 = { px: 1, qty: 5, name: 'a' };
  const mirrorR2 = { px: 2, qty: 6, name: 'b' };
  const store: Record<string, Record<string, unknown>> = { r1: mirrorR1, r2: mirrorR2 };
  const getRow = (rowId: string) => store[rowId];

  it('groups by rowId, shallow-clones the mirror row, and carries untouched fields', () => {
    const p1: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 10 };
    const p2: CellPatch = { rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 5, newValue: 50 };
    const p3: CellPatch = { rowId: 'r2', colId: 'px', field: 'px', oldValue: 2, newValue: 20 };

    const snapshotR1 = { ...mirrorR1 };
    const result = buildRowUpdatesFromPatches([p1, p2, p3], getRow, 'forward');

    expect(result).toHaveLength(2);
    const r1Update = result.find((r) => r.name === 'a');
    expect(r1Update).toEqual({ px: 10, qty: 50, name: 'a' });
    expect(r1Update).not.toBe(mirrorR1);
    expect(mirrorR1).toEqual(snapshotR1);
  });

  it('applies direction: forward -> newValue, undo -> oldValue', () => {
    const p1: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 10 };
    const forward = buildRowUpdatesFromPatches([p1], getRow, 'forward');
    expect(forward[0]!.px).toBe(10);
    const undo = buildRowUpdatesFromPatches([p1], getRow, 'undo');
    expect(undo[0]!.px).toBe(1);
  });

  it('skips rowIds with no mirror row', () => {
    const p1: CellPatch = { rowId: 'r1', colId: 'px', field: 'px', oldValue: 1, newValue: 10 };
    const pMissing: CellPatch = { rowId: 'rMissing', colId: 'px', field: 'px', oldValue: 1, newValue: 10 };
    const result = buildRowUpdatesFromPatches([p1, pMissing], getRow, 'forward');
    expect(result).toHaveLength(1);
    expect(result[0]!.px).toBe(10);
  });
});

describe('assertSingleColumnSelection', () => {
  it('true for empty and single-column sets; false for two or more distinct colIds', () => {
    expect(assertSingleColumnSelection([])).toBe(true);
    expect(assertSingleColumnSelection([{ colId: 'px' }, { colId: 'px' }])).toBe(true);
    expect(assertSingleColumnSelection([{ colId: 'px' }, { colId: 'qty' }])).toBe(false);
  });
});
