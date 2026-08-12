export type RowModelType = 'clientSide' | 'serverSide';

export type ColDef<T = unknown> = {
  field?: keyof T & string;
  colId?: string;
  headerName?: string;
  width?: number;
  minWidth?: number;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
  sortable?: boolean;
  filter?: boolean | string;
  rowGroup?: boolean;
  enableRowGroup?: boolean;
  enablePivot?: boolean;
  enableValue?: boolean;
  aggFunc?: string;
  valueGetter?: (p: { data: T | undefined; colId: string }) => unknown;
  cellDataType?: 'text' | 'number' | 'boolean' | 'date';
};

export type SortModelItem = { colId: string; direction: 'asc' | 'desc' };
export type SortModel = SortModelItem[];

export type FilterModelEntry =
  | { filterType: 'text'; type: string; filter?: string }
  | { filterType: 'number'; type: string; filter?: number; filterTo?: number }
  | { filterType: 'set'; values: string[] };

export type FilterModel = Record<string, FilterModelEntry>;

export type VelocityGridOptions<T = unknown> = {
  columnDefs: ColDef<T>[];
  rowData?: T[];
  getRowId?: (row: T) => string;
  rowModelType?: RowModelType;
  /** Explicit CSRM-over-SSRM hydrate. Never auto for sparse Perspective. */
  serverSideEnableClientSidePipeline?: boolean;
  serverSideDatasource?: import('../ssrm/types').IServerSideDatasourceV2<T>;
  cacheBlockSize?: number;
  rowHeight?: number;
  headerHeight?: number;
  quickFilterText?: string;
  rowSelection?: 'single' | 'multiple';
  suppressRowClickSelection?: boolean;
  theme?: 'light' | 'dark';
  /** Defer async txs until scroll ends (live blotter). */
  deferAsyncTransactionsWhileScrolling?: boolean;
  /** Conflate pending async txs by row id. */
  asyncTransactionConflate?: boolean;
  asyncTransactionWaitMillis?: number;
  onGridReady?: (api: import('../api/facade').VelocityGridApi<T>) => void;
  onSelectionChanged?: () => void;
  onSortChanged?: () => void;
  onFilterChanged?: () => void;
  onModelUpdated?: () => void;
  onBodyScroll?: () => void;
  onBodyScrollEnd?: () => void;
};
