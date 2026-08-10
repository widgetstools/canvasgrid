/**
 * Seeded STOMP SSRM provider catalog entry for stomp-view-server (:8082).
 *
 * Broker topics (ssrm-grid apps/stomp-view-server):
 *   listen  /snapshot/positions/TRADER001
 *   trigger /snapshot/positions/TRADER001/{rate}/{batchSize}
 *   end     body contains "Success" (case-insensitive)
 */
import type { ColumnDefinition, DataProviderConfig } from '@wellsfargo-starui/velocity-grid-data';

/** Display columns — flat SSRM (hub pages the cache; no sparse tree groups). */
export const STOMP_POSITION_COLUMNS: ColumnDefinition[] = [
  { field: 'positionId', headerName: 'Position', cellDataType: 'text', width: 150, filter: true, sortable: true },
  { field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 130, filter: true, sortable: true },
  { field: 'region', headerName: 'Region', cellDataType: 'text', width: 110, filter: true, sortable: true },
  { field: 'currency', headerName: 'CCY', cellDataType: 'text', width: 90, filter: true, sortable: true },
  { field: 'trader', headerName: 'Trader', cellDataType: 'text', width: 120, filter: true, sortable: true },
  { field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 110, filter: true, sortable: true },
  { field: 'notional', headerName: 'Notional', cellDataType: 'number', width: 130, filter: true, sortable: true },
  { field: 'marketValue', headerName: 'Mkt Value', cellDataType: 'number', width: 130, filter: true, sortable: true },
  { field: 'price', headerName: 'Price', cellDataType: 'number', width: 100, filter: true, sortable: true },
  { field: 'pnl', headerName: 'PnL', cellDataType: 'number', width: 120, filter: true, sortable: true },
  { field: 'dailyPnl', headerName: 'Daily PnL', cellDataType: 'number', width: 120, filter: true, sortable: true },
];

const WS_URL = (import.meta.env.VITE_STOMP_URL as string | undefined) ?? 'ws://localhost:8082';
const CLIENT_ID = (import.meta.env.VITE_STOMP_CLIENT_ID as string | undefined) ?? 'TRADER001';
/** Live updates/sec + batch size encoded in the trigger destination. */
const LIVE_RATE = Number(import.meta.env.VITE_STOMP_RATE ?? 1000) || 1000;
const BATCH = Number(import.meta.env.VITE_STOMP_BATCH ?? 200) || 200;
/** Snapshot size requested via `snapshot-rows` header (clamped by the broker). */
const SNAPSHOT_ROWS = Number(import.meta.env.VITE_STOMP_ROWS ?? 20_000) || 20_000;

export const STOMP_SSRM_PROVIDER_ID = 'stomp-ssrm-positions';

export function buildStompSsrmProviderConfig(): DataProviderConfig {
  const listenerTopic = `/snapshot/positions/${CLIENT_ID}`;
  const requestMessage = `/snapshot/positions/${CLIENT_ID}/${LIVE_RATE}/${BATCH}`;
  return {
    providerId: STOMP_SSRM_PROVIDER_ID,
    name: 'STOMP SSRM Positions',
    description:
      `SSRM blotter from stomp-view-server · ${WS_URL} · ${listenerTopic}`,
    providerType: 'stomp',
    rowModel: 'serverSide',
    blockSize: 100,
    public: true,
    config: {
      websocketUrl: WS_URL,
      listenerTopic,
      requestMessage,
      requestBody: '',
      snapshotEndToken: 'Success',
      keyColumn: 'positionId',
      /** Maps to STOMP SEND header `snapshot-rows` when batchSize is set. */
      messageRate: SNAPSHOT_ROWS,
      batchSize: BATCH,
      autoStart: true,
      heartbeat: { outgoing: 4000, incoming: 4000 },
      throttleEnabled: true,
      throttleMs: 100,
      conflateEnabled: true,
      conflateByKey: 'positionId',
      snapshotChunkSize: 500,
      columnDefinitions: STOMP_POSITION_COLUMNS,
    },
  };
}
