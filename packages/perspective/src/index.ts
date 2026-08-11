/**
 * @wellsfargo-starui/velocity-grid-perspective — Perspective-WASM data provider for VelocityGrid SSRM.
 *
 * High-level entry: `StompPerspectiveProvider` (engine + shared book +
 * feed leadership + datasource + live wiring in one class). The lower
 * layers stay exported for hosts that need custom orchestration (the
 * cgrid-ssrm-demo stress app drives them directly).
 *
 * AppData (`{{name.key}}`) lives in `@wellsfargo-starui/velocity-grid-appdata` and is re-exported
 * here so SSRM hosts can take a single import.
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
} from '@wellsfargo-starui/velocity-grid-appdata';
export {
  PerspectiveBook,
  resolvePerspectiveViewColumns,
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
export {
  distinctValuesFromRowPaths,
  type GroupedDistinctRow,
} from './distinctValues';
export { createPerspectiveSsrmDatasource } from './ssrmDatasource';
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
} from './bootstrap';
