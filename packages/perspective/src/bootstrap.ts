/**
 * Phase 1 — Perspective WASM client bootstrap.
 * Phase 5 — SharedWorker hosting: the engine lives in a per-origin
 * SharedWorker (`sharedServer.worker.ts`, one session per tab), so every
 * tab shares ONE table + ONE feed. Dedicated-Worker fallback when
 * SharedWorker is unavailable, fails to init, or `?worker=dedicated`.
 * One Client → one indexed Table → N Views (one per blotter).
 */

/// <reference path="./vite-env.d.ts" />

import perspective from '@perspective-dev/client';
import type { Client, Table, View } from '@perspective-dev/client';
import type { SharedEngineStats } from './sharedServer.worker';

// Vite URL imports — served as static assets with correct MIME.
import clientWasmUrl from '@perspective-dev/client/dist/wasm/perspective-js.wasm?url';
import serverWasmUrl from '@perspective-dev/server/dist/wasm/perspective-server.wasm?url';

export const POSITION_SCHEMA = {
  positionId: 'string',
  ticker: 'string',
  desk: 'string',
  region: 'string',
  instrumentType: 'string',
  notionalAmount: 'float',
  marketValue: 'float',
  pnl: 'float',
  dailyPnl: 'float',
} as const;

export type PositionRow = {
  positionId: string;
  ticker?: string;
  desk?: string;
  region?: string;
  instrumentType?: string;
  notionalAmount?: number;
  marketValue?: number;
  pnl?: number;
  dailyPnl?: number;
  [key: string]: unknown;
};

export type PerspectiveWorkerMode = 'shared' | 'dedicated';

/** Fixed cross-tab table name — every tab opens (or creates) this one. */
export const SHARED_TABLE_NAME = 'positions-shared';

let initPromise: Promise<Client> | null = null;
let client: Client | null = null;
let workerMode: PerspectiveWorkerMode = 'dedicated';

/** Default SharedWorker name. Part of the worker's identity, alongside its
 *  script URL — see {@link configurePerspectiveSharedWorker}. */
const DEFAULT_SHARED_WORKER_NAME = 'cgrid-ssrm-perspective';

export interface PerspectiveSharedWorkerOptions {
  /**
   * URL of the DEPLOYED shared-worker script, absolute or root-relative
   * (`/vendor/velocity-grid/perspective-shared-worker.js`). Resolved against
   * the document, and must be same-origin.
   *
   * Leave unset and each bundle uses its own copy — correct for a single
   * app, wrong for several sharing one origin (see below).
   */
  url?: string | URL;
  /**
   * SharedWorker instance name. Defaults to `cgrid-ssrm-perspective`.
   *
   * Once `url` is a deployed constant every app agrees on, THIS is the axis
   * that decides which engine an app joins: same origin + same name ⇒ same
   * engine. Leave it alone to put every blotter on the origin's one engine
   * (the usual intent — one engine hosts many providers' tables, each keyed
   * by `providerId` + schema). Set it to deliberately partition, e.g. to
   * keep a heavyweight book off the engine everything else shares.
   */
  name?: string;
  /**
   * Refuse to run on anything but the configured shared engine.
   *
   * Both fallbacks below are silent by design, and silence is the wrong
   * default once several apps share an origin: everything still works, just
   * with N engines, N copies of each table and N feeds — plus the
   * origin-scoped feed lock making all but one of them wait out a 30s
   * snapshot timeout. `strict` turns each into a thrown error at
   * `getPerspectiveClient()`:
   *
   *   - no `url` configured, so this app would use its own bundled copy and
   *     could never share with another app;
   *   - the SharedWorker failed to start, so this app would fall back to a
   *     dedicated worker and share with nothing at all.
   */
  strict?: boolean;
}

let sharedWorkerOptions: PerspectiveSharedWorkerOptions = {};

