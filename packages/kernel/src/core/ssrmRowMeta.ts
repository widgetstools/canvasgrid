/** SSRM row metadata — server-side grouping without worker GroupPass. */

import type { StickyAncestor } from '../worker/protocol';

export const SSRM_ROW_META_KEY = '__ssrm';

export type SsrmRowKind = 'group' | 'leaf' | 'footer' | 'grandTotal';

export interface SsrmRowMeta {
  kind: SsrmRowKind;
  /** Composite group key (same vocabulary as CSRM GroupPass). */
  key: string;
  depth: number;
  label: string;
  childCount?: number;
  expanded?: boolean;
}

export function readSsrmRowMeta(row: unknown): SsrmRowMeta | undefined {
  if (row == null || typeof row !== 'object') return undefined;
  const raw = (row as Record<string, unknown>)[SSRM_ROW_META_KEY];
  if (raw == null || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const kind = m.kind;
  if (kind !== 'group' && kind !== 'leaf' && kind !== 'footer' && kind !== 'grandTotal') {
    return undefined;
  }
  const key = String(m.key ?? '');
  const depth = Math.max(0, Number(m.depth) | 0);
  const label = String(m.label ?? '');
  const childCount = m.childCount == null ? undefined : Math.max(0, Number(m.childCount) | 0);
  const expanded = m.expanded === undefined ? undefined : m.expanded !== false;
  return { kind, key, depth, label, childCount, expanded };
}

export function attachSsrmRowMeta<TRow extends Record<string, unknown>>(
  row: TRow,
  meta: SsrmRowMeta,
): TRow {
  return { ...row, [SSRM_ROW_META_KEY]: meta };
}

/** Column metadata needed to build CSRM-shaped `chunk.groupTotals`. */
export interface SsrmGroupTotalsColumn {
  colId: string;
  field?: string;
  aggFunc?: string | string[];
}

/**
 * Materialise `chunk.groupTotals` from sparse SSRM rows — same shape AggPass
 * ships for CSRM, so the main thread paints group headers via
 * `totalsCellLookup` without special cases.
 *
 * Host rows (Perspective group_by, etc.) carry pre-aggregated field values;
 * this maps them onto composite group keys from `__ssrm` metadata.
 */
function mergeSsrmGroupRowTotals(
  groupTotals: Record<string, Record<string, unknown>>,
  aggCols: readonly SsrmGroupTotalsColumn[],
  row: Record<string, unknown>,
  key: string,
): void {
  if (!key) return;
  let rec = groupTotals[key];
  if (!rec) {
    rec = {};
    groupTotals[key] = rec;
  }
  for (const col of aggCols) {
    const v = row[col.field!];
    if (v !== undefined && v !== null) rec[col.colId] = v;
  }
}

export function materializeSsrmGroupTotals(
  getRowById: (rowId: string) => unknown | undefined,
  columns: readonly SsrmGroupTotalsColumn[],
  visibleRowIds: readonly string[],
  rowKinds: Uint8Array,
  groupKeys: readonly string[],
  /** Global ssrm order — with `orderPrefixEnd`, also totals for sticky ancestors above the chunk. */
  orderIds?: readonly string[],
  orderPrefixEnd?: number,
): Record<string, Record<string, unknown>> {
  const aggCols = columns.filter((c) => c.aggFunc != null && c.field);
  if (aggCols.length === 0) return {};

  const groupTotals: Record<string, Record<string, unknown>> = {};

  if (orderIds && orderPrefixEnd != null && orderPrefixEnd > 0) {
    const limit = Math.min(orderPrefixEnd, orderIds.length);
    for (let i = 0; i < limit; i++) {
      const rowId = orderIds[i];
      if (!rowId) continue;
      const row = getRowById(rowId);
      if (row == null || typeof row !== 'object') continue;
      const meta = readSsrmRowMeta(row);
      if (meta?.kind !== 'group' || !meta.key) continue;
      mergeSsrmGroupRowTotals(groupTotals, aggCols, row as Record<string, unknown>, meta.key);
    }
  }

  const n = Math.min(visibleRowIds.length, rowKinds.length, groupKeys.length);
  for (let i = 0; i < n; i++) {
    // Group rows (1) AND footer rows (3) both resolve per-group totals.
    if (rowKinds[i] !== 1 && rowKinds[i] !== 3) continue;
    const key = groupKeys[i] ?? '';
    if (!key) continue;
    const rowId = visibleRowIds[i];
    if (!rowId) continue;
    const row = getRowById(rowId);
    if (row == null || typeof row !== 'object') continue;
    mergeSsrmGroupRowTotals(groupTotals, aggCols, row as Record<string, unknown>, key);
  }
  return groupTotals;
}

/** `${colId}:${value}` segments joined by `::` — same vocabulary as
 *  GroupPass / the CSRM expansion mirror. Kernel-internal for the v2
 *  skeleton path (the wire speaks raw `path: string[]`). Known caveat:
 *  values containing `::` corrupt segmentation — acceptable while the
 *  encoding stays internal; escape before ever exposing it. */
export function buildCompositeGroupKey(
  rowGroupCols: readonly string[],
  path: readonly string[],
): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length && i < rowGroupCols.length; i++) {
    parts.push(`${rowGroupCols[i]!}:${path[i] ?? ''}`);
  }
  return parts.join('::');
}

