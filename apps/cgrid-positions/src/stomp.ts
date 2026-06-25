import { Client, type IMessage } from '@stomp/stompjs';

export interface Position {
  positionId: string;
  cusip: string;
  ticker: string;
  notionalAmount: number;
  marketValue: number;
  currentPrice: number;
  pnl: number;
  dailyPnl: number;
  unrealizedPnl: number;
  yield: number;
  spread: number;
  dv01: number;
  pv01: number;
  // Demo-only fields populated by user edits — not sent by the STOMP server.
  // Drive the date, dateString, largeText, and checkbox editor demos.
  tradeDate?: string;
  expiryDate?: Date;
  notes?: string;
  confirmed?: boolean;
}

export interface StompCallbacks {
  onSnapshot: (rows: Position[]) => void;
  onLiveUpdate: (updates: Position[]) => void;
  onPhase: (phase: 'connecting' | 'snapshot' | 'live' | 'error' | 'disconnected') => void;
}

const DEFAULTS = {
  wsUrl: 'ws://localhost:8081',
  clientId: 'TRADER001',
  // 20k row snapshot — exercises the worker's chunk pipeline + paint
  // throughput at the high end of the showcase target. The server
  // (stomp-view-server) defaults to 20k via DEFAULT_SNAPSHOT_ROWS.
  snapshotRows: 20_000,
  // 200 ticks/sec × 50 updates/tick = 10,000 row updates/sec
  // PUBLISHED by the server (verified via stomp-view-server logs).
  // Server-side patch `stomp-view-server/src/stomp/connection.ts`
  // honors the `updates-per-tick` header by packing N row mutations
  // into each MESSAGE so we can break Node's ~1ms `setInterval`
  // floor. The grid's status pill shows both the published rate and
  // the rate the main thread actually processes (typically
  // 5-7 k/sec on a dev laptop — the gap is decode + worker round-
  // trip + canvas repaint per chunk; Cycle 24 perf-hardening
  // narrows it).
  rate: 200,
  batchSize: 50,
  sparse: true,
  updatesPerTick: 50,
};

/** Cycle 4 follow-up — expose the configured server publish rate
 *  (rate × updatesPerTick) so the demo's status pill can render the
 *  theoretical max alongside the realised processing rate. */
export const STOMP_PUBLISH_RATE_PER_SEC =
  DEFAULTS.rate * DEFAULTS.updatesPerTick;

const SNAPSHOT_END_TOKEN = 'Success';

function extractRows(parsed: unknown): Partial<Position>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Partial<Position>[];
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed as Partial<Position>];
  }
  return [];
}

/**
 * Protocol (matches the stomp-view-server used by apps/showcase):
 *
 * 1. Subscribe to ONE topic: `/snapshot/positions/<clientId>`. Both snapshot batches
 *    AND live ticks arrive on this channel.
 * 2. PUBLISH a trigger to `/snapshot/positions/<clientId>/<rate>/<batchSize>` with
 *    headers `snapshot-rows`, `updates-per-tick`, optional `live-mode: sparse`.
 *    The server streams snapshot rows in batches and terminates with a `Success`
 *    marker; subsequent messages are live updates.
 * 3. Track a `snapshotComplete` flag locally to route messages.
 */
export function connectStomp(cb: StompCallbacks) {
  cb.onPhase('connecting');
  const liveBuffer: Position[] = [];
  const snapshotBuffer: Position[] = [];
  const rowStore = new Map<string, Position>();
  let snapshotComplete = false;

  const client = new Client({
    brokerURL: DEFAULTS.wsUrl,
    reconnectDelay: 2000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
  });

  client.onConnect = () => {
    cb.onPhase('snapshot');
    const topic = `/snapshot/positions/${DEFAULTS.clientId}`;
    const trigger = `/snapshot/positions/${DEFAULTS.clientId}/${DEFAULTS.rate}/${DEFAULTS.batchSize}`;

    client.subscribe(topic, (msg: IMessage) => {
      const body = msg.body?.trim() ?? '';
      if (!body) return;

      // Snapshot-end marker → flush buffer + transition to live
      if (body.includes(SNAPSHOT_END_TOKEN)) {
        if (snapshotComplete) return;
        snapshotComplete = true;
        for (const row of snapshotBuffer) {
          if (row.positionId) rowStore.set(row.positionId, row);
        }
        const rows = snapshotBuffer.splice(0);
        cb.onSnapshot(rows);
        cb.onPhase('live');
        return;
      }

      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return; }
      const deltas = extractRows(parsed);
      if (deltas.length === 0) return;

      // Pre-snapshot: accumulate into snapshotBuffer
      if (!snapshotComplete) {
        for (const row of deltas) {
          if (row.positionId) snapshotBuffer.push(row as Position);
        }
        return;
      }

      // Live: merge deltas into rowStore, batch via liveBuffer, flush at batchSize
      for (const delta of deltas) {
        const id = delta.positionId;
        if (!id) continue;
        const existing = rowStore.get(id);
        if (!existing) continue;
        const merged: Position = { ...existing, ...delta, positionId: existing.positionId };
        rowStore.set(id, merged);
        liveBuffer.push(merged);
      }
      if (liveBuffer.length >= DEFAULTS.batchSize) {
        cb.onLiveUpdate(liveBuffer.splice(0));
      }
    });

    const headers: Record<string, string> = {
      'snapshot-rows': String(DEFAULTS.snapshotRows),
      'updates-per-tick': String(DEFAULTS.updatesPerTick),
    };
    if (DEFAULTS.sparse) headers['live-mode'] = 'sparse';
    client.publish({ destination: trigger, body: '', headers });
  };

  client.onStompError = (frame) => {
    console.error('[stomp] error:', frame.headers['message']);
    cb.onPhase('error');
  };

  client.onWebSocketError = (e) => {
    console.error('[stomp] ws error:', (e as Event & { message?: string })?.message ?? e);
    cb.onPhase('error');
  };

  client.onWebSocketClose = () => cb.onPhase('disconnected');

  client.activate();
  return { client, disconnect: () => client.deactivate() };
}
