import type { SkeletonGroup } from './flattenIndex';

export type { SkeletonGroup, SkeletonNode } from './flattenIndex';

export type SsrmSortModel = Array<{ colId: string; direction: 'asc' | 'desc' }>;
export type SsrmFilterModel = Record<string, unknown>;

export type SsrmGetRowsRequest = {
  startRow: number;
  endRow: number;
  sortModel: SsrmSortModel;
  filterModel: SsrmFilterModel;
  rowGroupCols: string[];
  groupKeys: string[];
  expandedGroupKeys?: string[];
  columnKeys?: string[];
  quickFilterText?: string;
};

export type SsrmRowsResult<T> = {
  /** Preferred payload field (greenfield). */
  rows?: T[];
  /** Legacy AG/kernel alias — accepted by the engine. */
  rowData?: T[];
  rowCount?: number;
  groupKeys?: string[];
  grandTotals?: Record<string, unknown> | null;
};

export type IServerSideGetRowsParams<T> = {
  request: SsrmGetRowsRequest;
  success: (r: SsrmRowsResult<T>) => void;
  fail: () => void;
};

export type IServerSideGetSkeletonParams = {
  request: {
    rowGroupCols: string[];
    sortModel: SsrmSortModel;
    filterModel: SsrmFilterModel;
  };
  success: (r: { groups: SkeletonGroup[] }) => void;
  fail: () => void;
};

export type IServerSideGetLeafRowsParams<T> = {
  request: {
    groupPath: string[];
    startRow: number;
    endRow: number;
    columnKeys?: string[];
    sortModel: SsrmSortModel;
    filterModel: SsrmFilterModel;
    rowGroupCols: string[];
  };
  success: (r: { rows?: T[]; rowData?: T[] }) => void;
  fail: () => void;
};

export type IServerSideGetGroupLeafIdsParams = {
  request: { groupPath: string[]; rowGroupCols: string[] };
  success: (r: { ids: string[] }) => void;
  fail: () => void;
};

/** Sparse SSRM v2 datasource contract (product path). */
export interface IServerSideDatasourceV2<T = unknown> {
  getRows(params: IServerSideGetRowsParams<T>): void;
  getGroupSkeleton?(params: IServerSideGetSkeletonParams): void;
  getLeafRows?(params: IServerSideGetLeafRowsParams<T>): void;
  getGroupLeafIds?(params: IServerSideGetGroupLeafIdsParams): void;
  destroy?(): void;
}

export function isServerSideDatasourceV2<T>(
  ds: unknown,
): ds is IServerSideDatasourceV2<T> {
  return !!ds
    && typeof ds === 'object'
    && typeof (ds as IServerSideDatasourceV2).getRows === 'function'
    && typeof (ds as IServerSideDatasourceV2).getGroupSkeleton === 'function';
}

export function resultRows<T>(r: { rows?: T[]; rowData?: T[] }): T[] {
  return r.rows ?? r.rowData ?? [];
}