/**
 * Point every app on an origin at ONE Perspective engine.
 *
 * The target to aim for is **(origin, instance name)** with `bundled: false`
 * — an app joins the engine named `name` on its origin, and nothing else
 * enters into it. Getting there takes one deployment step, because the
 * browser's own rule is stricter than that.
 *
 * A SharedWorker's identity is `(origin, script URL, name)` — all three, and
 * the URL cannot be opted out of. Left unconfigured it is whatever the
 * bundler emitted for THIS app's copy of `sharedServer.worker.ts`, a
 * content-hashed asset path: so two apps built separately land on two
 * different URLs and get two engines, two copies of every table and two
 * feeds, even on one origin with one `providerId`. (Tabs of a single app
 * share for free — they load the same bundle. It is only several apps that
 * need a decision.)
 *
 * Deploy the script ONCE per origin and name that path from every app, and
 * the URL stops varying — it is the same constant everywhere, so the only
 * axis left is the name, which is the intended model:
 *
 * ```ts
 * // build: npm run build:shared-worker -w @wellsfargo-starui/velocity-grid-perspective
 * configurePerspectiveSharedWorker({
 *   url: '/vendor/velocity-grid/psp-shared-worker.js',
 *   name: 'positions-engine',   // (origin, name) now decides sharing
 *   strict: true,               // and a silent fallback is an error
 * });
 * ```
 *
 * Init-only: the engine is created once and its identity cannot change under
 * it, so a call after the client exists warns and is ignored.
 */
export function configurePerspectiveSharedWorker(opts: PerspectiveSharedWorkerOptions): void {
  if (initPromise !== null) {
    console.warn(
      '[perspective] configurePerspectiveSharedWorker() ignored — the client is already '
      + 'initialising. Call it before the first getPerspectiveClient().',
    );
    return;
  }
  sharedWorkerOptions = { ...sharedWorkerOptions, ...opts };
}

/** Test-only — clear the module-level engine configuration between cases.
 *  The engine is a per-page singleton by design, so there is no production
 *  reason to reset it; unit tests need each case to start from the default. */
export function __resetSharedWorkerConfigForTests(): void {
  sharedWorkerOptions = {};
  negotiatedProtocol = null;
  initPromise = null;
  client = null;
  workerMode = 'dedicated';
}

export interface PerspectiveSharedWorkerTarget {
  /**
   * Configured script URL, or `null` when this app is using its own bundled
   * copy. Deliberately not a URL in the bundled case: the bundler substitutes
   * a content-hashed path at build time that nothing here can read back, and
   * reporting the pre-substitution one would be a URL the engine never runs —
   * two apps could compare equal strings and conclude they share when they
   * do not.
   */
  url: string | null;
  name: string;
  /**
   * `true` when the script is this app's own bundled copy, which is shared
   * only with tabs of the SAME build — never with another app on the origin,
   * whatever its `providerId`. That is the actionable answer to "will these
   * two apps share an engine?", and it is `false` only once every one of them
   * has been pointed at one deployed script via
   * {@link configurePerspectiveSharedWorker}.
   */
  bundled: boolean;
}

/** What this page's engine is keyed on. Two apps meant to share one engine
 *  must report the same `url` AND `name`, with `bundled: false`. */
export function getPerspectiveSharedWorkerTarget(): PerspectiveSharedWorkerTarget {
  const name = sharedWorkerOptions.name ?? DEFAULT_SHARED_WORKER_NAME;
  if (sharedWorkerOptions.url == null) return { url: null, name, bundled: true };
  const base = typeof location !== 'undefined' ? location.href : undefined;
  return { url: new URL(sharedWorkerOptions.url, base).href, name, bundled: false };
}

/**
 * Construct the engine's SharedWorker.
 *
 * The default branch keeps `new URL('./sharedServer.worker.ts',
 * import.meta.url)` LITERAL and INLINE in the constructor, which is not
 * stylistic: that exact shape is what a bundler pattern-matches to compile
 * the file as a worker and bundle its imports. Hand it a URL computed
 * elsewhere and Vite falls back to generic asset handling — it emits the
 * bare `.ts` source (14 KB, its `@perspective-dev/server` import unresolved,
 * and an extension most servers do not serve as JavaScript) instead of a
 * 3 MB self-contained worker. Dev servers hide this; production builds do
 * not. Verified by `packages/perspective/tests/sharedWorkerBundling.test.ts`.
 */
function newSharedEngineWorker(): SharedWorker {
  const name = sharedWorkerOptions.name ?? DEFAULT_SHARED_WORKER_NAME;
  if (sharedWorkerOptions.url != null) {
    return new SharedWorker(
      new URL(sharedWorkerOptions.url, location.href),
      { name, type: 'module' },
    );
  }
  return new SharedWorker(
    new URL('./sharedServer.worker.ts', import.meta.url),
    { name, type: 'module' },
  );
}

