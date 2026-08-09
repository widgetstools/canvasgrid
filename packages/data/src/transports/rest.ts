import type {
  ProviderEmit,
  RestTransportConfig,
  TransportContext,
  TransportHandle,
} from '../types';

function dig(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function createRestTransport(
  cfg: RestTransportConfig,
  emit: ProviderEmit,
  _ctx: TransportContext,
): TransportHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const poll = cfg.pollInterval ?? 0;

  const fetchOnce = async (): Promise<void> => {
    if (stopped) return;
    emit({ status: 'connecting' });
    try {
      const url = new URL(cfg.endpoint, cfg.baseUrl);
      if (cfg.queryParams) {
        for (const [k, v] of Object.entries(cfg.queryParams)) url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), {
        method: cfg.method ?? 'GET',
        headers: cfg.headers,
        body: cfg.method === 'POST' ? cfg.body : undefined,
        signal: AbortSignal.timeout(cfg.timeout ?? 30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const raw = dig(json, cfg.rowsPath);
      const rows = Array.isArray(raw) ? raw : [];
      emit({ status: 'snapshot' });
      emit({ rows, replace: true });
      emit({ rowsReceived: rows.length });
      emit({ status: 'ready' });
    } catch (err) {
      emit({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };

  void fetchOnce();
  if (poll > 0) {
    timer = setInterval(() => { void fetchOnce(); }, poll);
  }

  return {
    stop() {
      stopped = true;
      if (timer != null) clearInterval(timer);
      timer = null;
      emit({ status: 'disconnected' });
    },
    restart() {
      stopped = false;
      void fetchOnce();
    },
  };
}
