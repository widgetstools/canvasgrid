/**
 * Live diagnostics session for a saved providerId — ensure/start/poll stats,
 * Restart / Stop controls (Markets DiagnosticsTab behaviour).
 *
 * Stop/Restart also hit {@link stopRegisteredProviderFeeds} so Perspective
 * (and any other non-hub) feeds keyed by the same providerId freeze too.
 */
import { ProviderClientAdapter, type ProviderClientOptions } from '../client/ProviderClientAdapter';
import {
  restartRegisteredProviderFeeds,
  stopRegisteredProviderFeeds,
} from '../feedControlRegistry';
import type { DataProviderConfig, ProviderStatus } from '../types';
import type { ProviderStats } from '../types/stats';
import { emptyProviderStats } from '../types/stats';

export type DiagnosticsState = {
  status: ProviderStatus;
  stats: ProviderStats;
  error?: string;
  busy: boolean;
};

export type DiagnosticsSession = {
  getState(): DiagnosticsState;
  ensure(cfg: DataProviderConfig): Promise<void>;
  restart(cfg: DataProviderConfig): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (state: DiagnosticsState) => void): () => void;
  destroy(): void;
};

const POLL_MS = 500;

export function createDiagnosticsSession(
  hubOpts?: ProviderClientOptions,
): DiagnosticsSession {
  let client: ProviderClientAdapter | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubStatus: (() => void) | null = null;
  /** Last ensure/restart target — Stop uses this even if hub client tore down. */
  let boundProviderId: string | null = null;
  const listeners = new Set<(state: DiagnosticsState) => void>();
  let state: DiagnosticsState = {
    status: 'idle',
    stats: emptyProviderStats('idle'),
    busy: false,
  };

  const emit = (): void => {
    for (const l of listeners) l(state);
  };

  const setState = (patch: Partial<DiagnosticsState>): void => {
    state = { ...state, ...patch };
    emit();
  };

  const stopPoll = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const pollOnce = async (): Promise<void> => {
    if (!client) return;
    try {
      const stats = await client.getStats();
      setState({
        stats,
        status: (stats.status as ProviderStatus) || client.getStatus(),
      });
    } catch {
      /* hub may be mid-restart */
    }
  };

  const startPoll = (): void => {
    stopPoll();
    timer = setInterval(() => { void pollOnce(); }, POLL_MS);
    void pollOnce();
  };

  const disposeClient = (): void => {
    stopPoll();
    unsubStatus?.();
    unsubStatus = null;
    if (client) {
      client.destroy();
      client = null;
    }
  };

  const openClient = async (cfg: DataProviderConfig): Promise<ProviderClientAdapter> => {
    if (!cfg.providerId) throw new Error('Diagnostics require a saved providerId');
    boundProviderId = cfg.providerId;
    disposeClient();
    const next = new ProviderClientAdapter(structuredClone(cfg), hubOpts);
    unsubStatus = next.onStatus((status, error) => {
      setState({ status, error });
    });
    client = next;
    await next.start();
    startPoll();
    setState({ status: next.getStatus() });
    return next;
  };

  return {
    getState() {
      return state;
    },
    async ensure(cfg) {
      setState({ busy: true, error: undefined });
      try {
        await openClient(cfg);
      } catch (err) {
        setState({
          busy: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        setState({ busy: false });
      }
    },
    async restart(cfg) {
      setState({ busy: true, error: undefined });
      try {
        const c = await openClient(cfg);
        await c.restart({ __refresh: Date.now() });
        // Perspective / shared-book feeds (not hub transport).
        if (cfg.providerId) await restartRegisteredProviderFeeds(cfg.providerId);
        await pollOnce();
      } catch (err) {
        setState({
          busy: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        setState({ busy: false });
      }
    },
    async stop() {
      setState({ busy: true });
      try {
        const providerId = boundProviderId ?? client?.getConfig().providerId ?? null;
        if (client) await client.stop();
        // Hub stop alone leaves StompPerspectiveProvider books ticking —
        // freeze any registered non-hub feeds for this providerId.
        if (providerId) await stopRegisteredProviderFeeds(providerId);
        setState({
          status: 'idle',
          stats: emptyProviderStats('idle'),
          busy: false,
          error: undefined,
        });
      } catch (err) {
        setState({
          busy: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      disposeClient();
      listeners.clear();
      state = { status: 'idle', stats: emptyProviderStats('idle'), busy: false };
    },
  };
}