/** Parse composite group key segments — same vocabulary as GroupPass / demo. */
export function parseCompositeGroupKey(key: string): Array<{ colId: string; value: string }> {
  if (!key) return [];
  return key.split('::').map((seg) => {
    const i = seg.indexOf(':');
    if (i < 0) return { colId: seg, value: '' };
    return { colId: seg.slice(0, i), value: seg.slice(i + 1) };
  });
}

/**
 * Sticky ancestor band for sparse SSRM — walks hydrated row ids above
 * `rowStart` and picks the last expanded group at each depth (CSRM parity).
 *
 * `rowGroupCols` may be empty on the sparse path (the worker group model is
 * never shipped there); each ancestor's colId then falls back to its
 * composite-key segment.
 */
export function computeSsrmStickyAncestors(
  getRowById: (rowId: string) => unknown | undefined,
  visibleIds: readonly string[],
  rowStart: number,
  rowGroupCols: readonly string[],
): StickyAncestor[] {
  if (rowStart <= 0) return [];
  const lastAtDepth = new Map<number, SsrmRowMeta>();
  const limit = Math.min(rowStart, visibleIds.length);
  for (let i = 0; i < limit; i++) {
    const id = visibleIds[i];
    if (!id) continue;
    const meta = readSsrmRowMeta(getRowById(id));
    if (meta?.kind === 'group') {
      // A group at depth d starts a new subtree at that depth — anything
      // recorded deeper belongs to the PREVIOUS subtree and is no longer
      // an ancestor of rows below this point.
      for (const depth of lastAtDepth.keys()) {
        if (depth > meta.depth) lastAtDepth.delete(depth);
      }
      lastAtDepth.set(meta.depth, meta);
    }
  }
  if (lastAtDepth.size === 0) return [];
  const result: StickyAncestor[] = [];
  for (const depth of [...lastAtDepth.keys()].sort((a, b) => a - b)) {
    const meta = lastAtDepth.get(depth)!;
    // A collapsed group has no visible descendants — anything recorded
    // deeper cannot be a true ancestor either, so the chain ends here.
    if (meta.expanded === false) break;
    const segs = parseCompositeGroupKey(meta.key);
    const colId = rowGroupCols[depth] ?? segs[depth]?.colId ?? '';
    result.push({
      depth,
      key: meta.key,
      colId,
      value: meta.label,
      childCount: meta.childCount ?? 0,
      isExpanded: meta.expanded ?? true,
    });
  }
  return result;
}
