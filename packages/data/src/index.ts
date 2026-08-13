/**
 * `@wellsfargo-starui/velocity-grid-data` — modular SharedWorker data-provider hub.
 *
 * Kernel stays a consumer (`setRowData` / `applyTransaction`).
 * Transports register via `registerTransport`; blotters attach by `providerId`.
 * SSRM data providers live in `@wellsfargo-starui/velocity-grid-perspective`.
 */

export type {
  FieldInfo,
  ColumnDefinition,
  SchemaConfig,
  PipelineConfig,
  TransportType,
  BuiltinTransportType,
  TransportConfigBase,
  ProviderStatus,
  RowModelType,
  StompTransportConfig,
  RestTransportConfig,
  MockTransportConfig,
  SolaceTransportConfig,
  AmpsTransportConfig,
  SocketIoTransportConfig,
  WebSocketTransportConfig,
  TransportConfig,
  DataProviderConfig,
  Unsubscribe,
  ProviderEmitEvent,
  ProviderEmit,
  TransportHandle,
  TransportContext,
  TransportFactory,
  ITransport,
  IDataProvider,
  ProviderStats,
} from './types';
export { emptyProviderStats } from './types';

export { PROTOCOL_VERSION, isHubPush } from './protocol/messages';
export type { HubRequest, HubResponse, HubPush, HubMessage } from './protocol/messages';

export {
  registerTransport,
  getTransportFactory,
  listRegisteredTransports,
  _resetTransportRegistryForTests,
} from './registry/transports';

export {
  defineTransportPlugin,
  registerTransportPlugin,
  getTransportPlugin,
  listTransportPlugins,
  _resetTransportPluginsForTests,
} from './registry/plugins';
export type {
  TransportPlugin,
  ConnectionFieldsApi,
  ConnectionFieldsHandle,
} from './registry/plugins';

export {
  registerDefaultTransports,
  _resetDefaultTransportsFlagForTests,
} from './transports/registerDefaults';
export { createMockTransport } from './transports/mock';
export { createStompTransport } from './transports/stomp';
export { createRestTransport } from './transports/rest';
export {
  mockTransportPlugin,
  stompTransportPlugin,
  restTransportPlugin,
  builtinTransportPlugins,
} from './transports/builtinPlugins';

export { mountProviderEditor, ProviderEditor } from './editor/ProviderEditor';
export type { ProviderEditorOptions } from './editor/ProviderEditor';
export {
  mountDataProviderEditor,
  DataProviderEditor,
} from './editor/DataProviderEditor';
export type { DataProviderEditorOptions } from './editor/DataProviderEditor';
export { openProviderEditorPopout } from './editor/openProviderEditorPopout';
export type {
  OpenProviderEditorPopoutOpts,
  ProviderEditorPopoutHandle,
} from './editor/openProviderEditorPopout';
export {
  applyThemeToPopout,
  findThemeSource,
  resolveThemeMode,
} from './editor/themeSync';
export type { ThemeMode } from './editor/themeSync';
export {
  mountFieldDescriptors,
  mountFieldGroups,
  mountGenericConfigFields,
} from './editor/connectionFields';
export type { FieldDescriptor, FieldGroup } from './editor/connectionFields';


export { DataServicesHub } from './hub/DataServicesHub';
export { RowCache, LivePipeline, composeRowId } from './hub/rowCache';

export { inferFieldsFromRows, fieldsToColumnDefinitions } from './schema/infer';

export type {
  ConfigBackend,
  ProviderCatalogBackend,
  LocalStorageConfigBackendOptions,
} from './catalog/ConfigBackend';
export {
  LocalStorageConfigBackend,
  IndexedDbConfigBackend,
  RestConfigBackend,
  MemoryConfigBackend,
  createDefaultConfigBackend,
  PROVIDER_CATALOG_STORAGE_KEY,
} from './catalog/ConfigBackend';

export { connectHub, _resetHubConnectionForTests } from './client/hubConnection';
export type { HubConnection } from './client/hubConnection';
export { ProviderClientAdapter } from './client/ProviderClientAdapter';
export type { ProviderClientOptions } from './client/ProviderClientAdapter';
export {
  bindProviderToGrid,
} from './client/bind';
export type { CsrmBindableGrid } from './client/bind';

export { resolveProviderConfig } from './client/resolveConfig';
export {
  registerDataProviderFeedControl,
  stopRegisteredProviderFeeds,
  restartRegisteredProviderFeeds,
  _resetDataProviderFeedControlsForTests,
} from './feedControlRegistry';
export type { DataProviderFeedControl } from './feedControlRegistry';
export { rowsToColumnar, columnarToRows, type ColumnarBatch } from './pipeline/wireFormat';
export { projectRow, thinDelta } from './pipeline/project';
