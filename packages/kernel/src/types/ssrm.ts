import type { FilterModel } from './filter';
import type { SortModel } from './column';

export type { SsrmRowMeta, SsrmRowKind } from '../core/ssrmRowMeta';
export { SSRM_ROW_META_KEY, attachSsrmRowMeta, readSsrmRowMeta } from '../core/ssrmRowMeta';

/**
 * Server-Side Row Model surface.
 *
 * Flat block-cache + sparse hydrate by default. When the client pipeline
 * is enabled (`serverSideEnableClientSidePipeline`, or automatically when
 * CSRM-shaping features are configured), the worker runs the full CSRM
 * filter → group → pivot → sort → agg pipeline over the hydrated book so
 * SSRM matches clientSide feature-for-feature.
 */

export interface IServerSideDatasource<TRow = any> {
  getRows(params: IServerSideGetRowsParams<TRow>): void;
  destroy?(): void;
}

export interface IServerSideGetRowsRequest {
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  /** Active row-group columns (AG parity). Empty when ungrouped. */
  rowGroupCols: string[];
  /** Lazy child-fetch route (AG parity). Empty = top-level window. */
  groupKeys: string[];
  /**
   * @deprecated The v1 server-side tree-materialization protocol was removed
   * with the v1 row-model controller. The kernel now always sends an empty
   * array here; server-side grouping goes through `getGroupSkeleton` /
   * `getLeafRows` (see {@link IServerSideDatasourceV2}). The field is kept so
   * existing datasource implementations still typecheck.
   */
  expandedGroupKeys: string[];
  /**
   * Optional column projection for the row window. When set, datasources
   * that support it (e.g. Perspective Views) may return only these fields
   * (+ expression outputs computed server-side). Omitted = full-row payload.
   */
  columnKeys?: string[];
}

export interface IServerSideGetRowsParams<TRow = any> {
  request: IServerSideGetRowsRequest;
  success(params: LoadSuccessParams<TRow>): void;
  fail(): void;
}

export interface LoadSuccessParams<TRow = any> {
  rowData: TRow[];
  /** Exact total row count when known. Omitted keeps the previous total. */
  rowCount?: number;
  /**
   * @deprecated The v1 server-side tree-materialization protocol was removed
   * with the v1 row-model controller. The kernel never reads this field —
   * server-side grouping goes through `getGroupSkeleton` / `getLeafRows`
   * (see {@link IServerSideDatasourceV2}). Kept so existing datasource
   * implementations still typecheck.
   */
  groupKeys?: string[];
  /** Grand-total aggregates keyed by FIELD (v2 flat mode) — feeds the
   *  pinned totals subgrid / grand-total row when no skeleton exists. */
  grandTotals?: Record<string, unknown>;
}

export interface ServerSideTransaction<TRow = any> {
  add?: TRow[];
  update?: TRow[];
  remove?: TRow[];
  /** Updated total when the book size changes. */
  rowCount?: number;
}

export interface RefreshServerSideParams {
  /** When true (default), drop cached blocks and show blanks until refetch. */
  purge?: boolean;
}

// ─── Sparse SSRM v2 — client-owned group skeleton ──────────────────────────
//
// See docs/ssrm-group-skeleton-design.md. The kernel owns the tree shape
// (all group rows + flatten index); the datasource answers two cheap,
// expansion-free queries. Expansion state never crosses the wire, and the
// wire speaks raw `path: string[]` — composite key encoding is a kernel
// internal.

/** One group row of the skeleton — every group at every depth. */
export interface SkeletonGroup {
  /** Raw group values from root, e.g. `['FX', 'EMEA']`. */
  path: string[];
  /** Leaves under this subtree (paints as the group child count). */
  leafCount: number;
  /** Pre-aggregated values by field — spread into the synthesized group row
   *  so agg columns paint (same mechanism as v1 host-aggregated rows). */
  aggregates?: Record<string, unknown>;
}

export interface IServerSideGetSkeletonRequest {
  sortModel: SortModel;
  filterModel: FilterModel;
  rowGroupCols: string[];
}

