/**
 * Map a hub DataProviderConfig onto StompPerspectiveProvider + grid columns.
 * The DataProvider catalog owns columnDefinitions — the grid does not invent them.
 */
import type {
  ColumnDefinition,
  DataProviderConfig,
} from '@wellsfargo-starui/velocity-grid-data';
import { toGridColumnDefs } from '@wellsfargo-starui/velocity-grid-data';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import type { StompPerspectiveProviderConfig } from './provider';
import { POSITION_SCHEMA, type PositionRow } from './bootstrap';
import { resolveTableIndexField } from './rowIdentity';

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

function keyColumnOf(c: StompBag): string | string[] | undefined {
  if (typeof c.keyColumn === 'string' && c.keyColumn.trim()) return c.keyColumn.trim();
  if (Array.isArray(c.keyColumn) && c.keyColumn.length) {
    const keys = c.keyColumn.filter((k: string) => typeof k === 'string' && k.trim());
    if (keys.length === 1) return keys[0];
    if (keys.length > 1) return keys;
  }
  return undefined;
}

function clientIdFromTopic(topic: string | undefined): string | undefined {
  if (!topic) return undefined;
  const m = topic.match(/\/snapshot\/positions\/([^/]+)/);
  return m?.[1];
}

/**
 * Hub `messageRate` is the STOMP `snapshot-rows` request size (same as
 * Perspective `snapshotRows`). Default 10_000 to match velocitygrid-ssrm-demo.
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
 * Ensures the table index field derived from `keyColumn` is present.
 * Falls back to {@link POSITION_SCHEMA} when the catalog has no columns.
 */
export function columnDefinitionsToPerspectiveSchema(
  cols: readonly ColumnDefinition[] | undefined | null,
  keyColumn: string | readonly string[] = 'positionId',
): PerspectiveSchema {
  if (!cols?.length) return { ...POSITION_SCHEMA };
  const indexField = resolveTableIndexField(keyColumn);
  // A composite keyColumn synthesizes indexField by joining its parts
  // (e.g. ['desk','book'] -> 'desk_book'). If the catalog ALSO declares a
  // real, distinct column under that exact name, treating it as the index
  // column below would silently coerce its type and, on every tick,
  // overwrite its value with the composed row id — fail loud instead.
  if (Array.isArray(keyColumn) && keyColumn.length > 1 && cols.some((d) => d.field === indexField)) {
    throw new Error(
      `[perspective] composite keyColumn ${JSON.stringify(keyColumn)} synthesizes index field `
      + `"${indexField}", which collides with an existing DataProvider column of the same name. `
      + 'Rename the column or choose a keyColumn combination that does not collide.',
    );
  }
  const schema: PerspectiveSchema = { [indexField]: 'string' };
  for (const d of cols) {
    if (!d.field) continue;
    if (d.field === indexField) {
      schema[indexField] = 'string';
      continue;
    }
    schema[d.field] = cellTypeToPerspective(d.cellDataType);
  }
  return schema;
}

/**
 * SSRM column defs from catalog definitions.
 *
 * Delegates to the shared mapper in `@wellsfargo-starui/velocity-grid-data` so
 * CSRM and SSRM cannot disagree about what a column may be dragged into. This
 * used to be a parallel implementation, and it had already drifted: it derived
 * `enableRowGroup` / `enableValue` where the CSRM one derived nothing, and
 * neither emitted `enablePivot` — so Column Labels rejected every drag on a
 * provider-driven grid. It also hard-coded `positionId` as the key column,
 * which is configurable; the shared mapper is told the real one.
 */
export function columnDefinitionsToGridDefs(
  cols: readonly ColumnDefinition[] | undefined | null,
  keyColumn?: string | string[],
): CColDef<PositionRow>[] {
  return toGridColumnDefs(cols, { keyColumn }) as unknown as CColDef<PositionRow>[];
}

/** ColumnDefs from the DataProvider catalog only — never invents columns. */
export function gridColumnDefsFromDataProvider(
  cfg: DataProviderConfig,
): CColDef<PositionRow>[] {
  const c = (cfg.config ?? {}) as StompBag;
  return columnDefinitionsToGridDefs(c.columnDefinitions, keyColumnOf(c) ?? 'positionId');
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
