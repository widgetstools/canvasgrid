import { Client, type IMessage } from '@stomp/stompjs';
import { useCallback, useEffect, useRef, useState } from 'react';
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
}

export interface UseStompPositionsResult {
  feed: StompFeedState;
  reconnect: () => void;
  disconnect: () => void;
}

export function useStompPositions(
  config: StompFeedConfig,
  callbacks: StompFeedCallbacks = {},
): UseStompPositionsResult {
  const [feed, setFeed] = useState<StompFeedState>({
    phase: 'idle',
    rowsReceived: 0,
    liveUpdates: 0,
    lastUpdateAt: null,
    error: null,
  });

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const rowStoreRef = useRef<Map<string, PositionRow>>(new Map());
  const snapshotBufferRef = useRef<PositionRow[]>([]);
  const snapshotCompleteRef = useRef(false);
  const clientRef = useRef<Client | null>(null);
  const generationRef = useRef(0);

  const handleMessage = useCallback((message: IMessage) => {
    const body = message.body?.trim() ?? '';
    if (!body) return;

    if (body.includes(SNAPSHOT_END_TOKEN)) {
      if (!snapshotCompleteRef.current) {
        const rows = snapshotBufferRef.current;
        const store = new Map<string, PositionRow>();
        for (const row of rows) {
          if (row.positionId) store.set(row.positionId, row);
        }
        rowStoreRef.current = store;
        snapshotBufferRef.current = [];
        snapshotCompleteRef.current = true;
        callbacksRef.current.onSnapshot?.(rows);
        setFeed((prev) => ({
          ...prev,
          phase: 'live',
          rowsReceived: store.size,
        }));
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

    if (!snapshotCompleteRef.current) {
      for (const row of deltas) {
        if (row.positionId) {
          snapshotBufferRef.current.push(row as PositionRow);
        }
      }
      setFeed((prev) => ({
        ...prev,
        phase: 'snapshot',
        rowsReceived: snapshotBufferRef.current.length,
      }));
      return;
    }

    const store = rowStoreRef.current;
    const updates: PositionRow[] = [];
    for (const delta of deltas) {
      const id = delta.positionId;
      if (!id) continue;
      const existing = store.get(id);
      if (!existing) continue;
      const merged = mergeRow(existing, delta);
      store.set(id, merged);
      updates.push(merged);
    }

    if (updates.length === 0) return;
    callbacksRef.current.onLiveUpdate?.(updates);
    setFeed((prev) => ({
      ...prev,
      liveUpdates: prev.liveUpdates + updates.length,
      lastUpdateAt: Date.now(),
    }));
  }, []);

  const connect = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    snapshotBufferRef.current = [];
    snapshotCompleteRef.current = false;
    rowStoreRef.current = new Map();
    setFeed({
      phase: 'connecting',
      rowsReceived: 0,
      liveUpdates: 0,
      lastUpdateAt: null,
      error: null,
    });

    const client = new Client({
      brokerURL: config.wsUrl,
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        if (generation !== generationRef.current) return;

        const topic = `/snapshot/positions/${config.clientId}`;
        const trigger = `/snapshot/positions/${config.clientId}/${config.rate}/${config.batchSize}`;

        client.subscribe(topic, handleMessage);

        const headers: Record<string, string> = {
          'snapshot-rows': String(config.snapshotRows),
          'updates-per-tick': String(config.updatesPerTick),
        };
        if (config.sparse) {
          headers['live-mode'] = 'sparse';
        }

        client.publish({ destination: trigger, body: '', headers });
        setFeed((prev) => ({ ...prev, phase: 'snapshot' }));
      },
      onStompError: (frame) => {
        if (generation !== generationRef.current) return;
        setFeed((prev) => ({
          ...prev,
          phase: 'error',
          error: frame.headers.message ?? 'STOMP protocol error',
        }));
      },
      onWebSocketError: () => {
        if (generation !== generationRef.current) return;
        setFeed((prev) => ({
          ...prev,
          phase: 'error',
          error: 'WebSocket connection failed — is stomp-view-server running on port 8081?',
        }));
      },
      onDisconnect: () => {
        if (generation !== generationRef.current) return;
        setFeed((prev) => ({
          ...prev,
          phase: prev.phase === 'error' ? 'error' : 'disconnected',
        }));
      },
    });

    clientRef.current = client;
    client.activate();
  }, [config, handleMessage]);

  const disconnect = useCallback(() => {
    generationRef.current += 1;
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.deactivate();
    setFeed((prev) => ({ ...prev, phase: 'disconnected' }));
  }, []);

  useEffect(() => {
    connect();
    return () => {
      generationRef.current += 1;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void client.deactivate();
    };
  }, [connect]);

  return { feed, reconnect: connect, disconnect };
}
