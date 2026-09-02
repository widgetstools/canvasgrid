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
  // Heartbeat for the worker's reaper — the backstop for the one case
  // `pagehide` cannot cover, a renderer that crashed or was discarded without
  // running any script. An open blotter can be silent for minutes, so
  // silence alone must never be read as death; this is what makes it
  // distinguishable. One postMessage per beat, no reply.
  const beat = setInterval(() => {
    try { port.postMessage({ cmd: 'ping' }); } catch { clearInterval(beat); }
  }, SESSION_HEARTBEAT_MS);
  // Never hold the page open on this timer's account.
  (beat as unknown as { unref?: () => void }).unref?.();
}

/** Heartbeat period. Comfortably inside the worker's idle timeout even when
 *  a hidden tab's timers are throttled to roughly one per minute. */
const SESSION_HEARTBEAT_MS = 45_000;

export async function getPerspectiveClient(): Promise<Client> {
  if (client) return client;
  if (!initPromise) {
    initPromise = (async () => {
      await perspective.init_server(fetch(serverWasmUrl));
      await perspective.init_client(fetch(clientWasmUrl));
      if (wantSharedWorker()) {
        try {
          const sw = new SharedWorker(
            new URL('./sharedServer.worker.ts', import.meta.url),
            { name: 'cgrid-ssrm-perspective', type: 'module' },
          );
          const c = await withTimeout(
            perspective.worker(Promise.resolve(sw)),
            10_000,
            'Perspective SharedWorker init',
          );
          workerMode = 'shared';
          client = c;
          armSessionRelease(sw.port);
          return c;
        } catch (err) {
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
  if (typeof SharedWorker === 'undefined') return null;
  let sw: SharedWorker;
  try {
    sw = new SharedWorker(
      new URL('./sharedServer.worker.ts', import.meta.url),
      { name: 'cgrid-ssrm-perspective', type: 'module' },
    );
  } catch { return null; }
  const port = sw.port;
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
