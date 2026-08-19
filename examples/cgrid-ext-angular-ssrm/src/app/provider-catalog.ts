/**
 * Programmatic SSRM DataProvider catalog entry.
 *
 * String fields use AppData tokens (`{{runtime.*}}`) resolved via
 * `resolveProviderConfig` before persisting to the shared ConfigBackend.
 */
import type { ColumnDefinition, DataProviderConfig } from '@wellsfargo-starui/velocity-grid-data';
import { POSITION_COLUMNS } from '@wellsfargo-starui/velocity-grid-perspective';

export const SSRM_PROVIDER_ID = 'angular-ssrm-seed-positions';

/** Bump when seed defaults change. */
export const SSRM_PROVIDER_SEED_VERSION = 1;

const EDITOR_COLUMNS: ColumnDefinition[] = POSITION_COLUMNS.map((c) => ({
  field: String(c.field ?? c.colId ?? ''),
  headerName: String(c.headerName ?? c.field ?? ''),
  cellDataType: (c.cellDataType as ColumnDefinition['cellDataType']) ?? 'text',
  width: typeof c.width === 'number' ? c.width : undefined,
  filter: true,
  sortable: true,
}));

/** Template config — resolve with AppData before `catalog.save`. */
export function buildSsrmProviderTemplate(): DataProviderConfig {
  return {
    providerId: SSRM_PROVIDER_ID,
    name: '{{runtime.providerName}}',
    description: 'Angular SSRM example · seed book · AppData-driven snapshot size',
    providerType: 'stomp',
    rowModel: 'serverSide',
    blockSize: 100,
    public: true,
    config: {
      feed: 'seed',
      keyColumn: 'positionId',
      label: '{{runtime.label}}',
      snapshotRows: '{{runtime.snapshotRows}}',
      rate: '{{runtime.tickRate}}',
      batchSize: 200,
      columnDefinitions: EDITOR_COLUMNS,
      _seedVersion: SSRM_PROVIDER_SEED_VERSION,
    },
  };
}
