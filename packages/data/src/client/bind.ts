import type { IDataProvider } from '../types';

/** Minimal CSRM grid surface. */
export interface CsrmBindableGrid<T = Record<string, unknown>> {
  setRowData(rows: T[]): void;
  applyTransaction?(tx: { update?: T[]; add?: T[]; remove?: T[] }): void;
  applyTransactionAsync?(tx: { update?: T[] }): void | Promise<void>;
  setColumnDefs?(defs: unknown[]): void;
}

/** Map provider catalog columns onto a VelocityGrid columnDefs payload. */
function toGridColumnDefs(
  defs: ReturnType<IDataProvider['getColumnDefs']>,
): unknown[] {
  return defs.map((d) => ({
    field: d.field,
    headerName: d.headerName,
    filter: d.filter,
    sortable: d.sortable,
    resizable: d.resizable,
    hide: d.hide,
    width: d.width,
    ...(d.cellDataType === 'number' || d.cellDataType === 'text'
      ? { cellDataType: d.cellDataType }
      : {}),
  }));
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
    grid.setColumnDefs(toGridColumnDefs(defs));
  }

  stops.push(provider.onSnapshotData((rows) => {
    grid.setRowData(rows as T[]);
  }));

  stops.push(provider.onTick((rows) => {
    const tx = { update: rows as T[] };
    if (grid.applyTransactionAsync) void grid.applyTransactionAsync(tx);
    else if (grid.applyTransaction) grid.applyTransaction(tx);
    else grid.setRowData(provider.getData() as T[]);
  }));

  // If the provider already has a book (attach replay / prior refresh), paint now.
  const existing = provider.getData();
  if (existing.length) grid.setRowData(existing as T[]);

  return () => stops.forEach((fn) => fn());
}
