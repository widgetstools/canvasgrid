/**
 * Seeded STOMP catalog entry for StompPerspectiveProvider (authored in the
 * real DataProvider editor; Apply maps fields → Perspective SSRM).
 */
import type { ColumnDefinition, DataProviderConfig } from '@wellsfargo-starui/velocity-grid-data';
import { POSITION_COLUMNS } from '@wellsfargo-starui/velocity-grid-perspective';

const WS_URL = (import.meta.env.VITE_STOMP_URL as string | undefined) ?? 'ws://localhost:8082';
const CLIENT_ID = (import.meta.env.VITE_STOMP_CLIENT_ID as string | undefined) ?? 'TRADER001';
const LIVE_RATE = Number(import.meta.env.VITE_STOMP_RATE ?? 40) || 40;
const BATCH = Number(import.meta.env.VITE_STOMP_BATCH ?? 200) || 200;
const SNAPSHOT_ROWS = Number(import.meta.env.VITE_STOMP_ROWS ?? 10_000) || 10_000;

export const PERSPECTIVE_SSRM_PROVIDER_ID = 'perspective-ssrm-positions';

/** Bump when sample seed defaults change (forces catalog refresh of those keys). */
export const PERSPECTIVE_SSRM_SEED_VERSION = 4;

/** Default DataProvider Columns tab — Apply pushes these onto the grid + table. */
const EDITOR_COLUMNS: ColumnDefinition[] = POSITION_COLUMNS.map((c) => ({
  field: String(c.field ?? c.colId ?? ''),
  headerName: String(c.headerName ?? c.field ?? ''),
  cellDataType: (c.cellDataType as ColumnDefinition['cellDataType']) ?? 'text',
  width: typeof c.width === 'number' ? c.width : undefined,
  filter: true,
  sortable: true,
}));

export function buildPerspectiveSsrmProviderConfig(): DataProviderConfig {
  const listenerTopic = `/snapshot/positions/${CLIENT_ID}`;
  const requestMessage = `/snapshot/positions/${CLIENT_ID}/${LIVE_RATE}/${BATCH}`;
  return {
    providerId: PERSPECTIVE_SSRM_PROVIDER_ID,
    name: 'Perspective SSRM Positions',
    description:
      `StompPerspectiveProvider SSRM · ${WS_URL} · ${listenerTopic}`,
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
      messageRate: SNAPSHOT_ROWS,
      batchSize: BATCH,
      rate: LIVE_RATE,
      snapshotRows: SNAPSHOT_ROWS,
      feed: 'stomp',
      label: 'Perspective SSRM',
      autoStart: true,
      heartbeat: { outgoing: 4000, incoming: 4000 },
      throttleEnabled: true,
      throttleMs: 100,
      conflateEnabled: true,
      conflateByKey: 'positionId',
      snapshotChunkSize: 500,
      columnDefinitions: EDITOR_COLUMNS,
      _pspSeedVersion: PERSPECTIVE_SSRM_SEED_VERSION,
    },
  };
}
