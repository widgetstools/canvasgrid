/**
 * SSRM row metadata — server-side grouping without worker GroupPass.
 *
 * PORT-NOTE: ported from `packages/kernel/src/core/ssrmRowMeta.ts`. In the
 * legacy tree this lived under `src/core/` and the worker reached up into it
 * (`../../core/ssrmRowMeta`). The rebuild's `src/core/` is owned by the SSRM
 * port, which has not landed yet, and the worker layer must not create files
 * there — so the worker carries the subset it needs here, under its own
 * scope. Only the three worker-facing entry points plus their helpers are
 * kept (`readSsrmRowMeta`, `materializeSsrmGroupTotals`,
 * `computeSsrmStickyAncestors`); `attachSsrmRowMeta` /
 * `buildCompositeGroupKey` have no worker caller (`buildCompositeGroupKey`
 * already exists at `src/ssrm/groupKeys.ts`). When `src/core/ssrmRowMeta.ts`
 * lands, collapse this file into a re-export of it and delete the copy.
 */

import type { StickyAncestor } from '../protocol';
import { collectStickyAncestors } from '../stickyAncestors';

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
  return collectStickyAncestors(
    Math.min(rowStart, visibleIds.length),
    (i) => {
      const id = visibleIds[i];
      if (!id) return undefined;
      const meta = readSsrmRowMeta(getRowById(id));
      return meta?.kind === 'group' ? meta : undefined;
    },
    (meta, depth) => {
      // A collapsed group has no visible descendants — anything recorded
      // deeper cannot be a true ancestor either, so the chain ends here.
      if (meta.expanded === false) return null;
      const segs = parseCompositeGroupKey(meta.key);
      return {
        depth,
        key: meta.key,
        colId: rowGroupCols[depth] ?? segs[depth]?.colId ?? '',
        value: meta.label,
        childCount: meta.childCount ?? 0,
        isExpanded: meta.expanded ?? true,
      };
    },
  );
}
