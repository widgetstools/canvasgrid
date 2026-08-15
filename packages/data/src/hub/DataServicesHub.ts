import type { DataProviderConfig, ProviderStatus, TransportHandle } from '../types';
import type { HubMessage, HubPush, HubRequest } from '../protocol/messages';
import { getTransportFactory } from '../registry/transports';
import { getTransportPlugin } from '../registry/plugins';
import { registerDefaultTransports } from '../transports/registerDefaults';
import { LivePipeline, RowCache, composeRowId } from './rowCache';
import { inferFieldsFromRows } from '../schema/infer';
import type { FieldInfo } from '../types/schema';
import { fieldPathsFromColumnDefs, projectRow, thinDelta } from '../pipeline/project';
import { rowsToColumnar } from '../pipeline/wireFormat';
import {
  createSlotStats,
  estimateBytes,
  markRestart,
  noteMessage,
  notePublish,
  noteStatus,
  resetRuntimeCounters,
  snapshotProviderStats,
  type SlotStatsState,
  zeroedStats,
} from './hubStats';

interface Subscriber {
  port: MessagePort;
  subId: string;
}

interface ProviderSlot {
  config: DataProviderConfig;
  cache: RowCache;
  handle: TransportHandle | null;
  status: ProviderStatus;
  pipeline: LivePipeline | null;
  subscribers: Subscriber[];
  inferredFields: FieldInfo[];
  rowsReceived: number;
  inferSample: Record<string, unknown>[];
  stats: SlotStatsState;
}

/**
 * In-worker hub: one slot per providerId, transport plugins, RowCache,
 * CSRM fan-out and SSRM paging.
 */
export class DataServicesHub {
  private slots = new Map<string, ProviderSlot>();
  private ports = new Set<MessagePort>();

  constructor() {
    registerDefaultTransports();
  }

  addPort(port: MessagePort): void {
    this.ports.add(port);
    port.onmessage = (ev: MessageEvent<HubMessage>) => {
      void this.onMessage(port, ev.data);
    };
    port.start?.();
  }

  removePort(port: MessagePort): void {
    this.ports.delete(port);
    for (const slot of this.slots.values()) {
      slot.subscribers = slot.subscribers.filter((s) => s.port !== port);
    }
  }

