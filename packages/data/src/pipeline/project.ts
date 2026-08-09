import type { ColumnDefinition } from '../types/schema';

/** Keep only key + authored column fields (and nested parent paths). */
export function projectRow(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  if (!fields.length) return row;
  const keep = new Set(fields);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (keep.has(k)) out[k] = row[k];
  }
  return out;
}

export function fieldPathsFromColumnDefs(
  defs: readonly ColumnDefinition[] | undefined,
  keyColumn: string | readonly string[] | undefined,
): string[] {
  const paths = new Set<string>();
  if (typeof keyColumn === 'string') paths.add(keyColumn);
  else if (Array.isArray(keyColumn)) for (const k of keyColumn) paths.add(k);
  for (const d of defs ?? []) {
    if (d.field) paths.add(d.field);
  }
  return [...paths];
}

/**
 * When thinDeltas is on, emit only changed keys vs previous (always keep key cols).
 */
export function thinDelta(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  keyFields: readonly string[],
): Record<string, unknown> {
  if (!prev) return next;
  const out: Record<string, unknown> = {};
  for (const k of keyFields) {
    if (k in next) out[k] = next[k];
  }
  for (const [k, v] of Object.entries(next)) {
    if (keyFields.includes(k)) continue;
    if (!Object.is(prev[k], v)) out[k] = v;
  }
  return out;
}
