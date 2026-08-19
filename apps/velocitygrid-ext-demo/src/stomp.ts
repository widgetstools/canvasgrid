import { Client, type IMessage } from '@stomp/stompjs';

/** Raw row from stomp-view-server — may include nested objects. */
export type StompRow = Record<string, unknown> & { positionId: string };

/** @deprecated Use StompRow — kept for harness / decorate helpers. */
export type Position = StompRow & {
  cusip?: string;
  ticker?: string;
  notionalAmount?: number;
  marketValue?: number;
  currentPrice?: number;
  pnl?: number;
  dailyPnl?: number;
  unrealizedPnl?: number;
  yield?: number;
  spread?: number;
  dv01?: number;
  pv01?: number;
  desk?: string;
  region?: string;
  currency?: string;
  trader?: string;
};

export interface StompCallbacks {
  onSnapshot: (rows: StompRow[]) => void;
  onLiveUpdate: (updates: StompRow[]) => void;
  onPhase: (phase: 'connecting' | 'snapshot' | 'live' | 'error' | 'disconnected') => void;
  /** Fired while buffering snapshot batches — `loaded` grows; `total` is
   *  the requested snapshot size when known. */
  onSnapshotProgress?: (loaded: number, total: number) => void;
}

/** Testbed knobs — full 20k server snapshot by default. `?stress=light`
 *  keeps E2E deterministic (smaller set + slower ticks); `?stress=heavy`
 *  keeps 20k and raises the live tick rate. */
const KNOB_SETS = {
  heavy: { snapshotRows: 20_000, rate: 200, batchSize: 50, updatesPerTick: 50 },
  default: { snapshotRows: 20_000, rate: 60, batchSize: 50, updatesPerTick: 5 },
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
/** Rows requested from stomp-view-server via the `snapshot-rows` header. */
export const STOMP_SNAPSHOT_ROWS = DEFAULTS.snapshotRows;

const SNAPSHOT_END_TOKEN = 'Success';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** Deep-merge sparse live ticks into the stored row (nested objects recurse). */
export function deepMergeRow(base: StompRow, patch: Partial<StompRow>): StompRow {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'positionId') continue;
    const prev = out[key];
    if (isPlainObject(value) && isPlainObject(prev)) {
      out[key] = deepMergeRow(prev as StompRow, value as Partial<StompRow>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  out.positionId = base.positionId;
  return out as StompRow;
}

function extractRows(parsed: unknown): Partial<StompRow>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Partial<StompRow>[];
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed as Partial<StompRow>];
  }
  return [];
}

/**
 * Protocol (same stomp-view-server as velocitygrid-customizer-demo / velocitygrid-positions
 * / showcase): subscribe `/snapshot/positions/<clientId>` — snapshot batches
 * then live ticks on one channel; publish a trigger to
 * `/snapshot/positions/<clientId>/<rate>/<batchSize>` with `snapshot-rows`,
 * `updates-per-tick`, optional `live-mode: sparse` headers; a `Success`
 * marker terminates the snapshot.
 */
export function connectStomp(cb: StompCallbacks) {
  cb.onPhase('connecting');
  const liveBuffer: StompRow[] = [];
  const snapshotBuffer: StompRow[] = [];
  const rowStore = new Map<string, StompRow>();
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
          if (row.positionId) rowStore.set(String(row.positionId), row);
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
          if (row.positionId != null && row.positionId !== '') {
            snapshotBuffer.push({ ...row, positionId: String(row.positionId) } as StompRow);
          }
        }
        cb.onSnapshotProgress?.(snapshotBuffer.length, DEFAULTS.snapshotRows);
        return;
      }

      for (const delta of deltas) {
        const id = delta.positionId != null ? String(delta.positionId) : '';
        if (!id) continue;
        const existing = rowStore.get(id);
        if (!existing) continue;
        const merged = deepMergeRow(existing, delta);
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
