import type {
  ColumnDefinition,
  DataProviderConfig,
  IDataProvider,
  ProviderDelta,
  ProviderStatus,
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
  /**
   * A-P8 — the row cache is a persistent insertion-ordered Map (keyed by the
   * composed row id). Live ticks mutate it in place; nothing rebuilds a full
   * Map per tick batch. Keyless configs fall back to synthetic append ids.
   */
  private cache = new Map<string, T>();
  private syntheticSeq = 0;
  private columnDefs: ColumnDefinition[];
  private started = false;

  private snapHandlers = new Set<(rows: readonly T[]) => void>();
  private tickHandlers = new Set<(rows: readonly T[]) => void>();
  private deltaHandlers = new Set<(d: ProviderDelta<T>) => void>();
  private statusHandlers = new Set<(s: ProviderStatus, e?: string) => void>();
  private errorHandlers = new Set<(e: Error) => void>();
  private rowsHandlers = new Set<(n: number) => void>();
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
      if (msg.type === 'push') {
        const rows = normalizePushRows(msg.rows) as T[];
        const seq = msg.seq;
        if (msg.replace && (seq === undefined || seq === 0)) {
          // Replace-sequence head — full cache reset + snapshot emit.
          this.cacheReplace(rows);
          const snapshot = this.getData();
          for (const h of this.snapHandlers) h(snapshot);
        } else if (msg.replace) {
          // Replace continuation chunk (seq > 0) — APPEND to the replace in
          // progress and paint as adds (C-C3: these used to arrive as ticks
          // of unknown ids and be dropped → remote tabs truncated).
          this.cacheAppend(rows);
          this.emitDelta({ adds: rows, updates: [], removes: [] });
        } else {
          // Live tick — classify against current cache membership.
          this.emitDelta(this.diffTick(rows, msg.removes ?? []));
        }
      }
    });
  }

  /** Composed row id for the configured key column, or null when keyless. */
  private keyOf(r: T): string | null {
    const key = this.config.config.keyColumn;
    if (key == null) return null;
    if (typeof key === 'string') {
      const v = (r as Record<string, unknown>)[key];
      return v == null ? null : String(v);
    }
    if (key.length === 0) return null;
    return key.map((k) => String((r as Record<string, unknown>)[k] ?? '')).join('-');
  }

  /** Full replace — clear the persistent Map and re-seed in arrival order. */
  private cacheReplace(rows: T[]): void {
    this.cache.clear();
    this.syntheticSeq = 0;
    for (const r of rows) {
      const id = this.keyOf(r) ?? `~syn#${this.syntheticSeq++}`;
      this.cache.set(id, r);
    }
  }

  /** Append/upsert rows into the persistent Map (keyless → synthetic add). */
  private cacheAppend(rows: T[]): void {
    for (const r of rows) {
      const k = this.keyOf(r);
      if (k == null) {
        this.cache.set(`~syn#${this.syntheticSeq++}`, r);
        continue;
      }
      const prev = this.cache.get(k);
      this.cache.set(k, prev ? { ...prev, ...r } : r);
    }
  }

  /**
   * Classify a live tick against the persistent Map: unseen ids → adds,
   * known ids → merged updates, `removeIds` → removes. Mutates the Map in
   * place (A-P8 — no per-batch rebuild).
   */
  private diffTick(rows: T[], removeIds: string[]): ProviderDelta<T> {
    const adds: T[] = [];
    const updates: T[] = [];
    const removes: string[] = [];
    for (const r of rows) {
      const k = this.keyOf(r);
      if (k == null) {
        this.cache.set(`~syn#${this.syntheticSeq++}`, r);
        adds.push(r);
        continue;
      }
      const prev = this.cache.get(k);
      if (prev !== undefined) {
        const next = { ...prev, ...r };
        this.cache.set(k, next);
        updates.push(next);
      } else {
        this.cache.set(k, r);
        adds.push(r);
      }
    }
    for (const id of removeIds) {
      if (this.cache.delete(id)) removes.push(id);
    }
    return { adds, updates, removes };
  }

  /** Fire onDelta subscribers; keep legacy onTick (updates ∪ adds) alive. */
  private emitDelta(delta: ProviderDelta<T>): void {
    if (delta.adds.length === 0 && delta.updates.length === 0 && delta.removes.length === 0) {
      return;
    }
    for (const h of this.deltaHandlers) h(delta);
    if (this.tickHandlers.size > 0) {
      const merged = delta.updates.concat(delta.adds);
      if (merged.length) for (const h of this.tickHandlers) h(merged);
    }
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
      this.cacheReplace(res.rows as T[]);
      this.status = res.status;
      const snapshot = this.getData();
      for (const h of this.snapHandlers) h(snapshot);
    }
  }

  async restart(extra?: Record<string, unknown>): Promise<void> {
    await this.hub.post({ v: 1, id: '', type: 'restart', providerId: this.providerId, overlay: extra });
  }

  getData(): readonly T[] {
    return [...this.cache.values()];
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

  /** Classified add/update/remove delta subscription (preferred over onTick). */
  onDelta(handler: (delta: ProviderDelta<T>) => void): Unsubscribe {
    this.deltaHandlers.add(handler);
    return () => { this.deltaHandlers.delete(handler); };
  }

  onError(handler: (error: Error) => void): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => { this.errorHandlers.delete(handler); };
  }

  onStatus(handler: (status: ProviderStatus, error?: string) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => { this.statusHandlers.delete(handler); };
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
    this.deltaHandlers.clear();
    this.statusHandlers.clear();
    this.errorHandlers.clear();
    this.rowsHandlers.clear();
  }
}
