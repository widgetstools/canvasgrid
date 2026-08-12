/** Shared schema / naming helpers — no WASM imports (safe for unit tests). */

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

export type PerspectiveColumnType = 'string' | 'float' | 'boolean' | 'date' | 'integer';
export type PerspectiveTableSchema = Record<string, PerspectiveColumnType | string>;

export const SHARED_TABLE_NAME = 'vg-new-positions-shared';

export function tableNameForSchema(
  schema: PerspectiveTableSchema,
  base = SHARED_TABLE_NAME,
): string {
  const keys = Object.keys(schema).sort();
  const defaultKeys = Object.keys(POSITION_SCHEMA).sort();
  const sameShape = keys.length === defaultKeys.length
    && keys.every((k, i) => k === defaultKeys[i]
      && schema[k] === POSITION_SCHEMA[k as keyof typeof POSITION_SCHEMA]);
  if (sameShape) return base;
  let h = 2166136261;
  for (const k of keys) {
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
    const t = String(schema[k] ?? '');
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  }
  return `${base}-${(h >>> 0).toString(16)}`;
}

export function feedLockNameForSchema(schema: PerspectiveTableSchema): string {
  return `vg-new:feed:${tableNameForSchema(schema)}`;
}
