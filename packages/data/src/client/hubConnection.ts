import type { HubMessage, HubRequest, HubResponse, HubPush } from '../protocol/messages';
import { DataServicesHub } from '../hub/DataServicesHub';

export type HubConnection = {
  post(msg: HubRequest): Promise<HubResponse>;
  onPush(handler: (msg: HubPush) => void): () => void;
  close(): void;
};

/** Default hub instance name. See {@link HubTarget.name}. */
export const DEFAULT_HUB_NAME = 'vg-data-hub';

let inProcessHub: DataServicesHub | null = null;

/**
 * Live SharedWorker connections, keyed by the worker's full identity.
 *
 * One module-global worker was wrong the moment `workerUrl` / `name` became
 * configurable: two calls asking for different hubs would silently both get
 * whichever was constructed first. The key mirrors what the browser itself
 * keys a SharedWorker on, minus the origin (which a page cannot vary).
 */
const workers = new Map<string, PortState>();

type PortState = {
  port: MessagePort;
  pending: Map<string, { resolve: (r: HubResponse) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>;
  pushHandlers: Set<(msg: HubPush) => void>;
  reqSeq: number;
};

function attachPort(port: MessagePort): PortState {
  const state: PortState = {
    port,
    pending: new Map(),
    pushHandlers: new Set(),
    reqSeq: 0,
  };
  port.onmessage = (ev: MessageEvent<HubMessage>) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'push' || data.type === 'status' || data.type === 'rowsReceived') {
      for (const h of state.pushHandlers) h(data);
      return;
    }
    if ('id' in data) {
      const p = state.pending.get(data.id);
      if (p) {
        state.pending.delete(data.id);
        // C-m1: clear the timeout when the response arrives
        if (p.timer !== undefined) clearTimeout(p.timer);
        if (data.type === 'error') p.reject(new Error(data.error));
        else p.resolve(data as HubResponse);
      }
    }
  };
  port.start?.();
  return state;
}

function createConnection(state: PortState): HubConnection {
  const localPush = new Set<(msg: HubPush) => void>();
  const bridge = (msg: HubPush): void => {
    for (const h of localPush) h(msg);
  };
  state.pushHandlers.add(bridge);

  return {
    post(msg: HubRequest): Promise<HubResponse> {
      const id = msg.id || `r${++state.reqSeq}`;
      const full = { ...msg, id, v: 1 as const };
      return new Promise((resolve, reject) => {
        // C-m1: store the timer handle so it can be cleared on response or timeout
        const timer = setTimeout(() => {
          if (state.pending.has(id)) {
            state.pending.delete(id);
            reject(new Error(`Hub request timeout: ${msg.type}`));
          }
        }, 60_000);
        state.pending.set(id, { resolve, reject, timer });
        state.port.postMessage(full);
      });
    },
    onPush(handler) {
      localPush.add(handler);
      return () => { localPush.delete(handler); };
    },
    close() {
      localPush.clear();
      state.pushHandlers.delete(bridge);
    },
  };
}

export interface ConnectHubOptions {
  /**
   * URL of the DEPLOYED hub worker script, absolute or root-relative
   * (`/vendor/velocity-grid/data-hub-worker.js`). Resolved against the
   * document, and must be same-origin.
   *
   * Leave unset and this app uses its own bundled copy — fine for a single
   * app, but two apps on one origin then land on two different
   * content-hashed URLs and get two hubs, two upstream connections and two
   * caches of the same book. See {@link HubTarget.bundled}.
   */
  workerUrl?: URL | string;
  /**
   * Hub instance name — in practice the APP NAME.
   *
   * Once `workerUrl` is a deployed constant every app agrees on, this is the
   * axis that decides which hub a page joins: same origin + same name ⇒ same
   * hub, one upstream connection per `providerId`, one cache. Windows of one
   * app share; different names are deliberately separate hubs.
   *
   * Note that separating by name also separates the CACHE — two names both
   * subscribing to one `providerId` open two upstream connections and hold
   * two copies of that book. Partition on purpose, not by accident.
   */
  name?: string;
  /**
   * Refuse to run on anything but a shared hub.
   *
   * Both fallbacks are otherwise silent: an unset `workerUrl` uses this
   * app's bundled copy (which no other app can join), and a missing
   * `SharedWorker` drops to an in-process hub (which is per-page, so nothing
   * is shared at all — not even between this app's own windows). Under
   * `strict` each throws instead.
   */
  strict?: boolean;
  /** Force the in-process hub — tests, and the SharedWorker-less fallback. */
  inProcess?: boolean;
}

export interface HubTarget {
  /**
   * The full resolved worker URL — app name included, since that is what
   * actually partitions hubs — or `null` when using this app's bundled copy.
   *
   * Null rather than a URL for the bundled case because the bundler
   * substitutes a content-hashed path nothing here can read back, and
   * reporting the pre-substitution one would be a URL the hub never runs:
   * two apps could compare equal strings and conclude they share when they
   * do not.
   */
  url: string | null;
  name: string;
  /** `true` when the script is this app's own bundled copy, which no other
   *  app on the origin can join whatever name it uses. */
  bundled: boolean;
}

/** What a `connectHub(opts)` call would key its hub on. Apps meant to share
 *  one hub must agree on `url` and `name`, with `bundled: false`. */
