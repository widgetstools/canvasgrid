// Row-grouping + aggregation types. Cycle 14 introduced custom column
// aggregation; cycle 15 introduced GroupModel. Leaf module.

/** Cycle 14 / Task 3 — params passed to a custom column aggFunc. Mirrors
 *  ag-grid's `IAggFuncParams` shape so apps porting over keep the same
 *  vocabulary. The `values` array carries the raw cell values for the
 *  column being aggregated (post-filter, in row order). `colId` lets one
 *  shared function dispatch between columns. `rowNode` is reserved for
 *  group-footer totals (Cycle 15); for grand totals it is `undefined`. */
export interface IAggFuncParams<TValue = unknown, TRow = any> {
  values: TValue[];
  colId: string;
  rowNode?: { data?: TRow; key?: string };
}

/** Cycle 14 / Task 3 — custom column aggregation function. Reduces a
 *  column's filtered values into a single totals-row entry. Runs on the
 *  worker (the function body string-serialises via
 *  `Function.prototype.toString()` and reconstructs via `new Function`),
 *  so it MUST be pure — no closures over external scope. Apps that need
 *  scope-bound state should pre-bake it into the values via a
 *  `valueGetter` instead. Closures are rejected at `setGridOption`
 *  /constructor time with a clear error that points at the failure mode.
 *  Built-in names (`'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' |
 *  'last'`) bypass serialisation entirely. */
export type IAggFunc<TValue = unknown, TResult = unknown, TRow = any> =
  (params: IAggFuncParams<TValue, TRow>) => TResult;

/** Cycle 15 / Task 1 — row-group model. The ordered list of colIds that
 *  define the grouping hierarchy. */
export interface GroupModel { rowGroupCols: string[] }
