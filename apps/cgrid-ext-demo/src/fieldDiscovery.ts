/**
 * Discover every (possibly nested) field on STOMP position rows and build
 * flat columnDefs whose `field` uses AG-Grid-style dot paths
 * (`risk.dv01`). Rows are flattened so the worker's `row[field]` read
 * resolves dotted keys without a kernel change.
 */
import type { CColDef, CColGroupDef } from '@wellsfargo-starui/velocity-grid';

export type FlatRow = Record<string, unknown> & { positionId: string };

const SKIP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True for plain objects we should recurse into (not Date / Array / null). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null
    && typeof v === 'object'
    && !Array.isArray(v)
    && !(v instanceof Date)
  );
}

/** Collect dotted paths for every leaf under `obj`. */
export function collectFieldPaths(
  obj: unknown,
  prefix = '',
  into: Set<string> = new Set(),
): Set<string> {
  if (!isPlainObject(obj)) {
    if (prefix) into.add(prefix);
    return into;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (SKIP_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      collectFieldPaths(value, path, into);
      // Nested object with no own enumerable leaves still needs a path
      // if it's empty — skip empties.
      if (Object.keys(value).length === 0) into.add(path);
    } else {
      into.add(path);
    }
  }
  return into;
}

/** Union of dotted leaf paths across a sample of rows.
 *  Scanning all 20k STOMP rows on snapshot is pure boot jank — schemas are
 *  homogeneous, so a small head/tail sample is enough (Deephaven treats the
 *  grid as a dumb viewport renderer; schema work stays off the hot path). */
export function discoverFieldPaths(
  rows: readonly unknown[],
  sampleSize = 200,
): string[] {
  const paths = new Set<string>();
  const n = rows.length;
  if (n === 0) return [];
  const head = Math.min(sampleSize, n);
  for (let i = 0; i < head; i++) collectFieldPaths(rows[i], '', paths);
  if (n > sampleSize) {
    const tail = Math.min(50, n - sampleSize);
    for (let i = n - tail; i < n; i++) collectFieldPaths(rows[i], '', paths);
  }
  return [...paths];
}