export interface IServerSideGetSkeletonParams {
  request: IServerSideGetSkeletonRequest;
  success(result: { groups: SkeletonGroup[] }): void;
  fail(): void;
}

export interface IServerSideGetLeafRowsRequest {
  /** Raw values addressing ONE deepest-level group, e.g. `['FX', 'EMEA']`. */
  groupPath: string[];
  /** Leaf window within that group. */
  startRow: number;
  endRow: number;
  sortModel: SortModel;
  filterModel: FilterModel;
  rowGroupCols: string[];
  /** Optional column projection — see {@link IServerSideGetRowsRequest.columnKeys}. */
  columnKeys?: string[];
}

export interface IServerSideGetLeafRowsParams<TRow = any> {
  request: IServerSideGetLeafRowsRequest;
  success(result: { rowData: TRow[] }): void;
  fail(): void;
}

export interface IServerSideGetGroupLeafIdsRequest {
  /** Raw values addressing ONE group at any depth — descendant leaves of
   *  the whole subtree are requested. */
  groupPath: string[];
  sortModel: SortModel;
  filterModel: FilterModel;
  rowGroupCols: string[];
}

export interface IServerSideGetGroupLeafIdsParams {
  request: IServerSideGetGroupLeafIdsRequest;
  success(result: { ids: string[] }): void;
  fail(): void;
}

/**
 * Skeleton datasource. Detected by the presence of `getGroupSkeleton`
 * (duck-typed — no version flag). `getRows` serves the ungrouped fallback
 * with v1 flat-window semantics.
 *
 * The skeleton MAY include a `path: []` entry carrying grand-total
 * aggregates — it feeds `grandTotalRow` (in-scroll and pinned variants).
 */
export interface IServerSideDatasourceV2<TRow = any> {
  /** Flat windowing when no row grouping is active. */
  getRows(params: IServerSideGetRowsParams<TRow>): void;
  /** All group rows for the current sort/filter/groupBy, any order (the
   *  kernel normalizes to display order; sibling input order is kept). */
  getGroupSkeleton(params: IServerSideGetSkeletonParams): void;
  /** Leaf window under one deepest-level group. */
  getLeafRows(params: IServerSideGetLeafRowsParams<TRow>): void;
  /** OPTIONAL — all descendant leaf row-ids under one group (any depth).
   *  Enables group-checkbox selection cascade on the sparse path; without
   *  it, group selection over unloaded leaves stays unsupported. */
  getGroupLeafIds?(params: IServerSideGetGroupLeafIdsParams): void;
  destroy?(): void;
}

export type AnyServerSideDatasource<TRow = any> =
  | IServerSideDatasource<TRow>
  | IServerSideDatasourceV2<TRow>;

/**
 * Perspective ExprTK expression host (e.g. StompPerspectiveProvider).
 * Wired via `VelocityGrid.setSsrmExpressionHost` so SSRM calculated-columns
 * UI can validate/apply without depending on the perspective package.
 */
export interface SsrmExpressionHost {
  getExpressions(): Record<string, string>;
  setExpressions(expressions: Record<string, string>): Promise<void>;
  validateExpressions(expressions: Record<string, string>): Promise<{
    expression_schema: Record<string, string>;
    errors: Record<string, string>;
  }>;
  /**
   * Optional — sparse SSRM set-filter distinct values. When omitted, the
   * grid falls back to the worker store / hydrated row mirror (often empty
   * until windows load).
   */
  getDistinctValues?(colId: string, limit?: number): Promise<string[]>;
  /**
   * Optional — count rows matching a filter model against the full server
   * book (for saved-filter pill badges). Sparse SSRM hydrate mirrors are
   * viewport-sized and must not be used for these counts.
   */
  countMatchingFilterModel?(filterModel: FilterModel): Promise<number>;
}

export function isServerSideDatasourceV2<TRow>(
  ds: AnyServerSideDatasource<TRow> | null | undefined,
): ds is IServerSideDatasourceV2<TRow> {
  return !!ds && typeof (ds as IServerSideDatasourceV2<TRow>).getGroupSkeleton === 'function';
}
