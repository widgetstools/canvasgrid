import type { WorkerColumn } from './protocol';
import type { CalcValueSource } from './passes/calcPass';
import { evalValueGetterSrc } from '../core/valueGetterExpr';

/**
 * Resolve one cell for filter / sort / slice / distinct.
 * Precedence: string valueGetter → row field → calc-column cache.
 */
export function readWorkerCellValue(
  row: unknown | undefined,
  col: WorkerColumn,
  opts?: { rowId?: string; calcSource?: CalcValueSource | null },
): unknown {
  if (col.valueGetter) {
    return evalValueGetterSrc(col.valueGetter, row ?? {});
  }
  if (col.field) {
    return (row as Record<string, unknown> | undefined)?.[col.field];
  }
  const src = opts?.calcSource;
  const rowId = opts?.rowId;
  if (src && rowId && src.isCalcCol(col.colId)) {
    return src.valueAt(rowId, col.colId);
  }
  return undefined;
}
