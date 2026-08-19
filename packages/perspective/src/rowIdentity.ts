/**
 * Perspective table `index` column + row-identity helpers.
 *
 * Identity always comes from DataProvider `keyColumn` (single field or
 * composite) — never a hardcoded business field name inside LWW / upsert
 * paths. For composite keys Perspective still needs one physical index
 * column; that carrier is derived from the key field names.
 */
import { composeRowId } from '@wellsfargo-starui/velocity-grid-data';

export type RowKeyColumn = string | readonly string[];

/** Physical Perspective `table({ index })` column for this keyColumn. */
export function resolveTableIndexField(keyColumn: RowKeyColumn): string {
  if (typeof keyColumn === 'string' && keyColumn.trim()) return keyColumn.trim();
  const keys = (Array.isArray(keyColumn) ? keyColumn : [])
    .filter((k): k is string => typeof k === 'string' && !!k.trim())
    .map((k) => k.trim());
  if (keys.length === 1) return keys[0]!;
  if (keys.length > 1) return keys.join('_');
  throw new Error('[perspective] keyColumn is required (string or non-empty string[])');
}

/** LWW / getRowId identity from keyColumn (composite-safe). */
export function rowIdentity(
  row: Record<string, unknown>,
  keyColumn: RowKeyColumn,
): string | null {
  return composeRowId(row, keyColumn);
}