/**
 * A second port to the engine's SharedWorker, for traffic that is not the
 * Perspective protobuf protocol — engine stats, and feed control.
 *
 * Deliberately not the client's port: that one's message handler forwards
 * everything it receives into the WASM client, so anything else on it is at
 * best tolerated. A control port never sends `{ cmd: 'init' }`, so it creates
 * no engine session and does not skew `SharedEngineStats.sessions`.
 *
 * Uses the SAME constructor the client does, so a control port always lands
 * on the engine this page is actually talking to rather than a second one.
 * `null` when there is no shared worker to reach.
 */
export function openSharedEngineControlPort(): MessagePort | null {
  if (typeof SharedWorker === 'undefined') return null;
  try {
    const port = newSharedEngineWorker().port;
    port.start();
    return port;
  } catch {
    return null;
  }
}

/**
 * Absolute URL of the Perspective client wasm this build fetched.
 *
 * The worker needs it to build a `Client` of its own (see
 * `workerFeedHost.ts`), and cannot derive it: a worker deployed once per
 * origin has no idea where any particular app's hashed assets live. Absolute
 * so it resolves the same from a worker with a different base path.
 */
export function getPerspectiveClientWasmUrl(): string {
  const base = typeof location !== 'undefined' ? location.href : undefined;
  return new URL(clientWasmUrl, base).href;
}

/** Resolved AFTER `getPerspectiveClient()` settles. */
export function getPerspectiveWorkerMode(): PerspectiveWorkerMode {
  return workerMode;
}

function wantSharedWorker(): boolean {
  if (typeof SharedWorker === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('worker') !== 'dedicated';
  } catch {
    return true;
  }
}

/** A hung SharedWorker (script 404, engine crash mid-init) never rejects —
 *  the init handshake just stalls. Race it so boot degrades to dedicated.
 *  Exported: also used to bound `provider.ready()` in `controller.ts`. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Tell the shared engine to drop this page's session when the page goes away.
 *
 * The engine lives in a per-ORIGIN SharedWorker that outlives every page
 * talking to it, and a session it still believes is connected keeps
 * everything that session owns — views, their materialised state, their
 * update subscriptions. Nothing reclaims that on its own:
 *
 *   - Perspective's browser client never sends a close and never listens for
 *     unload (checked in `@perspective-dev/client`: no `pagehide`,
 *     `beforeunload` or `close` anywhere in the browser bundle).
 *   - The MessagePort `close` event the worker also listens for is recent and
 *     not dependable.
 *   - The page's own teardown is async (`view.delete()` is a round-trip to
 *     the worker) and a unloading document does not stay alive for it.
 *
 * With ONE tab this was invisible: the last disconnect kills the SharedWorker
 * and takes the whole engine with it. With two or more, the worker survives
 * every reload and the sessions pile up — which is the reported crash.
 *
 * `pagehide` rather than `beforeunload`: it fires in cases `beforeunload`
 * does not (mobile, tab discard), and `persisted` distinguishes a page that
 * is really going away from one entering bfcache — a bfcached page can come
 * back and must keep its session.
 */
function armSessionRelease(port: MessagePort): void {
  if (typeof addEventListener !== 'function') return;
  addEventListener('pagehide', (ev) => {
    if ((ev as PageTransitionEvent).persisted) return;
    // Synchronous and one-way: no reply to wait for, so it lands even though
    // the document is on its way out.
    try { port.postMessage({ cmd: 'close' }); } catch { /* already torn down */ }
  });
}

/** Heartbeat period. Comfortably inside the worker's idle timeout even when
 *  a hidden tab's timers are throttled to roughly one per minute. */
const SESSION_HEARTBEAT_MS = 45_000;

/**
 * Wire-protocol version this build speaks. Must match
 * `sharedServer.worker.ts`'s constant; the two are exchanged on `hello` and
 * a difference is reported rather than assumed away.
 */
export const SHARED_ENGINE_PROTOCOL = 2;

/** Protocol the deployed worker reported, or `null` when it never answered
 *  (a pre-`hello` worker) or no shared engine is in use. */
let negotiatedProtocol: number | null = null;

/** What the deployed worker turned out to be. `null` protocol means an older
 *  worker that does not answer `hello`. */
export function getSharedEngineProtocol(): { expected: number; deployed: number | null } {
  return { expected: SHARED_ENGINE_PROTOCOL, deployed: negotiatedProtocol };
}

