// @cgrid/edit - patch-first primitives reused by every op module.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.2 (patch model), section 2.3 (Object.is no-op guard).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.1.
//
// Pure functions only - no kernel imports, no Date, no grid surface.

import type { CellPatch } from './types';

export interface CellTarget {
  rowId: string; colId: string; field: string;
  value: unknown; rowIndex: number;
  rowData: Record<string, unknown>;
  cellDataType?: string;
}

/** Last-write-wins by the rowId+colId compound key - never merges across
 *  rows or columns. The surviving patch takes the LAST occurrence's values
 *  but sits at the FIRST occurrence's position (stable order). Keyed via a
 *  nested Map (rowId -> colId -> patch) rather than a joined string, so two
 *  untrusted id fields can never collide into the same composite key. */
export function dedupePatches(patches: CellPatch[]): CellPatch[] {
  const byRow = new Map<string, Map<string, CellPatch>>();
  const order: Array<[string, string]> = [];
  for (const patch of patches) {
    let byCol = byRow.get(patch.rowId);
    if (!byCol) {
      byCol = new Map<string, CellPatch>();
      byRow.set(patch.rowId, byCol);
    }
    if (!byCol.has(patch.colId)) order.push([patch.rowId, patch.colId]);
    byCol.set(patch.colId, patch);
  }
  return order.map(([rowId, colId]) => byRow.get(rowId)!.get(colId)!);
}

/** Builds one CellPatch per target whose compute result is non-null and
 *  differs from the target's current value under Object.is (the spec 2.3
 *  no-op rule - NaN -> NaN skipped, -0 vs 0 NOT skipped). */
export function buildPatchesFromTargets(
  targets: CellTarget[],
  compute: (t: CellTarget) => unknown | null,
): CellPatch[] {
  const patches: CellPatch[] = [];
  for (const target of targets) {
    const computed = compute(target);
    if (computed === null) continue;
    if (Object.is(computed, target.value)) continue;
    patches.push({
      rowId: target.rowId,
      colId: target.colId,
      field: target.field,
      oldValue: target.value,
      newValue: computed,
    });
  }
  return patches;
}

/** Groups patches by rowId, shallow-clones the mirror row from getRow, and
 *  sets row[field] to the direction-appropriate value. RowIds with no
 *  mirror row are skipped - the caller decides what a skip count means. */
export function buildRowUpdatesFromPatches(
  patches: CellPatch[],
  getRow: (rowId: string) => Record<string, unknown> | undefined,
  direction: 'forward' | 'undo',
): Record<string, unknown>[] {
  const byRowId = new Map<string, CellPatch[]>();
  for (const patch of patches) {
    const group = byRowId.get(patch.rowId);
    if (group) group.push(patch);
    else byRowId.set(patch.rowId, [patch]);
  }

  const updates: Record<string, unknown>[] = [];
  for (const [rowId, rowPatches] of byRowId) {
    const mirror = getRow(rowId);
    if (!mirror) continue;
    const clone = { ...mirror };
    for (const patch of rowPatches) {
      clone[patch.field] = direction === 'forward' ? patch.newValue : patch.oldValue;
    }
    updates.push(clone);
  }
  return updates;
}

/** True for empty and single-distinct-colId target sets; false when the
 *  targets span two or more distinct colIds (the enforceSingleColumn guard
 *  for smart-edit/bulk-update). */
export function assertSingleColumnSelection(targets: ReadonlyArray<{ colId: string }>): boolean {
  const distinct = new Set(targets.map((t) => t.colId));
  return distinct.size <= 1;
}
