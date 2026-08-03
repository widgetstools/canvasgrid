/**
 * @cgrid/perspective — Perspective-WASM data provider for CGrid SSRM.
 *
 * High-level entry: `StompPerspectiveProvider` (engine + shared book +
 * feed leadership + datasource + live wiring in one class). The lower
 * layers stay exported for hosts that need custom orchestration (the
 * cgrid-ssrm-demo stress app drives them directly).
 */
export {
  StompPerspectiveProvider,
  type StompPerspectiveProviderConfig,
  type AttachableGrid,
} from './provider';
export {
  PerspectiveBook,
  type BookFeed,
  type BookPhase,
  type BookTelemetry,
  type PerspectiveBookOptions,
  type PspFilter,
  type SsrmRowsRequest,
  type SsrmRowsResult,
  type ViewSpec,
  type ViewTick,
} from './book';
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
