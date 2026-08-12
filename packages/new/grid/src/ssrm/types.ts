export type SsrmGetRowsRequest = {
  startRow: number;
  endRow: number;
  sortModel: Array<{ colId: string; direction: 'asc' | 'desc' }>;
  filterModel: Record<string, unknown>;
  rowGroupCols: string[];
  groupKeys: string[];
  columnKeys?: string[];
  quickFilterText?: string;
};

export type SsrmRowsResult<T> = {
  rows: T[];
  rowCount: number;
  groupKeys?: string[];
};

export type IServerSideGetRowsParams<T> = {
  request: SsrmGetRowsRequest;
  success: (r: SsrmRowsResult<T>) => void;
  fail: () => void;
};

export type SkeletonNode = {
  key: string;
  field?: string;
  children?: SkeletonNode[];
  leafCount?: number;
  aggregates?: Record<string, unknown>;
};

export type IServerSideGetSkeletonParams = {
  request: { rowGroupCols: string[]; sortModel: SsrmGetRowsRequest['sortModel']; filterModel: Record<string, unknown> };
  success: (r: { roots: SkeletonNode[]; rowCount: number }) => void;
  fail: () => void;
};

export type IServerSideGetLeafRowsParams<T> = {
  request: {
    groupKeys: string[];
    startRow: number;
    endRow: number;
    columnKeys?: string[];
    sortModel: SsrmGetRowsRequest['sortModel'];
    filterModel: Record<string, unknown>;
  };
  success: (r: { rows: T[] }) => void;
  fail: () => void;
};

export type IServerSideGetGroupLeafIdsParams = {
  request: { groupKeys: string[] };
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
