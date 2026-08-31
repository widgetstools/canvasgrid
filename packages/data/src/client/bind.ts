import type { IDataProvider } from '../types';
import { toGridColumnDefs } from '../schema/gridColumnDefs';

/** Minimal CSRM grid surface. */
export interface CsrmBindableGrid<T = Record<string, unknown>> {
  setRowData(rows: T[]): void;
  applyTransaction?(tx: { update?: T[]; add?: T[]; remove?: T[] }): void;
  /**
   * Async transaction. `remove` carries row IDS (matching the delta protocol);
   * the kernel VelocityGrid maps `Tx.remove` row objects → ids via getRowId, so
   * a real-grid binding that forwards ids must translate (see
   * dataProviderController). `add`/`update` are row objects.
   */
  applyTransactionAsync?(tx: { add?: T[]; update?: T[]; remove?: string[] }): void | Promise<void>;
  setColumnDefs?(defs: unknown[]): void;
}


/**
 * Wire a CSRM provider to a VelocityGrid-like API.
 * Snapshot → setRowData; ticks → applyTransaction(Async).
 */
export function bindProviderToGrid<T extends Record<string, unknown>>(
  provider: IDataProvider<T>,
  grid: CsrmBindableGrid<T>,
): () => void {
  const stops: Array<() => void> = [];
  const defs = provider.getColumnDefs();
  if (defs.length && grid.setColumnDefs) {
    // Key column comes from the provider config so the dimension defaults
    // skip it — grouping or pivoting by a unique id is never what is meant.
    grid.setColumnDefs(toGridColumnDefs(defs, {
      keyColumn: provider.getConfig().config.keyColumn as string | string[] | undefined,
    }));
  }

  stops.push(provider.onSnapshotData((rows) => {
    grid.setRowData(rows as T[]);
  }));

  // Prefer the classified add/update/remove delta when the provider supports
  // it (correct add + remove semantics); fall back to the legacy update-only
  // onTick otherwise.
  if (typeof provider.onDelta === 'function') {
    stops.push(provider.onDelta((d) => {
      const adds = d.adds as T[];
      const updates = d.updates as T[];
      if (grid.applyTransactionAsync) {
        void grid.applyTransactionAsync({ add: adds, update: updates, remove: d.removes });
      } else if (grid.applyTransaction) {
        grid.applyTransaction({ add: adds, update: updates });
      } else {
        grid.setRowData(provider.getData() as T[]);
      }
    }));
  } else {
    stops.push(provider.onTick((rows) => {
      const tx = { update: rows as T[] };
      if (grid.applyTransactionAsync) void grid.applyTransactionAsync(tx);
      else if (grid.applyTransaction) grid.applyTransaction(tx);
      else grid.setRowData(provider.getData() as T[]);
    }));
  }

  // If the provider already has a book (attach replay / prior refresh), paint now.
  const existing = provider.getData();
  if (existing.length) grid.setRowData(existing as T[]);

  return () => stops.forEach((fn) => fn());
}
