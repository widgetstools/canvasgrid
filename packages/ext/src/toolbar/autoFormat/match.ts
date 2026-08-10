/**
 * matchFieldToCatalog — resolve formatting for one column from its field
 * name (and, as a fallback, its data type). Ported from starui.
 *
 * Nested fields match on their last segment only (`position.marketValue`
 * → `marketValue`). Resolution order: exact alias → longest suffix →
 * Soundex (numeric columns only) → generic cellDataType fallback.
 */
import { FIELD_FORMAT_CATALOG } from './catalog';
import type { AutoFormatAssignment, FieldFormatEntry } from './types';

export function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function leafOf(field: string): string {
  const i = field.lastIndexOf('.');
  return i >= 0 ? field.slice(i + 1) : field;
}

const MIN_SUFFIX_LEN = 3;
const MIN_SOUNDEX_LEN = 4;

function isNumericCellDataType(cellDataType: string | undefined): boolean {
  if (!cellDataType) return false;
  const t = cellDataType.toLowerCase();
  return t === 'number' || t === 'numeric';
}

const SOUNDEX_CODES: Readonly<Record<string, string>> = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

export function soundex(token: string): string {
  const letters = token.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return '';
  const first = letters[0]!;
  let prev = SOUNDEX_CODES[first] ?? '';
  let out = first.toUpperCase();
  for (let i = 1; i < letters.length && out.length < 4; i++) {
    const ch = letters[i]!;
    const code = SOUNDEX_CODES[ch] ?? '';
    if (code && code !== prev) out += code;
    if (ch !== 'h' && ch !== 'w') prev = code;
  }
  return (out + '000').slice(0, 4);
}

function toAssignment(entry: FieldFormatEntry): AutoFormatAssignment {
  const out: AutoFormatAssignment = {};
  if (entry.format !== undefined) out.format = entry.format;
  if (entry.alignment !== undefined) out.alignment = entry.alignment;
  if (entry.bold) out.bold = true;
  if (entry.headerName !== undefined) out.headerName = entry.headerName;
  return out;
}

function genericForType(cellDataType: string | undefined): AutoFormatAssignment | null {
  switch (cellDataType) {
    case 'number':
    case 'numeric':
      return { alignment: 'right', format: '#,##0.00' };
    case 'date':
    case 'dateString':
      return { format: 'yyyy-mm-dd', alignment: 'left' };
    case 'boolean':
      return { alignment: 'center' };
    default:
      return null;
  }
}

interface Candidate {
  entry: FieldFormatEntry;
  tier: 1 | 2 | 3;
  len: number;
  order: number;
}

export function matchFieldToCatalog(
  field: string | undefined,
  _headerName?: string,
  cellDataType?: string,
): AutoFormatAssignment | null {
  if (!field) return genericForType(cellDataType);

  const token = normalizeToken(leafOf(field));
  if (!token) return genericForType(cellDataType);

  const tokenSoundex =
    isNumericCellDataType(cellDataType) && token.length >= MIN_SOUNDEX_LEN
      ? soundex(token)
      : '';

  let best: Candidate | null = null;
  const consider = (c: Candidate) => {
    if (
      best === null
      || c.tier > best.tier
      || (c.tier === best.tier && c.len > best.len)
      || (c.tier === best.tier && c.len === best.len && c.order < best.order)
    ) {
      best = c;
    }
  };

  FIELD_FORMAT_CATALOG.forEach((entry, order) => {
    for (const alias of entry.aliases ?? []) {
      const a = normalizeToken(alias);
      if (!a) continue;
      if (a === token) {
        consider({ entry, tier: 3, len: a.length, order });
      } else if (
        tokenSoundex
        && a.length >= MIN_SOUNDEX_LEN
        && soundex(a) === tokenSoundex
      ) {
        consider({ entry, tier: 1, len: a.length, order });
      }
    }
    for (const suffix of entry.suffixes ?? []) {
      const s = normalizeToken(suffix);
      if (s.length < MIN_SUFFIX_LEN) continue;
      if (token.endsWith(s)) {
        consider({ entry, tier: 2, len: s.length, order });
      }
    }
  });

  if (best) return toAssignment((best as Candidate).entry);
  return genericForType(cellDataType);
}

export function buildAutoFormatPlan(
  columns: readonly { colId: string; field?: string; headerName?: string; cellDataType?: string }[],
): Record<string, AutoFormatAssignment> {
  const plan: Record<string, AutoFormatAssignment> = {};
  for (const col of columns) {
    if (!col.colId) continue;
    const resolved = matchFieldToCatalog(col.field ?? col.colId, col.headerName, col.cellDataType);
    if (resolved) plan[col.colId] = resolved;
  }
  return plan;
}
