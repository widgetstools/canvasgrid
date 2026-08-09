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
  const endTokenRe = buildEndTokenMatcher(cfg.snapshotEndToken ?? 'Success');
  const reconnectDelay = cfg.reconnect?.initialDelayMs ?? 2000;

  const activate = (): void => {
    if (client) return;
    snapshotComplete = false;
    received = 0;
    emit({ status: 'connecting' });
    const c = new Client({
      brokerURL: cfg.websocketUrl,
      reconnectDelay,
      heartbeatIncoming: cfg.heartbeat?.incoming ?? 4000,
      heartbeatOutgoing: cfg.heartbeat?.outgoing ?? 4000,
      onConnect: () => {
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
      onStompError: (f) => emit({ status: 'error', error: f.headers['message'] ?? 'STOMP error' }),
      onWebSocketError: () => emit({ status: 'error', error: 'WebSocket error' }),
      onWebSocketClose: () => emit({ status: 'disconnected' }),
    });
    client = c;
    c.activate();
  };

  const onMessage = (msg: IMessage): void => {
    const body = msg.body?.trim() ?? '';
    if (!body) return;
    // Markets: case-insensitive substring match on the end token.
    if (endTokenRe?.test(body)) {
      if (snapshotComplete) return;
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
      if (c) {
        try { void c.deactivate(); } catch { /* swallow */ }
      }
      emit({ status: 'disconnected' });
    },
    restart(overlay) {
      const c = client;
      client = null;
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

/** Case-insensitive substring matcher (Markets `buildEndTokenMatcher`). */
export function buildEndTokenMatcher(token: string | undefined): RegExp | null {
  if (!token) return null;
  return new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}
