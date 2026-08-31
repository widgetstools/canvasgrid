/**
 * Seed catalog entries for the two provider demos.
 *
 * Both apps share ONE catalog (`LocalStorageConfigBackend` over the same
 * `LocalStore`), so a provider authored in either app's editor is immediately
 * visible in the other. The only thing that differs is `rowModel`, which is
 * what routes a config to the CSRM hub or to Perspective SSRM.
 *
 * Field shape is copied from the proven STOMP entry the Perspective sample
 * used, so these talk to the repo's stomp-view-server fixture out of the box
 * (`npm run dev:stomp`, ws://localhost:8082).
 */
import type { ColumnDefinition, DataProviderConfig } from '@wellsfargo-starui/velocity-grid-data';

const WS_URL = (import.meta.env.VITE_STOMP_URL as string | undefined) ?? 'ws://localhost:8082';
const CLIENT_ID = (import.meta.env.VITE_STOMP_CLIENT_ID as string | undefined) ?? 'TRADER001';
const LIVE_RATE = Number(import.meta.env.VITE_STOMP_RATE ?? 40) || 40;
const BATCH = Number(import.meta.env.VITE_STOMP_BATCH ?? 200) || 200;
const SNAPSHOT_ROWS = Number(import.meta.env.VITE_STOMP_ROWS ?? 10_000) || 10_000;

export const CSRM_PROVIDER_ID = 'demo-csrm-positions';
export const SSRM_PROVIDER_ID = 'demo-ssrm-positions';

/** Bump to re-seed both entries after changing the defaults below. */
export const SEED_VERSION = 1;

/**
 * The DataProvider editor's Columns tab is the source of truth for the grid's
 * columns in these demos — the grid builds its colDefs from whatever is saved
 * here, so editing a header or width in the editor is visible on Apply.
 */
export const DEMO_COLUMNS: ColumnDefinition[] = [
  { field: 'positionId', headerName: 'Position', cellDataType: 'text', width: 150, filter: true, sortable: true },
  { field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 110, filter: true, sortable: true },
  { field: 'desk', headerName: 'Desk', cellDataType: 'text', width: 150, filter: true, sortable: true },
  { field: 'region', headerName: 'Region', cellDataType: 'text', width: 110, filter: true, sortable: true },
  { field: 'instrumentType', headerName: 'Instrument', cellDataType: 'text', width: 130, filter: true, sortable: true },
  { field: 'notionalAmount', headerName: 'Notional', cellDataType: 'number', width: 140, filter: true, sortable: true },
  { field: 'marketValue', headerName: 'Mkt Value', cellDataType: 'number', width: 140, filter: true, sortable: true },
  { field: 'pnl', headerName: 'P&L', cellDataType: 'number', width: 120, filter: true, sortable: true },
  { field: 'dailyPnl', headerName: 'Daily P&L', cellDataType: 'number', width: 120, filter: true, sortable: true },
];

function stompConfig(): Record<string, unknown> {
  return {
    websocketUrl: WS_URL,
    listenerTopic: `/snapshot/positions/${CLIENT_ID}`,
    requestMessage: `/snapshot/positions/${CLIENT_ID}/${LIVE_RATE}/${BATCH}`,
    requestBody: '',
    snapshotEndToken: 'Success',
    keyColumn: 'positionId',
    messageRate: SNAPSHOT_ROWS,
    batchSize: BATCH,
    rate: LIVE_RATE,
    snapshotRows: SNAPSHOT_ROWS,
    autoStart: true,
    heartbeat: { outgoing: 4000, incoming: 4000 },
    // Hub-side pipeline knobs. The grid applies its own asyncTransaction*
    // throttling on top — two independent stages, see the CSRM app's notes.
    throttleEnabled: true,
    throttleMs: 100,
    conflateEnabled: true,
    conflateByKey: 'positionId',
    snapshotChunkSize: 500,
    columnDefinitions: DEMO_COLUMNS,
    _seedVersion: SEED_VERSION,
  };
}

/** CSRM: the hub streams the whole book to the grid's client-side store. */
export function buildCsrmProviderConfig(): DataProviderConfig {
  return {
    providerId: CSRM_PROVIDER_ID,
    name: 'Positions (client-side)',
    description: `Hub → clientSideDataProvider · ${WS_URL}`,
    providerType: 'stomp',
    rowModel: 'clientSide',
    public: true,
    config: { ...stompConfig(), label: 'CSRM Positions', feed: 'stomp' },
  };
}

/** SSRM: the same feed, but Perspective owns the book and serves windows. */
export function buildSsrmProviderConfig(): DataProviderConfig {
  return {
    providerId: SSRM_PROVIDER_ID,
    name: 'Positions (server-side)',
    description: `StompPerspectiveProvider SSRM · ${WS_URL}`,
    providerType: 'stomp',
    rowModel: 'serverSide',
    blockSize: 100,
    public: true,
    config: { ...stompConfig(), label: 'SSRM Positions', feed: 'stomp' },
  };
}

/**
 * Write a seed entry if absent (or if its `_seedVersion` is stale), then
 * return the catalog's current copy. Never clobbers user edits made in the
 * editor — that is the whole point of seeding by version.
 */
export async function ensureSeeded(
  catalog: {
    list(): Promise<DataProviderConfig[]>;
    save(cfg: DataProviderConfig): Promise<unknown>;
  },
  seed: DataProviderConfig,
): Promise<DataProviderConfig> {
  const existing = (await catalog.list()).find((c) => c.providerId === seed.providerId);
  const seededVersion = existing?.config?._seedVersion;
  if (existing && seededVersion === SEED_VERSION) return existing;
  await catalog.save(seed);
  return seed;
}
