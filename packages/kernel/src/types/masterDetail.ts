/**
 * Master / detail — the public option + callback surface.
 *
 * Mirrors ag-grid's `MasterDetailModule` vocabulary (`masterDetail`,
 * `isRowMaster`, `detailCellRendererParams.detailGridOptions` /
 * `.getDetailRowData`, `detailRowHeight`, `keepDetailRows`) so an app porting
 * across keeps the same names and the same shapes. Where the two differ it is
 * because ag-grid's version is DOM-first and ours is not:
 *
 *   - `detailCellRenderer` here is a function returning an element (or an HTML
 *     string), not a framework component name. The detail body is real DOM
 *     either way — the master grid is a canvas, the detail sits above it.
 *   - `embedFullWidthRows` has no analogue. A detail band always spans the
 *     grid's body width and never scrolls horizontally with the columns.
 *
 * Leaf module — types only, no imports back into the grid.
 */

/** Row-node view handed to master/detail callbacks. Deliberately narrow: the
 *  callbacks need identity and data, not the grid's internals. */
export interface MasterDetailRowNode<TRow = any> {
  /** The master row's id, as resolved by `getRowId`. */
  readonly id: string;
  /** The master row's data. */
  readonly data: TRow;
}

/** `isRowMaster` — return `false` to make a row non-expandable (no chevron,
 *  no detail row). Called with the raw row data, matching ag-grid. */
export type IsRowMaster<TRow = any> = (data: TRow) => boolean;

/** Params for `detailCellRendererParams.getDetailRowData`. Call
 *  `successCallback` with the detail rows — synchronously or later. */
export interface GetDetailRowDataParams<TRow = any, TDetail = any> {
  node: MasterDetailRowNode<TRow>;
  data: TRow;
  successCallback: (rowData: TDetail[]) => void;
}

/** Params for `isMasterOpenByDefault`. Field-for-field ag-grid's
 *  `IsMasterOpenByDefaultParams`, including the `rowNode` name (NOT `node` —
 *  `getDetailRowData` is the callback that says `node`, and porting an app
 *  across is easier when both keep the name they already had). `level` is
 *  always 0: a master row is a leaf of the master grid. */
export interface IsMasterOpenByDefaultParams<TRow = any> {
  rowNode: MasterDetailRowNode<TRow>;
  data: TRow;
  level: number;
}

/** How an open detail grid reacts when its master row's data changes. */
export type DetailRefreshStrategy = 'rows' | 'everything' | 'nothing';

/** Params for a custom `detailCellRenderer`. */
export interface DetailCellRendererParams<TRow = any> {
  node: MasterDetailRowNode<TRow>;
  data: TRow;
  /** The element the renderer should fill. Already sized to the detail band. */
  eGridDiv: HTMLElement;
}

/**
 * Configuration for the default detail renderer — the embedded grid.
 *
 * Supply either form of `detailCellRendererParams`: the object itself, or a
 * function evaluated per master row (so different rows can open different
 * columns, which is what makes a heterogeneous blotter work).
 */
export interface IDetailCellRendererParams<TRow = any, TDetail = any> {
  /** Grid options for the embedded detail grid. `columnDefs` is required for
   *  the detail grid to show anything; `rowData` may be supplied here instead
   *  of through `getDetailRowData`. */
  detailGridOptions?: Record<string, unknown>;
  /** Supplies the detail rows for one master row. */
  getDetailRowData?: (params: GetDetailRowDataParams<TRow, TDetail>) => void;
  /** How to refresh an open detail grid when the master row's data changes.
   *  Defaults to `'rows'`. */
  refreshStrategy?: DetailRefreshStrategy;
  /** Optional HTML shell around the embedded grid. Must contain exactly one
   *  element carrying `ref="eDetailGrid"` — the grid mounts into it. A
   *  function form receives the master row so the shell can carry a title. */
  template?: string | ((params: { node: MasterDetailRowNode<TRow>; data: TRow }) => string);
}

/** Handle onto one live detail grid, keyed `detail_{ROW-ID}` — the same id
 *  format ag-grid uses, so `getDetailGridInfo('detail_88')` ports across. */
export interface DetailGridInfo<TDetail = any> {
  id: string;
  /** The detail grid's own api. Absent only for a custom `detailCellRenderer`
   *  that never registered one via `addDetailGridInfo`. */
  api?: TDetail;
}