/**
 * Announce this build to the deployed worker and learn what it speaks.
 *
 * The worker script is deployed ONCE PER ORIGIN while the apps that use it
 * ship on their own cycles, so an older page against a newer worker (or the
 * reverse) is a normal rollout state, not an error case. The exchange makes
 * that state visible and, more importantly, safe:
 *
 *   - `hello` doubles as the heartbeat opt-in. The worker only reaps idle
 *     sessions belonging to clients that sent it — so a pre-`hello` page,
 *     which goes quiet when idle and always did, is never mistaken for a
 *     dead one and killed mid-session.
 *   - Heartbeats start only once the worker has confirmed it understands
 *     them. Beating at a worker that ignores pings would be pointless
 *     traffic, and would say nothing about whether the reaper can see us.
 *
 * A worker that never answers is pre-protocol-1: we keep working against it,
 * without heartbeats, and say so once.
 */
async function handshakeSharedEngine(port: MessagePort): Promise<void> {
  const id = 1_000_000_000 + Math.floor(Math.random() * 1e9);
  let deployed: number | null = null;
  try {
    deployed = await withTimeout(new Promise<number>((resolve) => {
      const onMessage = (ev: MessageEvent): void => {
        const d = ev.data as { id?: number; protocol?: number } | ArrayBuffer;
        if (d instanceof ArrayBuffer) return;   // Perspective's own traffic
        if (d?.id !== id || typeof d.protocol !== 'number') return;
        port.removeEventListener('message', onMessage);
        resolve(d.protocol);
      };
      port.addEventListener('message', onMessage);
      port.postMessage({ cmd: 'hello', id, protocol: SHARED_ENGINE_PROTOCOL });
    }), 5_000, 'Perspective shared-engine hello');
  } catch {
    deployed = null;
  }
  negotiatedProtocol = deployed;

  if (deployed === null) {
    console.warn(
      '[perspective] the deployed shared worker predates the '
      + `\`hello\` handshake (this build speaks protocol ${SHARED_ENGINE_PROTOCOL}). `
      + 'Running without heartbeats: a crashed tab will strand its session until the '
      + 'last tab on this origin closes. Redeploy perspective-shared-worker.js to clear it.',
    );
    return;
  }
  if (deployed !== SHARED_ENGINE_PROTOCOL) {
    console.warn(
      `[perspective] shared-engine protocol mismatch: this build speaks ${SHARED_ENGINE_PROTOCOL}, `
      + `the deployed worker speaks ${deployed}. This is a rollout in progress; pin the worker to a `
      + 'versioned path if the two must not meet.',
    );
  }
  // Only now — the worker has told us it understands pings, so a beat means
  // something to the reaper.
  const beat = setInterval(() => {
    try { port.postMessage({ cmd: 'ping' }); } catch { clearInterval(beat); }
  }, SESSION_HEARTBEAT_MS);
  (beat as unknown as { unref?: () => void }).unref?.();
}

export async function getPerspectiveClient(): Promise<Client> {
  if (client) return client;
  if (!initPromise) {
    initPromise = (async () => {
      // `strict` means "a shared engine or nothing" — see the option's doc.
      // Checked FIRST, before the multi-megabyte WASM fetches: a
      // misconfiguration should surface as itself, immediately, not after
      // the expensive part has already run.
      if (sharedWorkerOptions.strict) {
        if (sharedWorkerOptions.url == null) {
          throw new Error(
            '[perspective] strict shared worker: no `url` configured, so this app would use '
            + 'its own bundled copy and could never share an engine with another app on this '
            + 'origin. Deploy the worker script once per origin and pass its path to '
            + 'configurePerspectiveSharedWorker({ url }).',
          );
        }
        if (!wantSharedWorker()) {
          throw new Error(
            '[perspective] strict shared worker: SharedWorker is unavailable in this browser '
            + '(or was disabled with ?worker=dedicated), so no engine can be shared.',
          );
        }
      }
      await perspective.init_server(fetch(serverWasmUrl));
      await perspective.init_client(fetch(clientWasmUrl));
      if (wantSharedWorker()) {
        try {
          const sw = newSharedEngineWorker();
          const c = await withTimeout(
            perspective.worker(Promise.resolve(sw)),
            10_000,
            'Perspective SharedWorker init',
          );
          workerMode = 'shared';
          client = c;
          armSessionRelease(sw.port);
          await handshakeSharedEngine(sw.port);
          return c;
        } catch (err) {
          if (sharedWorkerOptions.strict) {
            throw new Error(
              '[perspective] strict shared worker: the shared engine failed to start, and '
              + 'falling back to a dedicated worker would silently give this app an engine of '
              + `its own. Cause: ${err instanceof Error ? err.message : String(err)}`,
              { cause: err },
            );
          }
          console.warn('[perspective] SharedWorker unavailable — dedicated fallback:', err);
        }
      }
      const c = await perspective.worker();
      workerMode = 'dedicated';
      client = c;
      return c;
    })();
  }
  return initPromise;
}

