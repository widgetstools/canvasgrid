import type { PipelineConfig } from './pipeline';
import type { SchemaConfig } from './schema';

/** Built-in transport ids (custom plugins use any string). */
export type BuiltinTransportType =
  | 'stomp'
  | 'rest'
  | 'mock'
  | 'solace'
  | 'amps'
  | 'socketio'
  | 'websocket';

/** Open transport id — built-ins or host-registered plugins. */
export type TransportType = BuiltinTransportType | (string & {});

export type ProviderStatus =
  | 'idle'
  | 'connecting'
  | 'snapshot'
  | 'ready'
  | 'error'
  | 'disconnected';

export type RowModelType = 'clientSide' | 'serverSide';

/** Shared base every transport config carries. */
export type TransportConfigBase = PipelineConfig & SchemaConfig & Record<string, unknown>;

export interface StompTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'stomp';
  websocketUrl: string;
  listenerTopic: string;
  requestMessage?: string;
  requestBody?: string;
  snapshotEndToken?: string;
  snapshotTimeoutMs?: number;
  dataType?: 'positions' | 'trades' | 'orders' | 'custom';
  messageRate?: number;
  batchSize?: number;
  autoStart?: boolean;
  heartbeat?: { outgoing?: number; incoming?: number };
}

export interface RestTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'rest';
  baseUrl: string;
  endpoint: string;
  method?: 'GET' | 'POST';
  queryParams?: Record<string, string>;
  body?: string;
  headers?: Record<string, string>;
  pollInterval?: number;
  pageSize?: number;
  rowsPath?: string;
  timeout?: number;
}

export interface MockTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'mock';
  rowCount?: number;
  tickMs?: number;
  updatesPerTick?: number;
  shape?: 'positions' | 'trades' | 'orders';
}

/** Stub configs — factories error until implemented. */
export interface SolaceTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'solace';
  url: string;
  vpnName?: string;
  username?: string;
  password?: string;
  topic: string;
}

export interface AmpsTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'amps';
  url: string;
  topic: string;
  filter?: string;
}

export interface SocketIoTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'socketio';
  url: string;
  event?: string;
  path?: string;
}

export interface WebSocketTransportConfig extends PipelineConfig, SchemaConfig {
  providerType?: 'websocket';
  url: string;
  protocol?: string;
  messageFormat?: 'json' | 'text' | 'binary';
}

/**
 * Open config bag (pipeline + schema + transport-specific keys).
 * Prefer casting to StompTransportConfig / RestTransportConfig / … when known.
 */
export type TransportConfig = TransportConfigBase;

/** Catalog row — persisted by providerId / name. */
export interface DataProviderConfig {
  providerId: string;
  name: string;
  description?: string;
  /** Open string — must match a registered TransportPlugin id. */
  providerType: TransportType;
  rowModel: RowModelType;
  config: TransportConfig;
  /** SSRM cache block hint. */
  blockSize?: number;
  tags?: string[];
  isDefault?: boolean;
  userId?: string;
  public?: boolean;
  updatedAt?: string;
}
