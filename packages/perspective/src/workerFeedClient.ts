/**
 * Page side of the in-worker SSRM feed.
 *
 * The page's job shrinks to almost nothing here: describe the feed once, and
 * then read state that the worker pushes. It does not connect to the broker,
 * does not assemble the snapshot, does not race anyone for the right to do
 * either. Rows land in the shared table and reach this page's views through
 * the engine's realtime poll, exactly as another tab's writes always did.
 *
 * ONE control port per page, shared by every feed it asks for. A port is what
 * the worker counts subscribers by, so a page that opened one per provider
 * would be counted several times and would keep a feed alive after the
 * blotter using it had gone.
 */

import {
  getSharedEngineProtocol,
  openSharedEngineControlPort,
  withTimeout,
} from './bootstrap';
import {
  WORKER_FEED_PROTOCOL,
  isWorkerFeedPush,
  type WorkerFeedConfig,
  type WorkerFeedState,
} from './workerFeedProtocol';

/** Heartbeat for the worker's subscriber reaper. Comfortably inside its 5
 *  minute idle timeout even when a hidden tab's timers are throttled to
 *  roughly one a minute. */
const FEED_HEARTBEAT_MS = 45_000;
/** A worker that never answers is not going to; do not hang boot on it. */
const FEED_REQUEST_TIMEOUT_MS = 10_000;

interface ControlChannel {
  port: MessagePort;
  /** Per-table listeners, so several blotters on one page each see state. */
  listeners: Map<string, Set<(state: WorkerFeedState) => void>>;
  /** Latest state per table, so a listener attached after the fact is not
   *  blind until the next push. */
  latest: Map<string, WorkerFeedState>;
}

let channel: ControlChannel | null = null;

function ensureChannel(): ControlChannel | null {
  if (channel) return channel;
  const port = openSharedEngineControlPort();
  if (!port) return null;
  const ch: ControlChannel = { port, listeners: new Map(), latest: new Map() };
  port.addEventListener('message', (ev: MessageEvent) => {
    if (!isWorkerFeedPush(ev.data)) return;
    const state = ev.data.state;
    ch.latest.set(state.tableName, state);
    for (const cb of ch.listeners.get(state.tableName) ?? []) cb(state);
  });

  const beat = setInterval(() => {
    try { port.postMessage({ cmd: 'feed:ping' }); } catch { clearInterval(beat); }
  }, FEED_HEARTBEAT_MS);
  (beat as unknown as { unref?: () => void }).unref?.();

  // The worker cannot tell a closed tab from a quiet one for up to five
  // minutes, and until it does the feed keeps a broker connection open. Say
  // so explicitly on the way out — `pagehide` rather than `beforeunload`
  // because it fires where `beforeunload` does not (mobile, tab discard),
  // and `persisted` distinguishes a page that is really leaving from one
  // entering bfcache, which can come back and still wants its feed.
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', (ev) => {
      if ((ev as PageTransitionEvent).persisted) return;
      for (const tableName of ch.listeners.keys()) {
        try { port.postMessage({ cmd: 'feed:release', tableName }); } catch { /* gone */ }
      }
    });
  }
  channel = ch;
  return ch;
}

/**
 * Whether this page can hand its feed to the worker.
 *
 * Three things have to hold, and a `false` from any of them is a normal
 * state rather than an error: no shared worker at all (dedicated fallback,
 * or a browser without `SharedWorker`), or a deployed worker that predates
 * the `feed:*` commands. That last one is the reason this check exists —
 * unknown commands have always been ignored silently, so asking a protocol-1
 * worker for a feed would leave a blotter waiting for a snapshot that is
 * never going to arrive. The caller feeds from the main thread instead.
 */
export function canUseWorkerFeed(): boolean {
  if (typeof SharedWorker === 'undefined') return false;
  const { deployed } = getSharedEngineProtocol();
  return deployed !== null && deployed >= WORKER_FEED_PROTOCOL;
}

export interface WorkerFeedHandle {
  readonly tableName: string;
  /** Last state the worker pushed, or the one `start` returned. */
  state(): WorkerFeedState | null;
  /** Diagnostics Stop — takes effect for EVERY tab, because there is one
   *  feed. That is what `feedBroadcast.ts` was emulating. */
  stop(): Promise<WorkerFeedState | null>;
  restart(): Promise<WorkerFeedState | null>;
  /** This page no longer needs the feed. The last release stops it. */
  release(): void;
}

let nextRequestId = 1;

function request<T>(
  ch: ControlChannel,
  message: Record<string, unknown>,
  match: (data: Record<string, unknown>) => T | undefined,
): Promise<T> {
  const id = nextRequestId++;
  return withTimeout(new Promise<T>((resolve) => {
    const onMessage = (ev: MessageEvent): void => {
      const d = ev.data as Record<string, unknown>;
      if (d instanceof ArrayBuffer || d?.id !== id) return;
      const hit = match(d);
      if (hit === undefined) return;
      ch.port.removeEventListener('message', onMessage);
      resolve(hit);
    };
    ch.port.addEventListener('message', onMessage);
    ch.port.postMessage({ ...message, id });
  }), FEED_REQUEST_TIMEOUT_MS, `Perspective ${String(message.cmd)}`);
}

/**
 * Ask the worker to feed `config.tableName`, or join the feed already
 * running for it.
 *
 * Joining is the whole point and is why no election survives: the second
 * caller does not wait, does not race and does not open a second broker
 * connection — it gets the running feed's state back and starts hearing
 * pushes. If the book is already loaded, that state says so immediately.
 *
 * Throws when the worker declines (no engine yet, bad config, a client it
 * could not build). The caller is expected to fall back to a main-thread
 * feed rather than treat it as fatal.
 */
export async function startWorkerFeed(
  config: WorkerFeedConfig,
  onState?: (state: WorkerFeedState) => void,
): Promise<WorkerFeedHandle> {
  const ch = ensureChannel();
  if (!ch) throw new Error('[perspective] no shared worker to feed from');

  if (onState) {
    let set = ch.listeners.get(config.tableName);
    if (!set) {
      set = new Set();
      ch.listeners.set(config.tableName, set);
    }
    set.add(onState);
  }

  const state = await request<WorkerFeedState>(ch, { cmd: 'feed:start', config }, (d) => {
    if (d.ok === true) return d.state as WorkerFeedState;
    if (d.ok === false) throw new Error(String(d.error));
    return undefined;
  });
  ch.latest.set(config.tableName, state);
  onState?.(state);

  const control = async (cmd: 'feed:stop' | 'feed:restart'): Promise<WorkerFeedState | null> => {
    const next = await request<WorkerFeedState | null>(
      ch, { cmd, tableName: config.tableName },
      (d) => (d.ok === true ? d.state as WorkerFeedState : d.ok === false ? null : undefined),
    );
    if (next) ch.latest.set(config.tableName, next);
    return next;
  };

  return {
    tableName: config.tableName,
    state: () => ch.latest.get(config.tableName) ?? null,
    stop: () => control('feed:stop'),
    restart: () => control('feed:restart'),
    release: () => {
      if (onState) ch.listeners.get(config.tableName)?.delete(onState);
      try { ch.port.postMessage({ cmd: 'feed:release', tableName: config.tableName }); }
      catch { /* port already gone */ }
    },
  };
}

/** Test-only — drop the module-level control port between cases. */
export function __resetWorkerFeedClientForTests(): void {
  try { channel?.port.close(); } catch { /* already closed */ }
  channel = null;
}
