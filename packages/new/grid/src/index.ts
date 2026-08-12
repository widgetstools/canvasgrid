/**
 * Public surface of `@wellsfargo-starui/vg-new-grid`.
 *
 * Everything here resolves to ported code. The prototype modules this file
 * used to re-export (`api/facade`, `columns/columnModel`, `csrm/*`, `ssrm/*`,
 * `paint/*`, `groupPivot/*`, `selection/*`, `engines/*`) are gone — their
 * behaviour is covered by the real host, the worker pipeline, and the unified
 * SSRM engine.
 */

export { VelocityGrid } from './velocityGrid';

// ─── type contract (the AG-parity surface) ─────────────────────────────────

export type { VelocityGridApi } from './types/api';
export type {
  VelocityGridOptions,
  CColDef,
  CColGroupDef,
  CColumnState,
  CApplyColumnStateParams,
  FilterModel,
  FilterModelEntry,
  CFilterModelEntry,
  SortModel,
  SortModelEntry,
  GroupModel,
  VelocityGridEvent,
} from './types';

export type { GridState } from './core/stateSnapshot';
export type {
  GridLayout,
  GridLayoutsBundle,
  GridBaselineConfig,
  TemplateSaveInput,
} from './types/layout';

// ─── server-side row model (one engine, explicit modes) ────────────────────

export { SsrmEngine } from './core/ssrmEngine';
export type { SsrmMode, SsrmEngineOptions, SsrmHost, SsrmHostV2 } from './core/ssrmEngine';
export {
  SSRM_GROUP_ROW_ID_PREFIX,
  SSRM_FOOTER_ROW_ID_PREFIX,
  SSRM_GRAND_TOTAL_ROW_ID,
} from './core/ssrmEngine';
export { ServerSideRowModelController } from './core/serverSideRowModel';
export { ServerSideRowModelV2Controller } from './core/serverSideRowModelV2';

export { FlattenIndex, toDisplayOrder, extractRootAggregates } from './core/ssrmFlattenIndex';
export type { SkeletonNode, FlattenEntry } from './core/ssrmFlattenIndex';
export {
  buildCompositeGroupKey,
  parseCompositeGroupKey,
  readSsrmRowMeta,
  attachSsrmRowMeta,
} from './core/ssrmRowMeta';
export type { SsrmRowMeta, SsrmRowKind } from './core/ssrmRowMeta';
export { buildSsrmColumnKeys, mergeSsrmRowFields } from './core/ssrmColumnKeys';

export {
  isServerSideDatasourceV2,
  type IServerSideDatasource,
  type IServerSideDatasourceV2,
  type AnyServerSideDatasource,
  type IServerSideGetRowsParams,
  type IServerSideGetSkeletonParams,
  type IServerSideGetLeafRowsParams,
  type IServerSideGetGroupLeafIdsParams,
  type SkeletonGroup,
  type LoadSuccessParams,
  type RefreshServerSideParams,
  type ServerSideTransaction,
} from './types/ssrm';

// ─── column model ──────────────────────────────────────────────────────────

export { ColumnStateManager } from './core/columnStateManager';
export { resolveColumnTree } from './core/columnTree';
export type { ColumnTree, ResolvedColGroupDef } from './core/columnTree';
export type { ResolvedColDef } from './core/propertyChain';

// ─── analytics / persistence ───────────────────────────────────────────────

export { PivotEngine } from './core/pivotEngine';
export { GroupingCoordinator } from './core/groupingCoordinator';
export { LayoutManager } from './core/layoutManager';
export { SelectionModel } from './interaction/selectionModel';
