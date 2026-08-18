/**
 * Map a hub DataProviderConfig onto StompPerspectiveProvider + grid columns.
 * The DataProvider catalog owns columnDefinitions — the grid does not invent them.
 */
import type {
  ColumnDefinition,
  DataProviderConfig,
} from '@wellsfargo-starui/velocity-grid-data';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import type { StompPerspectiveProviderConfig } from './provider';
import { POSITION_SCHEMA, type PositionRow } from './bootstrap';

/** Perspective table schema types we emit from catalog columns. */
export type PerspectiveSchema = Record<string, 'string' | 'float' | 'boolean' | 'date'>;

type StompBag = {
  websocketUrl?: string;
  listenerTopic?: string;
  requestMessage?: string;
  requestBody?: string;
  snapshotEndToken?: string;
  keyColumn?: string | string[];
  messageRate?: number;
  batchSize?: number;
  feed?: 'stomp' | 'seed';
  rate?: number;
  updatesPerTick?: number;
  label?: string;
  clientId?: string;
  snapshotRows?: number;
  columnDefinitions?: ColumnDefinition[];
};

function keyColumnOf(c: StompBag): string | undefined {
  if (typeof c.keyColumn === 'string' && c.keyColumn) return c.keyColumn;
  if (Array.isArray(c.keyColumn) && c.keyColumn[0]) return c.keyColumn[0];
  return undefined;
}

function clientIdFromTopic(topic: string | undefined): string | undefined {
  if (!topic) return undefined;
  const m = topic.match(/\/snapshot\/positions\/([^/]+)/);
  return m?.[1];
}

/**
 * Hub `messageRate` is the STOMP `snapshot-rows` request size (same as
 * Perspective `snapshotRows`). Default 10_000 to match cgrid-ssrm-demo.
 */
export function snapshotRowsFromConfig(cfg: DataProviderConfig): number {
  const c = (cfg.config ?? {}) as StompBag;
  return Number(c.snapshotRows ?? c.messageRate ?? 10_000) || 10_000;
}

function cellTypeToPerspective(
  cellDataType: ColumnDefinition['cellDataType'],
): PerspectiveSchema[string] {
  if (cellDataType === 'number') return 'float';
  if (cellDataType === 'boolean') return 'boolean';
  if (cellDataType === 'date') return 'date';
  return 'string';
}

/**
 * Build the Perspective table schema from DataProvider `columnDefinitions`.
 * Always includes `positionId` (canonical index after keyColumn remap).
 * Falls back to {@link POSITION_SCHEMA} when the catalog has no columns.
 */
export function columnDefinitionsToPerspectiveSchema(
  cols: readonly ColumnDefinition[] | undefined | null,
  keyColumn = 'positionId',
): PerspectiveSchema {
  if (!cols?.length) return { ...POSITION_SCHEMA };
  const schema: PerspectiveSchema = { positionId: 'string' };
  for (const d of cols) {
    if (!d.field) continue;
    // Payload key is remapped onto positionId before table.update.
    if (d.field === keyColumn || d.field === 'positionId') {
      schema.positionId = 'string';
      continue;
    }
    schema[d.field] = cellTypeToPerspective(d.cellDataType);
  }
  return schema;
}

/**
 * Map catalog `columnDefinitions` onto VelocityGrid columnDefs 1:1.
 * Returns `[]` when the catalog has no columns (grid shows none).
 */
export function columnDefinitionsToGridDefs(
  cols: readonly ColumnDefinition[] | undefined | null,
): CColDef<PositionRow>[] {
  if (!cols?.length) return [];
  return cols.map((d) => {
    const def: CColDef<PositionRow> = {
      field: d.field as keyof PositionRow & string,
      colId: d.field,
      headerName: d.headerName ?? d.field,
    };
    if (d.cellDataType === 'number' || d.cellDataType === 'text') {
      def.cellDataType = d.cellDataType;
    }
    if (typeof d.valueGetter === 'string' && d.valueGetter.trim()) {
      def.valueGetter = d.valueGetter.trim();
    }
    if (d.width != null) def.width = d.width;
    if (d.hide != null) def.hide = d.hide;
    if (d.sortable != null) def.sortable = d.sortable;
    if (d.resizable != null) def.resizable = d.resizable;
    if (d.filter === true) {
      // Text dimensions → set filter (unique-value checklist). Numerics
      // keep comparison / range floating filters.
      def.filter = d.cellDataType === 'number' ? 'number' : 'set';
      def.floatingFilter = true;
    }
    // Heuristics from catalog cellDataType (not a hard-coded column list).
    if (d.cellDataType === 'number') {
      def.aggFunc = 'sum';
      def.enableValue = true;
    } else if (d.field !== 'positionId') {
      def.enableRowGroup = true;
    }
    return def;
  });
}

/** ColumnDefs from the DataProvider catalog only — never invents columns. */
export function gridColumnDefsFromDataProvider(
  cfg: DataProviderConfig,
): CColDef<PositionRow>[] {
  const cols = (cfg.config as StompBag | undefined)?.columnDefinitions;
  return columnDefinitionsToGridDefs(cols);
}

export function dataProviderConfigToPerspective(
  cfg: DataProviderConfig,
): StompPerspectiveProviderConfig {
  const c = (cfg.config ?? {}) as StompBag;
  const feed = c.feed === 'seed' ? 'seed' : 'stomp';
  const listener = c.listenerTopic?.trim();
  const clientId = c.clientId?.trim()
    || clientIdFromTopic(listener)
    || 'TRADER001';
  const keyColumn = keyColumnOf(c) ?? 'positionId';
  const out: StompPerspectiveProviderConfig = {
    providerId: cfg.providerId,
    feed,
    label: c.label?.trim() || cfg.name || 'Perspective SSRM',
    snapshotRows: snapshotRowsFromConfig(cfg),
    rate: Number(c.rate ?? 40) || 40,
    batchSize: Number(c.batchSize ?? 200) || 200,
    updatesPerTick: Number(c.updatesPerTick ?? 5) || 5,
    keyColumn,
    // Table schema is owned by the DataProvider; each grid only gets a View.
    schema: columnDefinitionsToPerspectiveSchema(c.columnDefinitions, keyColumn),
  };
  if (feed === 'stomp') {
    out.wsUrl = (c.websocketUrl ?? 'ws://localhost:8082').trim();
    out.clientId = clientId;
    if (listener) out.snapshotTopic = listener;
    if (c.requestMessage?.trim()) out.triggerTopic = c.requestMessage.trim();
    if (c.snapshotEndToken?.trim()) out.snapshotEndToken = c.snapshotEndToken.trim();
  }
  return out;
}