export function getDataHubTarget(opts?: ConnectHubOptions): HubTarget {
  const name = opts?.name ?? DEFAULT_HUB_NAME;
  if (opts?.workerUrl == null) return { url: null, name, bundled: true };
  return { url: resolveHubUrl(opts.workerUrl, name).href, name, bundled: false };
}

/**
 * Resolve a deployed hub URL with the app name folded in.
 *
 * The app name rides in the URL rather than in the SharedWorker `name`
 * option for a mundane but unavoidable reason: bundlers `eval` the worker
 * options object to decide how to compile the entry, so ANY variable in it
 * makes the options unparseable (see {@link newHubWorker}). A URL is allowed
 * to be dynamic; the options are not.
 *
 * It costs nothing, because a SharedWorker's identity is
 * `(origin, script URL, name)` — folding the name into the URL partitions
 * exactly as putting it in `name` would. `e2e/ssrm-engine-sharing.spec.ts`
 * demonstrates the same mechanism: one script under two URL spellings is two
 * workers.
 */
function resolveHubUrl(workerUrl: string | URL, name: string): URL {
  const url = new URL(workerUrl, typeof location !== 'undefined' ? location.href : undefined);
  url.searchParams.set('app', name);
  return url;
}

/**
 * Build the hub's SharedWorker.
 *
 * Two rules here are load-bearing, and both are about what a BUNDLER can see.
 *
 * 1. The default branch keeps `new URL('../worker.ts', import.meta.url)`
 *    LITERAL and INLINE in the constructor. That exact shape is what Vite
 *    matches to compile the file as a worker and bundle its imports. Assign
 *    it to a variable first — as this function used to — and Vite falls back
 *    to generic asset handling, which for a `.ts` entry means inlining the
 *    RAW TYPESCRIPT as a `data:video/mp2t;base64,…` URL (MIME guessed from
 *    the extension). Browsers refuse it, `new SharedWorker` does not throw
 *    for a bad script, and every request then hangs until the 60s timeout
 *    above. Dev servers hide this completely — they serve and transpile the
 *    source — so it is a production-only, silent failure.
 *
 * 2. The options object is a STATIC LITERAL. Vite `eval`s it to decide the
 *    worker type, and a variable there is not evaluable. Measured on Vite
 *    7.3.6: `vite build` tolerates it and compiles the worker correctly
 *    anyway, but the serve/TEST transform throws ("unable to parse the worker
 *    options as the value is not static"). So unlike (1) this is not a
 *    production failure — it is an import-time failure for anything that
 *    transforms the module, which in `packages/perspective` cost eleven test
 *    suites before it was traced. Keeping the options literal means not
 *    caring which pipeline sees the file. Hence the app name goes in the URL
 *    (see {@link resolveHubUrl}) and never here.
 *
 * The bundled branch takes no name at all, which is honest rather than
 * lossy: a bundled worker is this app's own copy and cannot be joined by
 * another app whatever it is called.
 */
function newHubWorker(opts: ConnectHubOptions | undefined, name: string): SharedWorker {
  if (opts?.workerUrl != null) {
    return new SharedWorker(resolveHubUrl(opts.workerUrl, name), { type: 'module' });
  }
  return new SharedWorker(
    new URL('../worker.ts', import.meta.url),
    { type: 'module' },
  );
}

/**
 * Connect to the SharedWorker hub, or an in-process hub when SharedWorker
 * is unavailable (tests / dedicated fallback).
 *
 * In-process mode: each call gets its own MessagePort into a singleton hub
 * (simulates multi-window fan-out in one page). Nothing is shared beyond the
 * page, so it is a functional fallback, not a hub.
 *
 * SharedWorker mode: one port per browsing context (browser-managed), and
 * one hub per `(origin, workerUrl, name)`.
 */
export function connectHub(opts?: ConnectHubOptions): HubConnection {
  const name = opts?.name ?? DEFAULT_HUB_NAME;
  const noSharedWorker = typeof SharedWorker === 'undefined';

  if (opts?.strict) {
    if (opts.inProcess) {
      throw new Error(
        '[velocity-grid-data] strict hub: `inProcess` was requested, which is a per-page hub '
        + 'that shares nothing — not even between this app\'s own windows.',
      );
    }
    if (opts.workerUrl == null) {
      throw new Error(
        '[velocity-grid-data] strict hub: no `workerUrl` configured, so this app would use its '
        + 'own bundled copy and could never share a hub with another app on this origin. Deploy '
        + 'the hub worker once per origin and pass its path as `workerUrl`.',
      );
    }
    if (noSharedWorker) {
      throw new Error(
        '[velocity-grid-data] strict hub: SharedWorker is unavailable in this browser, so no hub '
        + 'can be shared.',
      );
    }
  }

  if (opts?.inProcess || noSharedWorker) {
    if (!inProcessHub) inProcessHub = new DataServicesHub();
    const channel = new MessageChannel();
    const state = attachPort(channel.port1);
    inProcessHub.addPort(channel.port2);
    return createConnection(state);
  }

  // Key on the worker's own identity, so two differently-configured calls
  // cannot silently share one connection.
  const key = `${opts?.workerUrl == null ? '<bundled>' : String(opts.workerUrl)} ${name}`;
  let state = workers.get(key);
  if (!state) {
    state = attachPort(newHubWorker(opts, name).port);
    workers.set(key, state);
  }
  return createConnection(state);
}

/** Test helper — reset singleton hub/worker. */
export function _resetHubConnectionForTests(): void {
  inProcessHub = null;
  workers.clear();
}
