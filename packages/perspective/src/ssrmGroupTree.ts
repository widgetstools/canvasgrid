/**
 * Sparse SSRM grouping helpers — materialize a visible flat row list from
 * Perspective `__ROW_PATH__` output and attach cgrid `__ssrm` metadata.
 */
import { attachSsrmRowMeta } from '@wellsfargo-starui/velocity-grid';

import type { PositionRow } from './bootstrap';

export const GROUP_ROW_ID_PREFIX = '__grp__';
export const FOOTER_ROW_ID_PREFIX = '__footer__';

/** Task 4 (A-C7) — escape a single key SEGMENT (a colId or a value) so it
 *  can never introduce a spurious `:` (colId/value separator) or `::`
 *  (level separator) into a composite group key. `%` is escaped FIRST so
 *  its own escape sequence is never re-escaped by the `:` pass. Local
 *  copy of the kernel's `escapeGroupKeySegment` (no new cross-package
 *  dependency) — must stay byte-for-byte identical to
 *  `@wellsfargo-starui/velocity-grid`'s `core/ssrmRowMeta.ts` so keys
 *  built here match the same vocabulary as worker GroupPass. */
export function escapeGroupKeySegment(s: string): string {
  return s.replace(/%/g, '%25').replace(/:/g, '%3A');
}

function unescapeGroupKeySegment(s: string): string {
  return s.replace(/%3A/g, ':').replace(/%25/g, '%');
}

/** Split a composite group key into its per-level segment strings — the
 *  ONLY safe way to break a key into levels now that segments are
 *  escaped (never `key.split('::')` directly outside this helper). */
export function splitGroupKey(key: string): string[] {
  return key === '' ? [] : key.split('::');
}

/** `${colId}:${value}` segments (each escaped via `escapeGroupKeySegment`)
 *  joined by `::` — matches worker GroupPass. A value containing `:` or
 *  `::` no longer corrupts segmentation — see Task 4 (A-C7). */
export function buildCompositeGroupKey(rowGroupCols: string[], path: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length && i < rowGroupCols.length; i++) {
    parts.push(`${escapeGroupKeySegment(rowGroupCols[i]!)}:${escapeGroupKeySegment(path[i] ?? '')}`);
  }
  return parts.join('::');
}

export function parseCompositeGroupKey(key: string): Array<{ colId: string; value: string }> {
  return splitGroupKey(key).map((seg) => {
    const i = seg.indexOf(':');
    if (i < 0) return { colId: unescapeGroupKeySegment(seg), value: '' };
    return {
      colId: unescapeGroupKeySegment(seg.slice(0, i)),
      value: unescapeGroupKeySegment(seg.slice(i + 1)),
    };
  });
}

export function groupRowId(key: string): string {
  return `${GROUP_ROW_ID_PREFIX}${key}`;
}

function readRowPath(raw: Record<string, unknown>): string[] {
  const p = raw.__ROW_PATH__;
  if (!Array.isArray(p)) return [];
  return p.map((v) => String(v ?? ''));
}

function pathFromKey(key: string): string[] {
  return parseCompositeGroupKey(key).map((s) => s.value);
}

/** True when every ancestor of this path is expanded (group row itself always visible). */
export function isPathVisible(
  path: string[],
  rowGroupCols: string[],
  expandedKeys: ReadonlySet<string>,
): boolean {
  if (path.length === 0) return true;
  for (let d = 0; d < path.length - 1; d++) {
    const ancestorKey = buildCompositeGroupKey(rowGroupCols, path.slice(0, d + 1));
    if (!expandedKeys.has(ancestorKey)) return false;
  }
  return true;
}

export interface MaterializeGroupedOpts {
  rowGroupCols: string[];
  expandedGroupKeys: readonly string[];
  includeGroupFooter?: boolean;
  includeGrandTotal?: boolean;
  /** Leaf rows keyed by deepest expanded composite group key. */
  leafRowsByGroupKey?: ReadonlyMap<string, PositionRow[]>;
}

function appendGroupRow(
  out: PositionRow[],
  raw: Record<string, unknown>,
  rowGroupCols: string[],
  path: string[],
  expanded: ReadonlySet<string>,
): void {
  const depth = path.length - 1;
  const key = buildCompositeGroupKey(rowGroupCols, path);
  const label = path[depth] ?? '';
  const childCount = Number(raw.positionId ?? 0) || 0;

  const base = { ...raw, positionId: groupRowId(key) } as PositionRow;
  out.push(attachSsrmRowMeta(base, {
    kind: 'group',
    key,
    depth,
    label,
    childCount,
    expanded: expanded.has(key),
  }));
}

function appendLeafRows(
  out: PositionRow[],
  parentKey: string,
  depth: number,
  leaves: readonly PositionRow[],
): void {
  for (const leaf of leaves) {
    const row = { ...leaf } as PositionRow;
    out.push(attachSsrmRowMeta(row, {
      kind: 'leaf',
      key: parentKey,
      depth,
      label: String(leaf.positionId ?? ''),
    }));
  }
}

