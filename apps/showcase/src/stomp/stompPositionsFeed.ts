import { Client, type IMessage } from '@stomp/stompjs';
import type { PositionRow, StompFeedConfig, StompFeedState } from '../types';

const SNAPSHOT_END_TOKEN = 'Success';

function extractRows(parsed: unknown): Partial<PositionRow>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Partial<PositionRow>[];
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed as Partial<PositionRow>];
  }
  return [];
}

function mergeRow(existing: PositionRow, delta: Partial<PositionRow>): PositionRow {
  return { ...existing, ...delta, positionId: existing.positionId };
}

export interface StompFeedCallbacks {
  onSnapshot?: (rows: PositionRow[]) => void;
  onLiveUpdate?: (updates: PositionRow[]) => void;
  onFeedChange?: (feed: StompFeedState) => void;
}

export class StompPositionsFeed {
  private feed: StompFeedState = {
    phase: 'idle',
    rowsReceived: 0,
    liveUpdates: 0,
    lastUpdateAt: null,
    error: null,
  };

  private callbacks: StompFeedCallbacks;
  private rowStore = new Map<string, PositionRow>();
  private snapshotBuffer: PositionRow[] = [];
  private snapshotComplete = false;
  private client: Client | null = null;
  private generation = 0;

  constructor(
    private config: StompFeedConfig,
    callbacks: StompFeedCallbacks = {},
  ) {
    this.callbacks = callbacks;
    this.connect();
  }

  getFeed(): StompFeedState {
    return this.feed;
  }

  reconnect(): void {
    this.disconnect(false);
    this.connect();
  }

  disconnect(updatePhase = true): void {
    this.generation += 1;
    const client = this.client;
    this.client = null;
    if (client) void client.deactivate().catch(() => undefined);
    if (updatePhase) {
      this.setFeed({ ...this.feed, phase: 'disconnected' });
    }
  }

  destroy(): void {
    this.disconnect(false);
  }

  private setFeed(next: StompFeedState): void {
    this.feed = next;
    this.callbacks.onFeedChange?.(next);
  }

  private handleMessage = (message: IMessage): void => {
    const body = message.body?.trim() ?? '';
    if (!body) return;

    if (body.includes(SNAPSHOT_END_TOKEN)) {
      if (!this.snapshotComplete) {
        const rows = this.snapshotBuffer;
        const store = new Map<string, PositionRow>();
        for (const row of rows) {
          if (row.positionId) store.set(row.positionId, row);
        }
        this.rowStore = store;
        this.snapshotBuffer = [];
        this.snapshotComplete = true;
        this.callbacks.onSnapshot?.(rows);
        this.setFeed({
          ...this.feed,
          phase: 'live',
          rowsReceived: store.size,
        });
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return;
    }

    const deltas = extractRows(parsed);
    if (deltas.length === 0) return;

    if (!this.snapshotComplete) {
      for (const row of deltas) {
        if (row.positionId) {
          this.snapshotBuffer.push(row as PositionRow);
        }
      }
      this.setFeed({
        ...this.feed,
        phase: 'snapshot',
        rowsReceived: this.snapshotBuffer.length,
      });
      return;
    }

    const updates: PositionRow[] = [];
    for (const delta of deltas) {
      const id = delta.positionId;
      if (!id) continue;
      const existing = this.rowStore.get(id);
      if (!existing) continue;
      const merged = mergeRow(existing, delta);
      this.rowStore.set(id, merged);
      updates.push(merged);
    }

    if (updates.length === 0) return;
    this.callbacks.onLiveUpdate?.(updates);
    this.setFeed({
      ...this.feed,
      liveUpdates: this.feed.liveUpdates + updates.length,
      lastUpdateAt: Date.now(),
    });
  };

  private connect(): void {
    this.generation += 1;
    const generation = this.generation;

    this.snapshotBuffer = [];
    this.snapshotComplete = false;
    this.rowStore = new Map();
    this.setFeed({
      phase: 'connecting',
      rowsReceived: 0,
      liveUpdates: 0,
      lastUpdateAt: null,
      error: null,
    });

    const client = new Client({
      brokerURL: this.config.wsUrl,
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        if (generation !== this.generation) return;

        const topic = `/snapshot/positions/${this.config.clientId}`;
        const trigger = `/snapshot/positions/${this.config.clientId}/${this.config.rate}/${this.config.batchSize}`;

        client.subscribe(topic, this.handleMessage);

        const headers: Record<string, string> = {
          'snapshot-rows': String(this.config.snapshotRows),
          'updates-per-tick': String(this.config.updatesPerTick),
        };
        if (this.config.sparse) {
          headers['live-mode'] = 'sparse';
        }

        client.publish({ destination: trigger, body: '', headers });
        this.setFeed({ ...this.feed, phase: 'snapshot' });
      },
      onStompError: (frame) => {
        if (generation !== this.generation) return;
        this.setFeed({
          ...this.feed,
          phase: 'error',
          error: frame.headers.message ?? 'STOMP protocol error',
        });
      },
      onWebSocketError: () => {
        if (generation !== this.generation) return;
        this.setFeed({
          ...this.feed,
          phase: 'error',
          error: 'WebSocket connection failed — is stomp-view-server running on port 8081?',
        });
      },
      onDisconnect: () => {
        if (generation !== this.generation) return;
        this.setFeed({
          ...this.feed,
          phase: this.feed.phase === 'error' ? 'error' : 'disconnected',
        });
      },
    });

    this.client = client;
    client.activate();
  }
}
