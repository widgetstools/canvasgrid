import type {
  ColumnDefinition,
  DataProviderConfig,
  IDataProvider,
  ProviderStatus,
  SsrmGetRowsRequest,
  SsrmGetRowsResult,
  Unsubscribe,
} from '../types';
import type { ProviderStats } from '../types/stats';
import { emptyProviderStats } from '../types/stats';
import { connectHub, type HubConnection } from './hubConnection';
import { columnarToRows, type ColumnarBatch } from '../pipeline/wireFormat';

function normalizePushRows(raw: unknown[] | ColumnarBatch): Record<string, unknown>[] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as ColumnarBatch).format === 'columnar') {
    return columnarToRows(raw as ColumnarBatch);
  }
  return (raw as unknown[]) as Record<string, unknown>[];
}

let subSeq = 0;

export interface ProviderClientOptions {
  workerUrl?: URL | string;
  inProcess?: boolean;
}

/**
 * Main-thread IDataProvider backed by the SharedWorker (or in-process) hub.
 */
export class ProviderClientAdapter<T extends Record<string, unknown> = Record<string, unknown>>
  implements IDataProvider<T>
{
  readonly providerId: string;
  private readonly config: DataProviderConfig;
  private readonly hub: HubConnection;
  private readonly subId: string;
  private status: ProviderStatus = 'idle';
  private cache: T[] = [];
  private columnDefs: ColumnDefinition[];
  private started = false;

  private snapHandlers = new Set<(rows: readonly T[]) => void>();
  private tickHandlers = new Set<(rows: readonly T[]) => void>();
  private statusHandlers = new Set<(s: ProviderStatus, e?: string) => void>();
  private errorHandlers = new Set<(e: Error) => void>();
  private rowsHandlers = new Set<(n: number) => void>();
  private tickNotifyHandlers = new Set<() => void>();
  private offPush: Unsubscribe;

  constructor(config: DataProviderConfig, opts?: ProviderClientOptions) {
    this.config = structuredClone(config);
    this.providerId = config.providerId;
    this.columnDefs = [...(config.config.columnDefinitions ?? [])];
    this.subId = `sub-${++subSeq}`;
    this.hub = connectHub(opts);
    this.offPush = this.hub.onPush((msg) => {
      if ('providerId' in msg && msg.providerId !== this.providerId) return;
      if (msg.type === 'status') {
        this.status = msg.status;
        for (const h of this.statusHandlers) h(msg.status, msg.error);
        if (msg.error) {
          const err = new Error(msg.error);
          for (const h of this.errorHandlers) h(err);
        }
        return;
      }
      if (msg.type === 'rowsReceived') {
        for (const h of this.rowsHandlers) h(msg.count);
        return;
      }
      if (msg.type === 'tickNotify') {
        for (const h of this.tickNotifyHandlers) h();
        return;
      }
      if (msg.type === 'push') {
        const rows = normalizePushRows(msg.rows) as T[];
        if (msg.replace) this.cache = rows.slice();
        else this.mergeTicks(rows);
        if (msg.replace) {
          for (const h of this.snapHandlers) h(this.cache);
        } else {
          for (const h of this.tickHandlers) h(rows);
        }
      }
    });
  }

  private mergeTicks(rows: T[]): void {
    const key = this.config.config.keyColumn;
    if (key == null) {
      this.cache = this.cache.concat(rows);
      return;
    }
    const keyOf = (r: T): string => {
      if (typeof key === 'string') return String(r[key] ?? '');
      return key.map((k) => String(r[k] ?? '')).join('-');
    };
    const map = new Map(this.cache.map((r) => [keyOf(r), r]));
    for (const r of rows) map.set(keyOf(r), { ...(map.get(keyOf(r)) ?? {} as T), ...r });
    this.cache = [...map.values()];
  }

  async start(): Promise<void> {
    await this.hub.post({ v: 1, id: '', type: 'ensure', config: this.config });
    await this.hub.post({ v: 1, id: '', type: 'attach', providerId: this.providerId, subId: this.subId });
    await this.hub.post({ v: 1, id: '', type: 'start', providerId: this.providerId });
    this.started = true;
  }

  async stop(): Promise<void> {
    await this.hub.post({ v: 1, id: '', type: 'stop', providerId: this.providerId });
    this.started = false;
  }

  async refresh(): Promise<void> {
    const res = await this.hub.post({ v: 1, id: '', type: 'getSnapshot', providerId: this.providerId });
    if (res.type === 'snapshot') {
      this.cache = res.rows as T[];
      this.status = res.status;
      for (const h of this.snapHandlers) h(this.cache);
    }
  }

  async restart(extra?: Record<string, unknown>): Promise<void> {
    await this.hub.post({ v: 1, id: '', type: 'restart', providerId: this.providerId, overlay: extra });
  }

  getData(): readonly T[] {
    return this.cache;
  }

  getConfig(): DataProviderConfig {
    return this.config;
  }

  getColumnDefs(): readonly ColumnDefinition[] {
    return this.columnDefs;
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  onRowsReceived(handler: (count: number) => void): Unsubscribe {
    this.rowsHandlers.add(handler);
    return () => { this.rowsHandlers.delete(handler); };
  }

  onSnapshotData(handler: (rows: readonly T[]) => void): Unsubscribe {
    this.snapHandlers.add(handler);
    return () => { this.snapHandlers.delete(handler); };
  }

  onTick(handler: (rows: readonly T[]) => void): Unsubscribe {
    this.tickHandlers.add(handler);
    return () => { this.tickHandlers.delete(handler); };
  }

  onError(handler: (error: Error) => void): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => { this.errorHandlers.delete(handler); };
  }

  onStatus(handler: (status: ProviderStatus, error?: string) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => { this.statusHandlers.delete(handler); };
  }

  /** SSRM grids subscribe to soft-refresh notifications. */
  onTickNotify(handler: () => void): Unsubscribe {
    this.tickNotifyHandlers.add(handler);
    return () => { this.tickNotifyHandlers.delete(handler); };
  }

  async getRows(req: SsrmGetRowsRequest): Promise<SsrmGetRowsResult<T>> {
    const res = await this.hub.post({
      v: 1,
      id: '',
      type: 'getRows',
      providerId: this.providerId,
      request: req,
    });
    if (res.type !== 'getRowsResult') throw new Error('Unexpected hub response');
    return res.result as SsrmGetRowsResult<T>;
  }

  /** Live hub diagnostics (Markets ProviderStats parity). */
  async getStats(): Promise<ProviderStats> {
    const res = await this.hub.post({
      v: 1,
      id: '',
      type: 'getStats',
      providerId: this.providerId,
    });
    if (res.type !== 'stats') return emptyProviderStats(this.status);
    return res.stats;
  }

  destroy(): void {
    if (this.started) {
      void this.hub.post({ v: 1, id: '', type: 'detach', providerId: this.providerId, subId: this.subId });
    }
    this.offPush();
    this.hub.close();
    this.snapHandlers.clear();
    this.tickHandlers.clear();
    this.statusHandlers.clear();
    this.errorHandlers.clear();
    this.rowsHandlers.clear();
    this.tickNotifyHandlers.clear();
  }
}
