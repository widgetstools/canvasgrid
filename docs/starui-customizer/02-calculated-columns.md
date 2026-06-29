# 02 — calculated-columns

> Virtual columns whose values come from expressions over row data. Requires the [expression engine](README.md#1-expression-engine).

## Purpose

Let users add read-only columns whose values are computed at render time from an expression. Examples:

- `[price] * [quantity]` — line total
- `IF([status]='active', [premium] * 1.1, [premium])` — conditional premium
- `[price] - AVG([price])` — variance from column-wide average
- `CONCAT([firstName], ' ', [lastName])` — derived name

## Config schema

```ts
interface VirtualColumnDef {
  colId: string;                              // unique; must not collide with data fields
  headerName: string;
  expression: string;                          // DSL: [col] refs, IF/SWITCH/SUM/AVG/etc.
  valueFormatterTemplate?: ValueFormatterTemplate; // preset | excelFormat | expression | tick
  cellDataType?: 'number' | 'currency' | 'percent' | 'date' | 'datetime' | 'string' | 'boolean';
  position?: number;                           // sort hint
  initialWidth?: number;
  initialHide?: boolean;
  initialPinned?: 'left' | 'right';
}

interface CalculatedColumnsState {
  virtualColumns: VirtualColumnDef[];
}
```

`cellDataType` is for UI filter selection (number columns get range filters, string columns get set filters, etc.). It does not affect evaluation.

## Runtime behavior

### Parse once

At transform time, each `VirtualColumnDef.expression` is compiled once via `ExpressionEngine.compile(expression)`. The resulting `valueGetter` closes over the compiled AST:

```ts
function buildVirtualColDef(def: VirtualColumnDef, engine: ExpressionEngine) {
  const compiled = engine.compile(def.expression);   // throws caught → fallback to null
  return {
    colId: def.colId,
    headerName: def.headerName,
    valueGetter: (params) => {
      try {
        return compiled.evaluate({
          ...params.data,
          $row: params.node,
          $allRows: getAllRowsSnapshot(params.api),  // lazy
        });
      } catch {
        return null;   // silent on per-cell errors
      }
    },
    // ... formatter, width, etc.
  };
}
```

### Lazy all-rows snapshot

Expressions like `SUM([price])` need the whole dataset, not just the current row. The engine resolves this by reading from `$allRows` — a snapshot generated on demand and cached per-grid in a `WeakMap<GridApi, AllRowsEntry>`. Snapshot invalidates on row changes; columns that never touch `SUM`/`AVG` pay zero cost.

### Group rows

When the grid is row-grouped, group rows display `node.aggData[colId]` (AG-Grid's own aggregation result) instead of re-evaluating the expression. This lets calculated columns participate in `SUM`/`AVG` aggregations naturally.

### Errors

- **Parse errors** at compile time: column logs a warning, gets a `valueGetter` that always returns `null`.
- **Runtime errors** per cell: caught in the `try/catch`, return `null` for that cell. One bad cell doesn't blank the column.

## UI surface

Engine layer has none. Host renders:
- "Calculated Columns" panel: list, add, edit, delete
- Formula editor: usually a `<textarea>` with column-name autocomplete; ideally a syntax-highlighted code mirror with live error underlines
- Preview pane: show first N rows with computed values, parse/runtime errors flagged

## Persistence

```ts
{
  virtualColumns: VirtualColumnDef[]
}
```

Legacy migration: snapshots from earlier versions stored `valueFormatterTemplate` as a bare format string. On load, coerce to `{ kind: 'expression', expression: <string> }` so the new union shape works.

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/calculated-columns/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/calculated-columns/state.ts)
- [../starui/packages/shared/engine/src/customizer/modules/calculated-columns/virtualColumn.ts](../../../starui/packages/shared/engine/src/customizer/modules/calculated-columns/virtualColumn.ts)

## Design decisions worth copying

- **Parse once + AST walk.** Per-cell evaluation must be cheap. Compile in the transform, close over the AST in the `valueGetter`.
- **WeakMap snapshot cache per grid.** Lazy, GC-friendly, invalidates on row events.
- **`node.aggData` passthrough for group rows.** Lets calculated columns piggyback on built-in aggregation without special wiring.
- **Silent per-cell errors.** Return `null`. The user will notice via the preview pane; don't break the grid.

## cgrid translation

cgrid already has `valueGetter` on columns — direct fit. Two concerns:

1. **All-rows snapshot.** cgrid keeps row data in the worker. `$allRows` aggregation needs a path to fetch the full filtered/grouped dataset on demand. Options:
   - Cache the most recent worker dataset on the main thread (memory cost: ~50–200 MB for a 1M-row dataset — probably too expensive).
   - Push `SUM`/`AVG`/`COUNT` aggregation requests to the worker as a new RPC method, return the scalar. Cache by `(colId, expression-hash, dataset-version)`.
   - Option 2 is the right one. Add `workerClient.aggregate(colId, op)` and let the expression engine call it for `SUM([col])`-style refs.

2. **Custom aggFunc in worker.** cgrid serializes `aggFuncs` over to the worker as `Function.toString()`. Calculated columns that aggregate over groups should route through `colDef.aggFunc`, with the expression compiled on the worker side too. This means the expression engine needs to be **isomorphic** — runnable in both main and worker contexts. Build it as a pure module with no DOM deps.
