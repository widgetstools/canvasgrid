// @wellsfargo-starui/velocity-grid-ext/edit — smart-edit async target collection (spec §3.6a) + patch build.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.4 (smart-edit), section 3.6a (async target collection + batching).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.3.
//
// TargetSurface is a structural, engine-side projection of the bridge's grid
// surface — Task 7 (bulk-update) reuses it, Task 11's bridge implements it
// over the kernel grid. No kernel imports here (engine discipline holds).
//
// `collectCellsByType` factors the ranges-first collection walk out so
// Task 7's `collectBulkUpdateTargets` (bulkUpdate.ts) can reuse it with a
// different cell-data-type filter instead of duplicating the walk — the
// PUBLIC `collectTargetCells` signature/behavior below is unchanged.

import type { CellTarget } from './patches';
import { buildPatchesFromTargets } from './patches';
import type { CellPatch, SmartEditOp } from './types';
import { applyNumericOp, isNumericCellDataType } from './numericOps';

export interface TargetSurface {
  getCellRanges(): Array<{ rowStart: number; rowEnd: number; colIds: string[] }>;
  getFocusedCell(): { rowIndex: number; colId: string } | null;
  getRowsByIndex(
    rowIndexes: number[],
  ): Promise<Array<{ rowIndex: number; rowId: string; data: Record<string, unknown> } | null>>;
  isCellEditable(rowIndex: number, colId: string): boolean;
  colMeta(colId: string): { field: string; cellDataType?: string } | null;
}

/** Collects candidate cells for smart-edit / shortcuts (spec §3.6a): ranges-first
 *  — the union of ALL selected ranges (each contributing `rowStart..rowEnd`
 *  inclusive × its `colIds`), rowIndexes deduped ACROSS ranges and fetched via
 *  exactly ONE `getRowsByIndex` call (batching). Falls back to the focused
 *  cell only when there are ZERO ranges (null focused → `[]`). Filters to
 *  numeric + editable cells; skips cells whose colMeta is unknown or whose
 *  fetched row is missing/out-of-range; dedupes the final target list by
 *  rowId+colId. */
export async function collectTargetCells(surface: TargetSurface): Promise<CellTarget[]> {
  return collectCellsByType(surface, isNumericCellDataType);
}

/** Shared ranges-first collection walk (spec §3.6a), parameterized by a
 *  cell-data-type inclusion predicate. `collectTargetCells` above binds
 *  `isNumericCellDataType`; Task 7's `collectBulkUpdateTargets`
 *  (bulkUpdate.ts) binds its own text/number/date/dateTime filter. Every
 *  OTHER behavior — batching, editable filter, colMeta-null skip,
 *  null-fetch skip, rowId+colId dedupe — is identical between callers. */
export async function collectCellsByType(
  surface: TargetSurface,
  includeType: (cellDataType?: string) => boolean,
): Promise<CellTarget[]> {
  const ranges = surface.getCellRanges();

  const wanted: Array<{ rowIndex: number; colId: string }> = [];
  const rowIndexSet = new Set<number>();

  if (ranges.length === 0) {
    const focused = surface.getFocusedCell();
    if (!focused) return [];
    wanted.push({ rowIndex: focused.rowIndex, colId: focused.colId });
    rowIndexSet.add(focused.rowIndex);
  } else {
    for (const range of ranges) {
      for (let rowIndex = range.rowStart; rowIndex <= range.rowEnd; rowIndex++) {
        rowIndexSet.add(rowIndex);
        for (const colId of range.colIds) {
          wanted.push({ rowIndex, colId });
        }
      }
    }
  }

  const rowIndexes = Array.from(rowIndexSet);
  const fetched = await surface.getRowsByIndex(rowIndexes);
  const rowByIndex = new Map<number, { rowId: string; data: Record<string, unknown> }>();
  for (const entry of fetched) {
    if (entry) rowByIndex.set(entry.rowIndex, entry);
  }

  const targets: CellTarget[] = [];
  // Nested Map (rowId -> Set<colId>), not a joined string key - two untrusted
  // id fields must never collide into the same composite key (mirrors
  // dedupePatches in patches.ts).
  const seenByRowId = new Map<string, Set<string>>();
  for (const cell of wanted) {
    const meta = surface.colMeta(cell.colId);
    if (!meta) continue;
    const row = rowByIndex.get(cell.rowIndex);
    if (!row) continue;
    if (!includeType(meta.cellDataType)) continue;
    if (!surface.isCellEditable(cell.rowIndex, cell.colId)) continue;

    let seenColIds = seenByRowId.get(row.rowId);
    if (!seenColIds) {
      seenColIds = new Set<string>();
      seenByRowId.set(row.rowId, seenColIds);
    }
    if (seenColIds.has(cell.colId)) continue;
    seenColIds.add(cell.colId);

    targets.push({
      rowId: row.rowId,
      colId: cell.colId,
      field: meta.field,
      value: row.data[meta.field],
      rowIndex: cell.rowIndex,
      rowData: row.data,
      cellDataType: meta.cellDataType,
    });
  }
  return targets;
}

/** Thin composition over Task 3's `buildPatchesFromTargets` - the null-skip
 *  and `Object.is` no-op guard live there, NOT re-implemented here. */
export function buildSmartEditPatches(
  targets: CellTarget[],
  op: SmartEditOp,
  operand: number,
): CellPatch[] {
  return buildPatchesFromTargets(targets, (t) => applyNumericOp(t.value, op, operand));
}