/**
 * Turn Perspective grouped `to_json` rows into cgrid SSRM rows with `__ssrm`
 * metadata and stable synthetic ids for group rows.
 *
 * Walks the group tree in display order, honouring `expandedGroupKeys`.
 * Deepest expanded groups may append leaf rows supplied in `leafRowsByGroupKey`.
 */
export function materializeGroupedRows(
  rawRows: Record<string, unknown>[],
  opts: MaterializeGroupedOpts,
): PositionRow[] {
  const {
    rowGroupCols,
    expandedGroupKeys,
    includeGroupFooter = false,
    includeGrandTotal = false,
    leafRowsByGroupKey,
  } = opts;
  if (rowGroupCols.length === 0) {
    return rawRows as PositionRow[];
  }

  const expanded = new Set(expandedGroupKeys);
  const leavesByKey = leafRowsByGroupKey ?? new Map<string, PositionRow[]>();
  const rowByKey = new Map<string, Record<string, unknown>>();
  let grandTotal: Record<string, unknown> | null = null;
  const orderedKeys: string[] = [];

  for (const raw of rawRows) {
    const path = readRowPath(raw);
    if (path.length === 0) {
      grandTotal = raw;
      continue;
    }
    if (path.length > rowGroupCols.length) continue;
    const key = buildCompositeGroupKey(rowGroupCols, path);
    if (!rowByKey.has(key)) orderedKeys.push(key);
    rowByKey.set(key, raw);
  }

  const out: PositionRow[] = [];

  if (includeGrandTotal && grandTotal) {
    const row = { ...grandTotal, positionId: '__grand_total__' } as PositionRow;
    out.push(attachSsrmRowMeta(row, {
      kind: 'grandTotal',
      key: '',
      depth: 0,
      label: 'Total',
    }));
  }

  const walk = (path: string[]): void => {
    if (!isPathVisible(path, rowGroupCols, expanded)) return;
    const key = buildCompositeGroupKey(rowGroupCols, path);
    const raw = rowByKey.get(key);
    if (!raw) return;

    appendGroupRow(out, raw, rowGroupCols, path, expanded);

    if (includeGroupFooter && path.length < rowGroupCols.length) {
      const footer = { ...raw, positionId: `${FOOTER_ROW_ID_PREFIX}${key}` } as PositionRow;
      out.push(attachSsrmRowMeta(footer, {
        kind: 'footer',
        key,
        depth: path.length,
        label: '',
      }));
    }

    if (!expanded.has(key)) return;

    const atDeepest = path.length === rowGroupCols.length;
    if (atDeepest) {
      appendLeafRows(out, key, path.length, leavesByKey.get(key) ?? []);
      return;
    }

    for (const childKey of orderedKeys) {
      const childPath = pathFromKey(childKey);
      if (childPath.length !== path.length + 1) continue;
      if (!childPath.slice(0, path.length).every((v, i) => v === path[i])) continue;
      walk(childPath);
    }
  };

  for (const key of orderedKeys) {
    const path = pathFromKey(key);
    if (path.length !== 1) continue;
    walk(path);
  }

  return out;
}

export interface GroupedLeafFetch {
  (groupKey: string, leafStart: number, leafEnd: number): Promise<PositionRow[]>;
}

interface GroupedTreeIndex {
  rowGroupCols: string[];
  expanded: Set<string>;
  rowByKey: Map<string, Record<string, unknown>>;
  orderedKeys: string[];
  includeGroupFooter: boolean;
  includeGrandTotal: boolean;
  grandTotal: Record<string, unknown> | null;
}

function buildGroupedTreeIndex(
  rawRows: Record<string, unknown>[],
  opts: MaterializeGroupedOpts,
): GroupedTreeIndex | null {
  const { rowGroupCols, expandedGroupKeys, includeGroupFooter = false, includeGrandTotal = false } = opts;
  if (rowGroupCols.length === 0) return null;

  const expanded = new Set(expandedGroupKeys);
  const rowByKey = new Map<string, Record<string, unknown>>();
  let grandTotal: Record<string, unknown> | null = null;
  const orderedKeys: string[] = [];

  for (const raw of rawRows) {
    const path = readRowPath(raw);
    if (path.length === 0) {
      grandTotal = raw;
      continue;
    }
    if (path.length > rowGroupCols.length) continue;
    const key = buildCompositeGroupKey(rowGroupCols, path);
    if (!rowByKey.has(key)) orderedKeys.push(key);
    rowByKey.set(key, raw);
  }

  return {
    rowGroupCols,
    expanded,
    rowByKey,
    orderedKeys,
    includeGroupFooter,
    includeGrandTotal,
    grandTotal,
  };
}

function leafCountAtDeepest(raw: Record<string, unknown> | undefined): number {
  return Math.max(0, Number(raw?.positionId ?? 0) | 0);
}

