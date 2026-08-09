import type { IDataProvider } from '../types';
import type { ProviderClientAdapter } from './ProviderClientAdapter';

/** Minimal CSRM grid surface. */
export interface CsrmBindableGrid<T = Record<string, unknown>> {
  setRowData(rows: T[]): void;
  applyTransaction?(tx: { update?: T[]; add?: T[]; remove?: T[] }): void;
  applyTransactionAsync?(tx: { update?: T[] }): void | Promise<void>;
  setColumnDefs?(defs: unknown[]): void;
}

/** Minimal SSRM grid surface. */
export interface SsrmBindableGrid {
  setServerSideDatasource?(ds: unknown): void;
  refreshServerSide?(params?: { purge?: boolean }): void;
  applyServerSideTransaction?(tx: { update?: unknown[] }): void;
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
    grid.setColumnDefs(defs.map((d) => ({
      field: d.field,
      headerName: d.headerName,
      filter: d.filter,
      sortable: d.sortable,
      resizable: d.resizable,
      hide: d.hide,
      width: d.width,
    })));
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

/**
 * Wire an SSRM provider: exposes IServerSideDatasource.getRows via hub paging
 * and soft-refreshes on tickNotify.
 */
export function bindProviderToSsrmGrid<T extends Record<string, unknown>>(
  provider: IDataProvider<T> & Pick<ProviderClientAdapter<T>, 'getRows' | 'onTickNotify'>,
  grid: SsrmBindableGrid,
  opts?: { blockSize?: number },
): { datasource: { getRows: (params: SsrmParams) => void }; detach: () => void } {
  const blockSize = opts?.blockSize ?? 100;
  const datasource = {
    getRows(params: SsrmParams) {
      const startRow = params.request?.startRow ?? 0;
      const endRow = params.request?.endRow ?? startRow + blockSize;
      void provider.getRows!({
        startRow,
        endRow,
        sortModel: params.request?.sortModel,
        filterModel: params.request?.filterModel as Record<string, unknown> | undefined,
      }).then(
        (result) => {
          params.success?.({ rowData: result.rowData, rowCount: result.rowCount });
        },
        () => { params.fail?.(); },
      );
    },
  };

  if (grid.setServerSideDatasource) grid.setServerSideDatasource(datasource);

  const off = provider.onTickNotify(() => {
    grid.refreshServerSide?.({ purge: false });
  });

  return {
    datasource,
    detach: () => {
      off();
    },
  };
}

interface SsrmParams {
  request?: {
    startRow?: number;
    endRow?: number;
    sortModel?: Array<{ colId: string; direction: 'asc' | 'desc' }>;
    filterModel?: unknown;
  };
  success?: (r: { rowData: unknown[]; rowCount: number }) => void;
  fail?: () => void;
}
