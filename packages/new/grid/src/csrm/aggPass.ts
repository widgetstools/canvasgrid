/**
 * CSRM aggregation — grand totals + per-group totals.
 */

import type { GroupNode, GroupPassOutput } from './groupPass';
import { collectDescendantRowIds } from './groupPass';

export type AggFuncName = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last';

export type AggCol = {
  colId: string;
  field?: string;
  aggFunc: string | string[];
};

function resolveAggName(agg: string | string[]): string | null {
  const names = Array.isArray(agg) ? agg : [agg];
  for (const n of names) {
    if (['sum', 'avg', 'min', 'max', 'count', 'first', 'last'].includes(n)) return n;
  }
  return null;
}

export function runAggFunc(name: string, values: unknown[]): unknown {
  const nums = values.map(Number).filter((n) => !Number.isNaN(n));
  switch (name) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min': return nums.length ? Math.min(...nums) : null;
    case 'max': return nums.length ? Math.max(...nums) : null;
    case 'count': return values.filter((v) => v != null && v !== '').length;
    case 'first': return values.find((v) => v != null) ?? null;
    case 'last': {
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] != null) return values[i];
      }
      return null;
    }
    default: return null;
  }
}

export function applyAggPass<T extends Record<string, unknown>>(
  rows: readonly T[],
  aggCols: readonly AggCol[],
): Record<string, unknown> {
  const totals: Record<string, unknown> = {};
  for (const col of aggCols) {
    const name = resolveAggName(col.aggFunc);
    if (!name) continue;
    const field = col.field ?? col.colId;
    const values = rows.map((r) => r[field]);
    totals[col.colId] = runAggFunc(name, values);
  }
  return totals;
}

export function applyGroupAggPass<T extends Record<string, unknown>>(
  rows: readonly T[],
  inputIds: readonly string[],
  groupOutput: GroupPassOutput,
  aggCols: readonly AggCol[],
  getRowId: (row: T) => string,
): Record<string, Record<string, unknown>> {
  const groupTotals: Record<string, Record<string, unknown>> = {};
  if (groupOutput.bypassed || aggCols.length === 0) return groupTotals;

  const byId = new Map(rows.map((r) => [getRowId(r), r]));

  const compute = (node: GroupNode): void => {
    for (const child of node.childGroups) compute(child);
    const ids = collectDescendantRowIds(node, inputIds);
    const subset = ids.map((id) => byId.get(id)!).filter(Boolean);
    groupTotals[node.key] = applyAggPass(subset, aggCols);
  };
  for (const root of groupOutput.roots) compute(root);
  return groupTotals;
}
