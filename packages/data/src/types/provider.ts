import type { ColumnDefinition } from './schema';
import type { DataProviderConfig, ProviderStatus, TransportConfig } from './transport';

export type Unsubscribe = () => void;

export type ProviderEmitEvent =
  | { rows: readonly unknown[]; replace?: boolean; removes?: readonly string[] }
  | { status: ProviderStatus; error?: string }
  | { rowsReceived: number; byteSize?: number }
  | { inferred?: true };

/**
 * Classified live delta emitted by an adapter that speaks the add/update/
 * remove push protocol. `adds` are ids the client had not seen (paint as
 * transaction adds), `updates` mutate existing rows, `removes` are ids to
 * drop. Preferred over the legacy `onTick` (updates ∪ adds) callback.
 */
export interface ProviderDelta<T = Record<string, unknown>> {
  adds: T[];
  updates: T[];
  removes: string[];
}

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
  /**
   * Optional classified-delta subscription (adds/updates/removes). Consumers
   * that implement it get correct add/remove semantics; `onTick` stays for
   * backward compatibility (fires updates ∪ adds).
   */
  onDelta?(handler: (delta: ProviderDelta<T>) => void): Unsubscribe;
  onError(handler: (error: Error) => void): Unsubscribe;
  onStatus(handler: (status: ProviderStatus, error?: string) => void): Unsubscribe;
  destroy(): void;
}