/** Flatten nested objects to `{ 'a.b': value }` leaves. Arrays / Dates stay leaves. */
export function flattenRow(row: unknown): FlatRow {
  const out: Record<string, unknown> = {};
  const walk = (obj: unknown, prefix: string) => {
    if (!isPlainObject(obj)) {
      if (prefix) out[prefix] = obj;
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (SKIP_KEYS.has(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(value)) walk(value, path);
      else out[path] = value;
    }
  };
  walk(row, '');
  const id = out.positionId;
  if (typeof id !== 'string' || !id) {
    // Last resort — keep a stable key so getRowId doesn't throw.
    out.positionId = String(id ?? `row-${Math.random().toString(36).slice(2)}`);
  }
  return out as FlatRow;
}

export function flattenRows(rows: readonly unknown[]): FlatRow[] {
  return rows.map(flattenRow);
}

function titleCaseSegment(seg: string): string {
  if (!seg) return seg;
  // Preserve common acronyms / id-ish tokens.
  if (/^[A-Z0-9_]+$/.test(seg) && seg.length <= 6) return seg;
  return seg.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function headerForPath(path: string): string {
  const parts = path.split('.');
  return titleCaseSegment(parts[parts.length - 1]!);
}

function inferCellDataType(sample: unknown): 'text' | 'number' {
  if (typeof sample === 'number' && Number.isFinite(sample)) return 'number';
  return 'text';
}

/** Prefer these roots / leaves near the left of the grid. */
const PREFERRED_ORDER = [
  'positionId',
  'ticker',
  'cusip',
  'desk',
  'region',
  'currency',
  'trader',
  'notionalAmount',
  'marketValue',
  'pnl',
  'dailyPnl',
  'currentPrice',
  'unrealizedPnl',
  'yield',
  'spread',
  'dv01',
  'pv01',
];

function sortPaths(paths: string[]): string[] {
  const rank = (p: string) => {
    const i = PREFERRED_ORDER.indexOf(p);
    if (i >= 0) return i;
    const leaf = p.includes('.') ? p.slice(p.lastIndexOf('.') + 1) : p;
    const j = PREFERRED_ORDER.indexOf(leaf);
    if (j >= 0) return 100 + j;
    return 1000;
  };
  return [...paths].sort((a, b) => {
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
}

/** Known-path polish (formatters / grouping) keyed by full dotted path or leaf. */
function polishFor(
  path: string,
  sample: unknown,
): Partial<CColDef<FlatRow>> {
  const leaf = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path;
  const type = inferCellDataType(sample);
  // Fixed width — never flex. Hundreds of flex leaves collapse to minWidth
  // and make every layout/scroll pass walk a 40k+ CSS-px content width.
  const base: Partial<CColDef<FlatRow>> = {
    cellDataType: type,
    width: 110,
    // Keep Values / row-group affordances off by default for wide feeds —
    // opt in below for a small set of known dimensions. 500 enableValue
    // columns makes the Columns tool panel and pivot wiring expensive.
    enableValue: false,
    enableRowGroup: false,
    enablePivot: false,
  };
  if (path === 'positionId' || leaf === 'positionId') {
    return { ...base, pinned: 'left', width: 140, editable: false, suppressMovable: true };
  }
  if (type === 'number') {
    const money = /pnl|notional|market|value|amount|price/i.test(leaf);
    const risk = /dv01|pv01|yield|spread/i.test(leaf);
    return {
      ...base,
      valueFormatter: money ? '#,##0.00;[Red](#,##0.00)' : '#,##0.##',
      ...(money || risk ? { enableValue: true, aggFunc: 'sum' as const } : {}),
    };
  }
  if (['desk', 'region', 'currency', 'trader', 'ticker', 'cusip'].includes(leaf)) {
    return { ...base, enableRowGroup: true, enablePivot: true };
  }
  return base;
}

/**
 * Build columnDefs covering every discovered path. Nested paths become
 * children of a column group named after the first segment
 * (`risk.dv01` → group `risk` / leaf `dv01`).
 */
export function buildColumnDefsFromRows(
  rows: readonly FlatRow[],
): Array<CColDef<FlatRow> | CColGroupDef<FlatRow>> {
  const paths = sortPaths(discoverFieldPaths(rows));
  if (paths.length === 0) {
    return [{ colId: 'positionId', field: 'positionId', headerName: 'Position', pinned: 'left' }];
  }

  // Sample first non-null value per path for type inference (same small
  // head window as discoverFieldPaths — avoid O(rows×cols) on 20k).
  const sampleOf = (path: string): unknown => {
    const limit = Math.min(200, rows.length);
    for (let i = 0; i < limit; i++) {
      const v = rows[i]![path];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };

  const topLeaves: CColDef<FlatRow>[] = [];
  const groups = new Map<string, CColDef<FlatRow>[]>();

  for (const path of paths) {
    const sample = sampleOf(path);
    const def: CColDef<FlatRow> = {
      colId: path,
      field: path,
      headerName: headerForPath(path),
      ...polishFor(path, sample),
    };
    const dot = path.indexOf('.');
    if (dot < 0) {
      topLeaves.push(def);
      continue;
    }
    const root = path.slice(0, dot);
    let kids = groups.get(root);
    if (!kids) {
      kids = [];
      groups.set(root, kids);
    }
    kids.push(def);
  }

  const out: Array<CColDef<FlatRow> | CColGroupDef<FlatRow>> = [...topLeaves];
  for (const [root, children] of groups) {
    out.push({
      groupId: root,
      headerName: titleCaseSegment(root),
      openByDefault: true,
      marryChildren: true,
      children,
    });
  }
  return out;
}
