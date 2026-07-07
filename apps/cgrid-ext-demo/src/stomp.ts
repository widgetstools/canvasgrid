import { Client, type IMessage } from '@stomp/stompjs';

/** Row shape published by stomp-view-server's positions view. */
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
}

export interface StompCallbacks {
  onSnapshot: (rows: Position[]) => void;
  onLiveUpdate: (updates: Position[]) => void;
  onPhase: (phase: 'connecting' | 'snapshot' | 'live' | 'error' | 'disconnected') => void;
}

/** Testbed knobs — moderate by default so the demo feels live without
 *  saturating a dev laptop while panels are being exercised. `?stress=light`
 *  keeps E2E deterministic; `?stress=heavy` matches cgrid-positions. */
const KNOB_SETS = {
  heavy: { snapshotRows: 20_000, rate: 200, batchSize: 50, updatesPerTick: 50 },
  default: { snapshotRows: 5_000, rate: 60, batchSize: 50, updatesPerTick: 5 },
  light: { snapshotRows: 3_000, rate: 7, batchSize: 50, updatesPerTick: 1 },
} as const;

const stress =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('stress')
    : null;
const KNOBS =
  stress === 'light' ? KNOB_SETS.light : stress === 'heavy' ? KNOB_SETS.heavy : KNOB_SETS.default;

const DEFAULTS = {
  wsUrl: 'ws://localhost:8081',
  clientId: 'EXTDEMO01',
  snapshotRows: KNOBS.snapshotRows,
  rate: KNOBS.rate,
  batchSize: KNOBS.batchSize,
  sparse: true,
  updatesPerTick: KNOBS.updatesPerTick,
};

export const STOMP_PUBLISH_RATE_PER_SEC = DEFAULTS.rate * DEFAULTS.updatesPerTick;

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
 * Protocol (same stomp-view-server as cgrid-customizer-demo / cgrid-positions
 * / showcase): subscribe `/snapshot/positions/<clientId>` — snapshot batches
 * then live ticks on one channel; publish a trigger to
 * `/snapshot/positions/<clientId>/<rate>/<batchSize>` with `snapshot-rows`,
 * `updates-per-tick`, optional `live-mode: sparse` headers; a `Success`
 * marker terminates the snapshot.
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

      if (!snapshotComplete) {
        for (const row of deltas) {
          if (row.positionId) snapshotBuffer.push(row as Position);
        }
        return;
      }

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