  private async onMessage(port: MessagePort, msg: HubMessage): Promise<void> {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    if (!('id' in msg)) return; // pushes shouldn't come inbound
    const req = msg as HubRequest;
    try {
      switch (req.type) {
        case 'ping':
          port.postMessage({ v: 1, id: req.id, type: 'pong' });
          return;
        case 'ensure':
          this.ensureSlot(req.config);
          port.postMessage({ v: 1, id: req.id, type: 'ok' });
          return;
        case 'attach':
          this.attach(req.providerId, port, req.subId);
          port.postMessage({ v: 1, id: req.id, type: 'ok' });
          return;
        case 'detach':
          this.detach(req.providerId, port, req.subId);
          port.postMessage({ v: 1, id: req.id, type: 'ok' });
          return;
        case 'start':
          this.startSlot(req.providerId);
          port.postMessage({ v: 1, id: req.id, type: 'ok' });
          return;
        case 'stop':
          this.stopSlot(req.providerId);
          port.postMessage({ v: 1, id: req.id, type: 'ok' });
          return;
        case 'restart':
          this.restartSlot(req.providerId, req.overlay);
          port.postMessage({ v: 1, id: req.id, type: 'ok' });
          return;
        case 'refresh':
        case 'getSnapshot': {
          const slot = this.slots.get(req.providerId);
          if (!slot) throw new Error(`Unknown provider ${req.providerId}`);
          port.postMessage({
            v: 1,
            id: req.id,
            type: 'snapshot',
            rows: slot.cache.getAll(),
            status: slot.status,
          });
          return;
        }
        case 'getMeta': {
          const slot = this.slots.get(req.providerId);
          if (!slot) throw new Error(`Unknown provider ${req.providerId}`);
          port.postMessage({
            v: 1,
            id: req.id,
            type: 'meta',
            status: slot.status,
            rowCount: slot.cache.size,
            columnDefinitions: slot.config.config.columnDefinitions ?? [],
            inferredFields: slot.inferredFields,
          });
          return;
        }
        case 'getStats': {
          const slot = this.slots.get(req.providerId);
          if (!slot) {
            port.postMessage({
              v: 1,
              id: req.id,
              type: 'stats',
              stats: zeroedStats('idle'),
            });
            return;
          }
          const sample = slot.cache.size > 0 ? slot.cache.getAll()[0] : undefined;
          port.postMessage({
            v: 1,
            id: req.id,
            type: 'stats',
            stats: snapshotProviderStats(slot.stats, {
              rowCount: slot.cache.size,
              sampleRow: sample,
              subscriberCount: slot.subscribers.length,
              status: slot.status,
            }),
          });
          return;
        }
        default:
          port.postMessage({ v: 1, id: (req as { id: string }).id, type: 'error', error: 'Unknown request' });
      }
    } catch (err) {
      port.postMessage({
        v: 1,
        id: req.id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private ensureSlot(config: DataProviderConfig): ProviderSlot {
    let slot = this.slots.get(config.providerId);
    if (slot) {
      // C-m4: if transport is running and config differs, keep the running config
      // and log the divergence. Config changes require explicit restart.
      if (slot.handle && JSON.stringify(slot.config.config) !== JSON.stringify(config.config)) {
        console.warn(
          `[DataServicesHub] config changed for running provider ${config.providerId}; keeping current config. ` +
          'Restart the provider to apply new configuration.',
        );
        return slot;
      }
      slot.config = config;
      slot.cache.setKeyColumn(config.config.keyColumn);
      return slot;
    }
    const cache = new RowCache();
    cache.setKeyColumn(config.config.keyColumn);
    slot = {
      config,
      cache,
      handle: null,
      status: 'idle',
      pipeline: null,
      subscribers: [],
      inferredFields: config.config.inferredFields ?? [],
      rowsReceived: 0,
      inferSample: [],
      stats: createSlotStats(),
    };
    this.slots.set(config.providerId, slot);
    return slot;
  }

  private attach(providerId: string, port: MessagePort, subId: string): void {
    const slot = this.slots.get(providerId);
    if (!slot) throw new Error(`Call ensure before attach (${providerId})`);
    if (!slot.subscribers.some((s) => s.port === port && s.subId === subId)) {
      slot.subscribers.push({ port, subId });
    }
    // Replay cache as replace for CSRM subscribers.
    if (slot.cache.size > 0) {
      this.push(slot, { v: 1, type: 'push', providerId, subId, rows: slot.cache.getAll(), replace: true });
    }
    this.push(slot, { v: 1, type: 'status', providerId, status: slot.status });
  }

  private detach(providerId: string, port: MessagePort, subId: string): void {
    const slot = this.slots.get(providerId);
    if (!slot) return;
    slot.subscribers = slot.subscribers.filter((s) => !(s.port === port && s.subId === subId));
    if (slot.subscribers.length === 0 && slot.handle) {
      // Keep transport running so other windows can attach quickly; stop only on explicit stop.
    }
  }

  private startSlot(providerId: string, opts?: { preserveStats?: boolean }): void {
    const slot = this.slots.get(providerId);
    if (!slot) throw new Error(`Unknown provider ${providerId}`);
    if (slot.handle) return;
    const factory = getTransportFactory(slot.config.providerType);
    if (!factory) throw new Error(`No transport registered for ${slot.config.providerType}`);

    if (!opts?.preserveStats) resetRuntimeCounters(slot.stats);
    slot.pipeline?.destroy();
    slot.pipeline = new LivePipeline(slot.config.config, (rows) => {
      // Fan out hub-merged rows so live txs never replace a full cached
      // row with a thin/partial tick payload.
      const merged = slot.cache.upsert(rows);
      this.fanOutLive(slot, merged);
    });

    const plugin = getTransportPlugin(slot.config.providerType);
    if (slot.config.config.keyColumn == null && plugin?.defaultKeyFields != null) {
      slot.config.config.keyColumn = plugin.defaultKeyFields as string | string[];
    }

    slot.handle = factory(
      slot.config.config,
      (event) => this.onTransportEmit(slot, event),
      { providerId },
    );
    // Transports may default keyColumn (e.g. mock) — pick it up before first emit.
    slot.cache.setKeyColumn(slot.config.config.keyColumn);
  }

  private stopSlot(providerId: string): void {
    const slot = this.slots.get(providerId);
    if (!slot) return;
    slot.handle?.stop();
    slot.handle = null;
    slot.pipeline?.destroy();
    slot.pipeline = null;
    slot.status = 'disconnected';
    noteStatus(slot.stats, slot.status);
    this.broadcastStatus(slot);
  }

  private restartSlot(providerId: string, overlay?: Record<string, unknown>): void {
    const slot = this.slots.get(providerId);
    if (!slot) throw new Error(`Unknown provider ${providerId}`);
    markRestart(slot.stats);
    if (slot.handle) {
      void slot.handle.restart(overlay);
      return;
    }
    this.startSlot(providerId, { preserveStats: true });
  }

  private onTransportEmit(
    slot: ProviderSlot,
    event: import('../types').ProviderEmitEvent,
  ): void {
    if ('status' in event && event.status) {
      slot.status = event.status;
      noteStatus(slot.stats, event.status, event.error);
      this.broadcastStatus(slot, event.error);
      return;
    }
    if ('rowsReceived' in event) {
      slot.rowsReceived = event.rowsReceived;
      this.broadcast(slot, { v: 1, type: 'rowsReceived', providerId: slot.config.providerId, count: event.rowsReceived });
      return;
    }
    if ('rows' in event) {
      let rows = event.rows as Record<string, unknown>[];
      noteMessage(slot.stats, estimateBytes(rows));
      rows = this.applyIngressProjection(slot, rows);
      if (event.replace) {
        slot.cache.replace(rows);
        if (slot.inferSample.length < 200) {
          slot.inferSample = rows.slice(0, 200) as Record<string, unknown>[];
          slot.inferredFields = inferFieldsFromRows(slot.inferSample);
        }
        this.fanOutReplace(slot);
        return;
      }
      // Live — through pipeline
      if (slot.status === 'snapshot' || slot.status === 'connecting') {
        const merged = slot.cache.upsert(rows);
        if (slot.inferSample.length < 200) {
          slot.inferSample.push(...rows.slice(0, 200 - slot.inferSample.length));
          slot.inferredFields = inferFieldsFromRows(slot.inferSample);
        }
        // Progressive snapshot chunks for CSRM
        if (slot.config.rowModel === 'clientSide') {
          this.fanOutLive(slot, merged);
        }
        return;
      }
      slot.pipeline?.push(rows);
      // C-m3 — a transport that can report deletions sets `removes`; drop them
      // from the shared cache and fan the ids out (transports that can't
      // report removes never set the field, so this stays inert for them).
      if ('removes' in event && event.removes && event.removes.length) {
        const dropped = slot.cache.remove(event.removes as string[]);
        if (dropped.length) this.fanOutLive(slot, [], dropped);
      }
    }
  }

  private applyIngressProjection(
    slot: ProviderSlot,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const cfg = slot.config.config;
    const paths = cfg.projectFields
      ? fieldPathsFromColumnDefs(cfg.columnDefinitions, cfg.keyColumn)
      : null;
    const keyFields = typeof cfg.keyColumn === 'string'
      ? [cfg.keyColumn]
      : Array.isArray(cfg.keyColumn)
        ? [...cfg.keyColumn]
        : [];

    return rows.map((row) => {
      let next = paths?.length ? projectRow(row, paths) : row;
      if (cfg.thinDeltas) {
        const id = composeRowId(next, cfg.keyColumn);
        const prev = id != null ? slot.cache.get(id) : undefined;
        next = thinDelta(prev, next, keyFields);
      }
      return next;
    });
  }

  /**
   * Fan out a full snapshot as a chunked REPLACE sequence. C-C3 fix: every
   * chunk carries `replace: true` plus a `seq` ordinal and a `final` flag, so
   * the client treats chunk 0 as a cache reset and chunks 1..N as APPENDS to
   * the same replace (previously chunks 2..N shipped as `replace: false` ticks
   * of unknown ids and were dropped by the kernel → remote tabs truncated to
   * one chunk).
   */
  private fanOutReplace(slot: ProviderSlot): void {
    const rows = slot.cache.getAll();
    const chunk = slot.config.config.snapshotChunkSize ?? 500;
    if (rows.length === 0) {
      notePublish(slot.stats);
      this.broadcast(slot, {
        v: 1,
        type: 'push',
        providerId: slot.config.providerId,
        rows: [],
        replace: true,
        seq: 0,
        final: true,
      });
      return;
    }
    let seq = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      notePublish(slot.stats);
      this.broadcast(slot, {
        v: 1,
        type: 'push',
        providerId: slot.config.providerId,
        rows: slice,
        replace: true,
        seq,
        final: i + chunk >= rows.length,
      });
      seq++;
    }
  }

  private fanOutLive(
    slot: ProviderSlot,
    rows: Record<string, unknown>[],
    removes?: string[],
  ): void {
    notePublish(slot.stats);
    this.broadcast(slot, {
      v: 1,
      type: 'push',
      providerId: slot.config.providerId,
      rows: slot.config.config.wireFormat === 'columnar' ? rowsToColumnar(rows) : rows,
      replace: false,
      ...(removes && removes.length ? { removes } : {}),
    });
  }

  private broadcastStatus(slot: ProviderSlot, error?: string): void {
    this.broadcast(slot, {
      v: 1,
      type: 'status',
      providerId: slot.config.providerId,
      status: slot.status,
      error,
    });
  }

  private broadcast(slot: ProviderSlot, msg: HubPush): void {
    const deadPorts = new Set<MessagePort>();
    for (const sub of slot.subscribers) {
      try {
        sub.port.postMessage(msg);
      } catch {
        // C-C1: mark dead port for removal
        deadPorts.add(sub.port);
      }
    }
    // C-C1: reap dead ports from all slots
    for (const port of deadPorts) {
      this.removePort(port);
    }
  }

  private push(slot: ProviderSlot, msg: HubPush): void {
    const deadPorts = new Set<MessagePort>();
    for (const sub of slot.subscribers) {
      if (msg.type === 'push' && msg.subId && msg.subId !== sub.subId) continue;
      try {
        sub.port.postMessage(msg);
      } catch {
        // C-C1: mark dead port for removal
        deadPorts.add(sub.port);
      }
    }
    // C-C1: reap dead ports from all slots
    for (const port of deadPorts) {
      this.removePort(port);
    }
  }
}
