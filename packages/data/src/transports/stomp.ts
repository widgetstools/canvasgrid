import { Client, type IMessage } from '@stomp/stompjs';
import type {
  ProviderEmit,
  StompTransportConfig,
  TransportContext,
  TransportHandle,
} from '../types';

function extractRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  }
  if (parsed && typeof parsed === 'object') return [parsed as Record<string, unknown>];
  return [];
}

export function createStompTransport(
  cfg: StompTransportConfig,
  emit: ProviderEmit,
  _ctx: TransportContext,
): TransportHandle {
  let client: Client | null = null;
  let snapshotComplete = false;
  let received = 0;
  let snapshotTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const endToken = cfg.snapshotEndToken ?? 'Success';
  const reconnectDelay = cfg.reconnect?.initialDelayMs ?? 2000;
  const maxReconnectAttempts = cfg.reconnect?.maxAttempts ?? Infinity;
  const maxReconnectDelayMs = cfg.reconnect?.maxDelayMs ?? 60000;

  const clearSnapshotTimeout = (): void => {
    if (snapshotTimeoutHandle != null) {
      clearTimeout(snapshotTimeoutHandle);
      snapshotTimeoutHandle = null;
    }
  };

  const activate = (): void => {
    if (client) return;
    reconnectAttempts = 0;
    emit({ status: 'connecting' });
    const c = new Client({
      brokerURL: cfg.websocketUrl,
      reconnectDelay,
      maxReconnectDelay: maxReconnectDelayMs,
      heartbeatIncoming: cfg.heartbeat?.incoming ?? 4000,
      heartbeatOutgoing: cfg.heartbeat?.outgoing ?? 4000,
      onConnect: () => {
        // Reset snapshot state on every connect (new connection or reconnect)
        snapshotComplete = false;
        received = 0;
        clearSnapshotTimeout();

        // Set up snapshot timeout if configured
        if (cfg.snapshotTimeoutMs != null && cfg.snapshotTimeoutMs > 0) {
          snapshotTimeoutHandle = setTimeout(() => {
            if (!snapshotComplete) {
              emit({ status: 'error', error: `Snapshot timeout after ${cfg.snapshotTimeoutMs}ms` });
              clearSnapshotTimeout();
            }
          }, cfg.snapshotTimeoutMs);
        }

        emit({ status: 'snapshot' });
        c.subscribe(cfg.listenerTopic, (msg: IMessage) => onMessage(msg));
        const dest = cfg.requestMessage ?? cfg.listenerTopic;
        c.publish({
          destination: dest,
          body: cfg.requestBody ?? dest,
          headers: cfg.batchSize != null
            ? { 'snapshot-rows': String(cfg.messageRate ?? ''), batchSize: String(cfg.batchSize) }
            : {},
        });
      },
      onStompError: (f) => {
        clearSnapshotTimeout();
        emit({ status: 'error', error: f.headers['message'] ?? 'STOMP error' });
      },
      onWebSocketError: () => {
        clearSnapshotTimeout();
        emit({ status: 'error', error: 'WebSocket error' });
      },
      onWebSocketClose: () => {
        clearSnapshotTimeout();
        reconnectAttempts++;
        if (reconnectAttempts > maxReconnectAttempts) {
          // Stop stompjs's own auto-reconnect loop before dropping the shared
          // reference — nulling `client` alone leaves `c` retrying forever
          // and leaks the WebSocket (stop()/restart() see client === null and
          // never call deactivate() on it).
          client = null;
          try { void c.deactivate(); } catch { /* swallow */ }
          emit({ status: 'error', error: `Max reconnect attempts (${maxReconnectAttempts}) exceeded` });
        } else {
          emit({ status: 'disconnected' });
        }
      },
    });
    client = c;
    c.activate();
  };

  const onMessage = (msg: IMessage): void => {
    const body = msg.body?.trim() ?? '';
    if (!body) return;

    // Exact match or ${token}: prefix (from book.ts pattern)
    if (body === endToken || body.startsWith(`${endToken}:`)) {
      if (snapshotComplete) return;
      clearSnapshotTimeout();
      snapshotComplete = true;
      emit({ rowsReceived: received });
      emit({ status: 'ready' });
      return;
    }

    try {
      const rows = extractRows(JSON.parse(body));
      if (!rows.length) return;
      received += rows.length;
      if (!snapshotComplete) {
        // First batch after reconnect should have replace: true
        emit({ rows, replace: received === rows.length });
        emit({ rowsReceived: received, byteSize: body.length });
      } else {
        emit({ rows });
      }
    } catch {
      /* ignore non-JSON */
    }
  };

  if (cfg.autoStart !== false) activate();

  return {
    stop() {
      const c = client;
      client = null;
      clearSnapshotTimeout();
      if (c) {
        try { void c.deactivate(); } catch { /* swallow */ }
      }
      emit({ status: 'disconnected' });
    },
    restart(overlay) {
      const c = client;
      client = null;
      clearSnapshotTimeout();
      if (c) {
        try { void c.deactivate(); } catch { /* swallow */ }
      }
      if (overlay && typeof overlay === 'object') {
        Object.assign(cfg as object, overlay);
      }
      activate();
    },
  };
}
