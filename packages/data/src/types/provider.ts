import type { ColumnDefinition } from './schema';
import type { DataProviderConfig, ProviderStatus, TransportConfig } from './transport';

export type Unsubscribe = () => void;

export type ProviderEmitEvent =
  | { rows: readonly unknown[]; replace?: boolean }
  | { status: ProviderStatus; error?: string }
  | { rowsReceived: number; byteSize?: number }
  | { inferred?: true };

export type ProviderEmit = (event: ProviderEmitEvent) => void;

export interface TransportHandle {
  stop(): void | Promise<void>;
  restart(overlay?: Record<string, unknown>): void | Promise<void>;
}

export interface TransportContext {
  providerId: string;
  signal?: AbortSignal;
}

/**
 * Conceptual host transport contract. Implementations register as
 * TransportPlugin.create (factory + ProviderEmit) so they run inside the
 * SharedWorker. Event mapping:
 * - emit({ rows, replace: true }) → snapshot rows (OnSnapshotRowsReceived)
 * - emit({ status: 'ready' }) → OnSnapshotReady
 * - emit({ rows }) → OnUpdate (live)
 * - emit({ rowsReceived }) → progress
 * - keyFields → config.keyColumn / plugin.defaultKeyFields
 * Column defs stay on provider config (authored); inference is hub-side.
 */
export interface ITransport {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  restart(overlay?: Record<string, unknown>): void | Promise<void>;
}

export type TransportFactory = (
  cfg: TransportConfig,
  emit: ProviderEmit,
  ctx: TransportContext,
) => TransportHandle;

/** Main-thread consumer contract. */
export interface IDataProvider<T = Record<string, unknown>> {
  readonly providerId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
  restart(extra?: Record<string, unknown>): Promise<void>;
  getData(): readonly T[];
  getConfig(): DataProviderConfig;
  getColumnDefs(): readonly ColumnDefinition[];
  getStatus(): ProviderStatus;
  onRowsReceived(handler: (count: number) => void): Unsubscribe;
  onSnapshotData(handler: (rows: readonly T[]) => void): Unsubscribe;
  onTick(handler: (rows: readonly T[]) => void): Unsubscribe;
  onError(handler: (error: Error) => void): Unsubscribe;
  onStatus(handler: (status: ProviderStatus, error?: string) => void): Unsubscribe;
  /** SSRM: request a window from the hub cache. */
  getRows?(req: SsrmGetRowsRequest): Promise<SsrmGetRowsResult<T>>;
  destroy(): void;
}

export interface SsrmGetRowsRequest {
  startRow: number;
  endRow: number;
  sortModel?: Array<{ colId: string; direction: 'asc' | 'desc' }>;
  filterModel?: Record<string, unknown>;
}

export interface SsrmGetRowsResult<T = Record<string, unknown>> {
  rowData: T[];
  rowCount: number;
}
