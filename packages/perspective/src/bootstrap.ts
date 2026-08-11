/**
 * Phase 1 — Perspective WASM client bootstrap.
 * Phase 5 — SharedWorker hosting: the engine lives in a per-origin
 * SharedWorker (`sharedServer.worker.ts`, one session per tab), so every
 * tab shares ONE table + ONE feed. Dedicated-Worker fallback when
 * SharedWorker is unavailable, fails to init, or `?worker=dedicated`.
 * One Client → one indexed Table → N Views (one per blotter).
 */

import perspective from '@perspective-dev/client';
import type { Client, Table, View } from '@perspective-dev/client';

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
 *  the init handshake just stalls. Race it so boot degrades to dedicated. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

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

/** Stable table name so different DataProvider schemas don't collide. */
export function tableNameForSchema(
  schema: PerspectiveTableSchema,
  base = SHARED_TABLE_NAME,
): string {
  const keys = Object.keys(schema).sort();
  const defaultKeys = Object.keys(POSITION_SCHEMA).sort();
  const sameShape = keys.length === defaultKeys.length
    && keys.every((k, i) => k === defaultKeys[i] && schema[k] === POSITION_SCHEMA[k as keyof typeof POSITION_SCHEMA]);
  if (sameShape) return base;
  let h = 2166136261;
  for (const k of keys) {
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
    const t = String(schema[k] ?? '');
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  }
  return `${base}-${(h >>> 0).toString(16)}`;
}

export async function createPositionsTable(
  name = 'positions',
  schema: PerspectiveTableSchema = POSITION_SCHEMA,
): Promise<Table> {
  const c = await getPerspectiveClient();
  return c.table({ ...schema } as typeof POSITION_SCHEMA, { index: 'positionId', name });
}

/** Phase 5 — attach to the shared table if another tab already hosts it,
 *  else create it. `attached: true` means the snapshot may already be
 *  loaded (or loading) by the tab that created it.
 *  Schema comes from the DataProvider when provided. */
export async function openOrCreatePositionsTable(
  name = SHARED_TABLE_NAME,
  schema: PerspectiveTableSchema = POSITION_SCHEMA,
): Promise<{ table: Table; attached: boolean }> {
  const c = await getPerspectiveClient();
  const tableName = name === SHARED_TABLE_NAME ? tableNameForSchema(schema, name) : name;
  try {
    const names = await c.get_hosted_table_names();
    if (names.includes(tableName)) {
      return { table: await c.open_table(tableName), attached: true };
    }
  } catch { /* older engine without listing — fall through to create */ }
  return {
    table: await c.table(
      { ...schema } as typeof POSITION_SCHEMA,
      { index: 'positionId', name: tableName },
    ),
    attached: false,
  };
}

export type { Client, Table, View };
