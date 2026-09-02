/**
 * @wellsfargo-starui/velocity-grid-perspective — Perspective-WASM data provider for VelocityGrid SSRM.
 *
 * High-level entry: `StompPerspectiveProvider` (engine + shared book +
 * feed leadership + datasource + live wiring in one class). The lower
 * layers stay exported for hosts that need custom orchestration (the
 * velocitygrid-ssrm-demo stress app drives them directly).
 *
 * AppData (`{{name.key}}`) lives in `@wellsfargo-starui/velocity-grid-data/appdata` and is
 * re-exported here so SSRM hosts can take a single import.
 */
export {
  StompPerspectiveProvider,
  resolveProviderConfig,
  type StompPerspectiveProviderConfig,
  type AttachableGrid,
} from './provider';

export {
  mountStompPerspectiveProviderEditor,
  type StompPerspectiveProviderEditor,
  type StompPerspectiveProviderEditorOptions,
} from './editor/StompPerspectiveProviderEditor';
export {
  openPerspectiveProviderEditorPopout,
  type OpenPerspectiveProviderEditorPopoutOpts,
  type PerspectiveProviderEditorPopoutHandle,
} from './editor/openEditorPopout';
export {
  LocalStoragePerspectiveProviderCatalog,
  DEFAULT_PERSPECTIVE_PROVIDER_ID,
  buildDefaultPerspectiveProviderEntry,
  type PerspectiveProviderCatalog,
  type PerspectiveProviderEntry,
} from './catalog';
export {
  PerspectiveDataProviderController,
  type PerspectiveDataProviderControllerOptions,
  type PerspectiveDataProviderStateSlice,
} from './controller';
export {
  dataProviderConfigToPerspective,
  gridColumnDefsFromDataProvider,
  columnDefinitionsToGridDefs,
  columnDefinitionsToPerspectiveSchema,
  snapshotRowsFromConfig,
  type PerspectiveSchema,
} from './mapFromDataProvider';
export {
  mergeExpressionColumnDefs,
  type ExpressionColumnMeta,
} from './expressionColumns';

export {
  AppDataStore,
  resolveTemplate,
  resolveCfg,
  collectTemplateRefs,
  findUnresolvedAppDataTokens,
  assertAppDataResolved,
  toAppDataLookup,
  type AppDataLookup,
  type AppDataChange,
} from '@wellsfargo-starui/velocity-grid-data/appdata';
export {
  PerspectiveBook,
  resolvePerspectiveViewColumns,
  mergeLiveBatch,
  cgridFilterToPsp,
  mapAggFuncToPerspective,
  QUICK_FILTER_HAYSTACK_ALIAS,
  OR_CONTAINS_ALIAS_PREFIX,
  buildOrContainsExpression,
  orContainsAlias,
  type BookFeed,
  type BookPhase,
  type BookTelemetry,
  type ExpressionValidationResult,
  type PerspectiveBookOptions,
  type PspFilter,
  type PspFilterTerm,
  type SsrmRowsRequest,
  type SsrmRowsResult,
  type ViewSpec,
  type ViewTick,
} from './book';
export { boundUpdateBuffer, updateBufferCap, type UpdateBufferKeyColumn } from './updateBuffer';
export {
  resolveTableIndexField,
  rowIdentity,
  type RowKeyColumn,
} from './rowIdentity';
export {
  distinctValuesFromRowPaths,
  type GroupedDistinctRow,
} from './distinctValues';
export { createPerspectiveSsrmDatasource } from './ssrmDatasource';
// Perspective `split_by` → kernel pivot cross-tab. Exported for hosts that
// drive the views themselves instead of going through the provider.
export {
  mapPerspectivePivot, parsePerspectiveColumnPath,
  type PerspectivePivotViewResult, type MapPerspectivePivotInput,
} from './pivotMapper';
export {
  POSITION_COLUMNS,
  COLUMNS,
  GRAND_TOTAL_ROW_ID,
  emptyGrandTotalRow,
} from './positionColumns';
export {
  POSITION_SCHEMA,
  SHARED_TABLE_NAME,
  createPositionsTable,
  getPerspectiveClient,
  getPerspectiveWorkerMode,
  openOrCreatePositionsTable,
  type Client,
  type PerspectiveWorkerMode,
  type PositionRow,
  type Table,
  type View,
  readSharedEngineStats,
  configurePerspectiveSharedWorker,
  getPerspectiveSharedWorkerTarget,
  type PerspectiveSharedWorkerOptions,
  type SharedEngineStats,
} from './bootstrap';