export type PerspectiveColumnType = 'string' | 'float' | 'boolean' | 'date' | 'integer';
export type PerspectiveTableSchema = Record<string, PerspectiveColumnType | string>;

/**
 * Stable table name so different DataProvider schemas don't collide.
 *
 * `identity` (C-M6) folds provider/connection identity — catalog
 * `providerId`, or `websocketUrl` + `listenerTopic`/`clientId` — into the
 * name so two providers with identical `columnDefinitions` but different
 * brokers never resolve to the same physical Perspective table (cross-tab
 * or same-tab). Omitted only for the no-catalog seed/demo case, which keeps
 * the historical fixed `positions-shared` name when the schema also
 * matches the curated default shape.
 */
export function tableNameForSchema(
  schema: PerspectiveTableSchema,
  identity?: string,
  base = SHARED_TABLE_NAME,
): string {
  const keys = Object.keys(schema).sort();
  const defaultKeys = Object.keys(POSITION_SCHEMA).sort();
  const sameShape = keys.length === defaultKeys.length
    && keys.every((k, i) => k === defaultKeys[i] && schema[k] === POSITION_SCHEMA[k as keyof typeof POSITION_SCHEMA]);
  if (sameShape && !identity) return base;
  let h = 2166136261;
  const fold = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  for (const k of keys) {
    fold(k);
    fold(String(schema[k] ?? ''));
  }
  if (identity) fold(identity);
  return `${base}-${(h >>> 0).toString(16)}`;
}

export async function createPositionsTable(
  name = 'positions',
  schema: PerspectiveTableSchema = POSITION_SCHEMA,
  index = 'positionId',
): Promise<Table> {
  const c = await getPerspectiveClient();
  return c.table({ ...schema } as typeof POSITION_SCHEMA, { index, name });
}

/** Phase 5 — attach to the shared table if another tab already hosts it,
 *  else create it. `attached: true` means the snapshot may already be
 *  loaded (or loading) by the tab that created it.
 *  Schema comes from the DataProvider when provided. */
export async function openOrCreatePositionsTable(
  name = SHARED_TABLE_NAME,
  schema: PerspectiveTableSchema = POSITION_SCHEMA,
  identity?: string,
  index = 'positionId',
): Promise<{ table: Table; attached: boolean }> {
  const c = await getPerspectiveClient();
  const tableName = name === SHARED_TABLE_NAME ? tableNameForSchema(schema, identity, name) : name;
  try {
    const names = await c.get_hosted_table_names();
    if (names.includes(tableName)) {
      return { table: await c.open_table(tableName), attached: true };
    }
  } catch { /* older engine without listing — fall through to create */ }
  return {
    table: await c.table(
      { ...schema } as typeof POSITION_SCHEMA,
      { index, name: tableName },
    ),
    attached: false,
  };
}

/**
 * Read the shared engine's WASM heap + live session count.
 *
 * Opens its OWN port to the SharedWorker rather than borrowing the
 * Perspective client's — that port speaks a protobuf protocol and must not
 * carry anything else. A stats port never calls `init`, so it creates no
 * engine session and the number it reports is not skewed by the asking.
 *
 * Returns `null` when the engine is not shared (dedicated-worker fallback,
 * or SharedWorker unavailable) — there is nothing cross-page to measure then.
 */
export async function readSharedEngineStats(
  timeoutMs = 3_000,
): Promise<SharedEngineStats | null> {
  const port = openSharedEngineControlPort();
  if (!port) return null;
  const id = Math.floor(Math.random() * 1e9);
  try {
    return await withTimeout(new Promise<SharedEngineStats>((resolve) => {
      const onMessage = (ev: MessageEvent): void => {
        const d = ev.data as { id?: number; stats?: SharedEngineStats };
        if (d?.id !== id || !d.stats) return;
        port.removeEventListener('message', onMessage);
        resolve(d.stats);
      };
      port.addEventListener('message', onMessage);
      port.start();
      port.postMessage({ cmd: 'stats', id });
    }), timeoutMs, 'Perspective engine stats');
  } catch {
    return null;
  } finally {
    try { port.close(); } catch { /* already gone */ }
  }
}

export type { Client, Table, View };
export type { SharedEngineStats } from './sharedServer.worker';
