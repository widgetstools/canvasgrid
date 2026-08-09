import type { ColumnDefinition, FieldInfo } from '../types/schema';

function inferType(v: unknown): FieldInfo['inferredType'] {
  if (v == null) return 'unknown';
  if (typeof v === 'number' && Number.isFinite(v)) return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return 'date';
    return 'text';
  }
  if (typeof v === 'object') return 'object';
  return 'unknown';
}

function walk(
  obj: Record<string, unknown>,
  prefix: string,
  into: Map<string, { types: Map<FieldInfo['inferredType'], number>; nulls: number; samples: unknown[]; seen: number }>,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    let slot = into.get(path);
    if (!slot) {
      slot = { types: new Map(), nulls: 0, samples: [], seen: 0 };
      into.set(path, slot);
    }
    slot.seen += 1;
    if (v == null) {
      slot.nulls += 1;
      continue;
    }
    const t = inferType(v);
    slot.types.set(t, (slot.types.get(t) ?? 0) + 1);
    if (slot.samples.length < 3) slot.samples.push(v);
    if (t === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
      walk(v as Record<string, unknown>, path, into);
    }
  }
}

/** Scan sample rows and produce FieldInfo[]. */
export function inferFieldsFromRows(
  rows: readonly unknown[],
  opts?: { maxRows?: number },
): FieldInfo[] {
  const max = opts?.maxRows ?? 200;
  const acc = new Map<string, { types: Map<FieldInfo['inferredType'], number>; nulls: number; samples: unknown[]; seen: number }>();
  let n = 0;
  for (const raw of rows) {
    if (n >= max) break;
    if (!raw || typeof raw !== 'object') continue;
    walk(raw as Record<string, unknown>, '', acc);
    n += 1;
  }
  const out: FieldInfo[] = [];
  for (const [path, slot] of acc) {
    let best: FieldInfo['inferredType'] = 'unknown';
    let bestN = 0;
    for (const [t, c] of slot.types) {
      if (c > bestN) { best = t; bestN = c; }
    }
    out.push({
      path,
      inferredType: best,
      nullRatio: slot.seen ? slot.nulls / slot.seen : 0,
      samples: slot.samples,
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Promote inferred fields to starter column definitions (does not overwrite authored). */
export function fieldsToColumnDefinitions(fields: FieldInfo[]): ColumnDefinition[] {
  return fields
    .filter((f) => !f.path.includes('.') || f.inferredType !== 'object')
    .filter((f) => f.inferredType !== 'object')
    .map((f) => ({
      field: f.path,
      headerName: f.path.split('.').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '),
      cellDataType: f.inferredType === 'unknown' ? 'text' : f.inferredType === 'object' ? 'text' : f.inferredType,
      filter: true,
      sortable: true,
      resizable: true,
    }));
}
