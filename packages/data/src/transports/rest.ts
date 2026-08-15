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
  ctx: TransportContext,
): TransportHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let generation = 0;
  let abortController: AbortController | null = null;
  const poll = cfg.pollInterval ?? 0;

  const fetchOnce = async (): Promise<void> => {
    if (stopped) return;

    const currentGeneration = generation;
    abortController = new AbortController();

    // Populate TransportContext.signal for external cancellation
    if (ctx && typeof ctx === 'object') {
      (ctx as any).signal = abortController.signal;
    }

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
        signal: AbortSignal.any([
          abortController.signal,
          AbortSignal.timeout(cfg.timeout ?? 30_000),
        ]),
      });

      // Ignore response if generation has changed (newer fetch completed)
      if (currentGeneration !== generation) return;

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const raw = dig(json, cfg.rowsPath);
      const rows = Array.isArray(raw) ? raw : [];
      emit({ status: 'snapshot' });
      emit({ rows, replace: true });
      emit({ rowsReceived: rows.length });
      emit({ status: 'ready' });
    } catch (err) {
      // Only emit error if not aborted or generation changed
      if (currentGeneration === generation && !(err instanceof Error && err.name === 'AbortError')) {
        emit({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortController = null;
    }
  };

  void fetchOnce();
  if (poll > 0) {
    timer = setInterval(() => { void fetchOnce(); }, poll);
  }

  return {
    stop() {
      stopped = true;
      generation++;
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (timer != null) clearInterval(timer);
      timer = null;
      emit({ status: 'disconnected' });
    },
    restart() {
      stopped = false;
      generation++;
      void fetchOnce();
      if (poll > 0 && timer == null) {
        timer = setInterval(() => { void fetchOnce(); }, poll);
      }
    },
  };
}