/** Count visible SSRM rows without loading leaf bodies. */
export function countMaterializedGroupedRows(
  rawRows: Record<string, unknown>[],
  opts: MaterializeGroupedOpts,
): number {
  const tree = buildGroupedTreeIndex(rawRows, opts);
  if (!tree) return rawRows.length;

  let total = 0;
  if (tree.includeGrandTotal && tree.grandTotal) total++;

  const countWalk = (path: string[]): void => {
    if (!isPathVisible(path, tree.rowGroupCols, tree.expanded)) return;
    const key = buildCompositeGroupKey(tree.rowGroupCols, path);
    const raw = tree.rowByKey.get(key);
    if (!raw) return;

    total++;
    if (tree.includeGroupFooter && path.length < tree.rowGroupCols.length) total++;

    if (!tree.expanded.has(key)) return;

    if (path.length === tree.rowGroupCols.length) {
      total += leafCountAtDeepest(raw);
      return;
    }

    for (const childKey of tree.orderedKeys) {
      const childPath = pathFromKey(childKey);
      if (childPath.length !== path.length + 1) continue;
      if (!childPath.slice(0, path.length).every((v, i) => v === path[i])) continue;
      countWalk(childPath);
    }
  };

  for (const key of tree.orderedKeys) {
    const path = pathFromKey(key);
    if (path.length === 1) countWalk(path);
  }
  return total;
}

/**
 * Materialize only rows in [startRow, endRow) — leaf bodies fetched on demand
 * for overlapping deepest-group windows.
 */
export async function materializeGroupedWindow(
  rawRows: Record<string, unknown>[],
  opts: MaterializeGroupedOpts,
  startRow: number,
  endRow: number,
  fetchLeaves: GroupedLeafFetch,
): Promise<{ rows: PositionRow[]; rowCount: number }> {
  const tree = buildGroupedTreeIndex(rawRows, opts);
  if (!tree) {
    const rows = rawRows as PositionRow[];
    return { rows: rows.slice(startRow, endRow), rowCount: rows.length };
  }

  const rowCount = countMaterializedGroupedRows(rawRows, opts);
  const out: PositionRow[] = [];
  let index = 0;
  const start = Math.max(0, startRow | 0);
  const end = Math.max(start, endRow | 0);

  const maybePush = (row: PositionRow): void => {
    if (index >= start && index < end) out.push(row);
    index++;
  };

  if (tree.includeGrandTotal && tree.grandTotal) {
    const row = { ...tree.grandTotal, positionId: '__grand_total__' } as PositionRow;
    maybePush(attachSsrmRowMeta(row, {
      kind: 'grandTotal',
      key: '',
      depth: 0,
      label: 'Total',
    }));
  }

  const walk = async (path: string[]): Promise<void> => {
    if (!isPathVisible(path, tree.rowGroupCols, tree.expanded)) return;
    const key = buildCompositeGroupKey(tree.rowGroupCols, path);
    const raw = tree.rowByKey.get(key);
    if (!raw) return;

    const depth = path.length - 1;
    const label = path[depth] ?? '';
    const childCount = leafCountAtDeepest(raw);
    const base = { ...raw, positionId: groupRowId(key) } as PositionRow;
    maybePush(attachSsrmRowMeta(base, {
      kind: 'group',
      key,
      depth,
      label,
      childCount,
      expanded: tree.expanded.has(key),
    }));

    if (tree.includeGroupFooter && path.length < tree.rowGroupCols.length) {
      const footer = { ...raw, positionId: `${FOOTER_ROW_ID_PREFIX}${key}` } as PositionRow;
      maybePush(attachSsrmRowMeta(footer, {
        kind: 'footer',
        key,
        depth: path.length,
        label: '',
      }));
    }

    if (!tree.expanded.has(key)) return;

    if (path.length === tree.rowGroupCols.length) {
      const leafTotal = childCount;
      if (leafTotal > 0) {
        const blockStart = index;
        const localStart = Math.max(0, start - blockStart);
        const localEnd = Math.min(leafTotal, end - blockStart);
        let leaves: PositionRow[] = [];
        if (localStart < localEnd) {
          leaves = await fetchLeaves(key, localStart, localEnd);
        }
        for (let i = 0; i < leafTotal; i++) {
          if (i >= localStart && i < localEnd) {
            const leaf = leaves[i - localStart];
            if (leaf !== undefined) {
              maybePush(attachSsrmRowMeta({ ...leaf } as PositionRow, {
                kind: 'leaf',
                key,
                depth: path.length,
                label: String(leaf.positionId ?? ''),
              }));
            } else {
              // Fetch came back short of childCount (live churn shrank the
              // group) — skip the missing tail but keep index advancing so
              // later groups stay aligned.
              index++;
            }
          } else {
            index++;
          }
        }
      }
      return;
    }

    for (const childKey of tree.orderedKeys) {
      const childPath = pathFromKey(childKey);
      if (childPath.length !== path.length + 1) continue;
      if (!childPath.slice(0, path.length).every((v, i) => v === path[i])) continue;
      await walk(childPath);
    }
  };

  for (const key of tree.orderedKeys) {
    const path = pathFromKey(key);
    if (path.length !== 1) continue;
    await walk(path);
  }

  return { rows: out, rowCount };
}
