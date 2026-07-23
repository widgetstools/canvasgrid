/**
 * Phase 1 — Perspective WASM client bootstrap.
 *
 * Dedicated Worker via `perspective.worker()` (SharedWorker lands in Phase 5).
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

let initPromise: Promise<Client> | null = null;
let client: Client | null = null;

export async function getPerspectiveClient(): Promise<Client> {
  if (client) return client;
  if (!initPromise) {
    initPromise = (async () => {
      await perspective.init_server(fetch(serverWasmUrl));
      await perspective.init_client(fetch(clientWasmUrl));
      const c = await perspective.worker();
      client = c;
      return c;
    })();
  }
  return initPromise;
}

export async function createPositionsTable(name = 'positions'): Promise<Table> {
  const c = await getPerspectiveClient();
  return c.table({ ...POSITION_SCHEMA }, { index: 'positionId', name });
}

export type { Client, Table, View };
