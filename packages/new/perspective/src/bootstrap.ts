/**
 * Perspective WASM client bootstrap — SharedWorker (one session per tab)
 * with dedicated-Worker fallback (`?worker=dedicated` or SharedWorker fail).
 */
import perspective from '@perspective-dev/client';
import type { Client, Table, View } from '@perspective-dev/client';

import clientWasmUrl from '@perspective-dev/client/dist/wasm/perspective-js.wasm?url';
import serverWasmUrl from '@perspective-dev/server/dist/wasm/perspective-server.wasm?url';

export {
  POSITION_SCHEMA,
  SHARED_TABLE_NAME,
  tableNameForSchema,
  feedLockNameForSchema,
  type PerspectiveColumnType,
  type PerspectiveTableSchema,
} from './schema';
import {
  POSITION_SCHEMA,
  SHARED_TABLE_NAME,
  tableNameForSchema,
  type PerspectiveTableSchema,
} from './schema';

export type PerspectiveWorkerMode = 'shared' | 'dedicated';

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
            { name: 'vg-new-perspective', type: 'module' },
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
          console.warn('[vg-new-perspective] SharedWorker unavailable — dedicated fallback:', err);
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
  } catch { /* fall through */ }
  return {
    table: await c.table(
      { ...schema } as typeof POSITION_SCHEMA,
      { index: 'positionId', name: tableName },
    ),
    attached: false,
  };
}

/** Test helper — reset singleton between unit tests. */
export function __resetPerspectiveClientForTests(): void {
  initPromise = null;
  client = null;
  workerMode = 'dedicated';
}

export type { Client, Table, View };
