/**
 * Cycle 14 / Task 3 — column-totals aggregation pass.
 *
 * Reads each column's aggFunc declaration (`'sum' | 'p99' | ['p99',
 * 'avg'] | …`), resolves it against the worker's `AggFuncRegistry`, and
 * applies the matched function to the filtered column values. Emits one
 * `chunk.totals[colId]` entry per column whose aggFunc resolves.
 *
 * **Where the math lives.** The numeric built-ins (`sum / avg / min /
 * max / count`) delegate to `aggMath.aggregate()` via the registry —
 * the single source of truth shared with the status panel's
 * `agAggregationComponent` (Cycle 13 / Task 3). Custom functions are
 * arbitrary `IAggFunc` callables that take `{ values, colId }` and
 * return whatever single value the totals cell renderer should display.
 *
 * **Performance.** One pass per column over the filtered row set, no
 * allocation per row beyond the values array fed into the registered
 * function. The totals computation is amortised against the existing
 * data pass that the worker already runs per `getViewport`. No extra
 * worker round-trip per scroll — `chunk.totals` rides the same
 * viewport reply that ships `numericCols` + `textCols`.
 *
 * **Lifecycle.** Constructed once at worker init, reused thereafter.
 * `setColumns` swaps the column list (used by `updateColumns`), and the
 * registry instance is owned by the worker State so a `setAggFuncs`
 * message takes effect on the very next `apply`.
 */

import type { RowStore } from '../dataPipeline';
import type { WorkerColumn } from '../protocol';
import type { AggFuncRegistry } from '../aggFuncRegistry';

interface AggCol {
  colId: string;
  field: string;
  /** Carried verbatim from the WorkerColumn — single name or fallback
   *  list. Resolved against the registry on every `apply` so a runtime
   *  `setAggFuncs` flip lights up without a column-metadata reship. */
  agg: string | string[];
}

export class AggPass<TRow = any> {
  private aggCols: AggCol[] = [];

  constructor(
    private store: RowStore<TRow>,
    columns: WorkerColumn[],
    private registry: AggFuncRegistry,
  ) {
    this.setColumns(columns);
  }

  setColumns(columns: WorkerColumn[]): void {
    this.aggCols = [];
    for (const col of columns) {
      if (col.aggFunc && col.field) {
        this.aggCols.push({ colId: col.colId, field: col.field, agg: col.aggFunc });
      }
    }
  }

  /** Apply each column's aggFunc to its filtered values and return the
   *  per-column totals. Columns whose aggFunc fails to resolve (unknown
   *  name, all entries unregistered) emit no entry — the totals row
   *  paints the cell empty for that column. */
  apply(inputIds: readonly string[]): { totals: Record<string, unknown> } {
    const totals: Record<string, unknown> = {};
    for (const { colId, field, agg } of this.aggCols) {
      const fn = this.registry.resolve(agg);
      if (!fn) continue;
      const values: unknown[] = [];
      for (const id of inputIds) {
        const row = this.store.getById(id);
        if (!row) continue;
        values.push((row as Record<string, unknown>)[field]);
      }
      let result: unknown;
      try {
        result = fn({ values, colId });
      } catch {
        // A misbehaving custom aggFunc should NOT bring down the whole
        // viewport pass — leave the column's totals entry empty so the
        // totals row paints the cell blank and the rest of the chunk
        // still ships.
        continue;
      }
      // `undefined` would be dropped by structured-clone across
      // postMessage; normalise to `null` so the chunk.totals record is
      // round-trip safe.
      totals[colId] = result === undefined ? null : result;
    }
    return { totals };
  }
}
