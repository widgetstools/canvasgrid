import {
  encodePivotValueKey,
  orderPivotKeys,
  PIVOT_PATH_SEP,
  PIVOT_ROW_TOTAL_PATH_MARKER,
  type PivotKeyNode,
  type SsrmPivotResult,
} from '@wellsfargo-starui/velocity-grid';
import { buildCompositeGroupKey } from './ssrmGroupTree';

/**
 * Map Perspective `split_by` output onto the kernel's pivot cross-tab shape.
 *
 * Perspective computes the whole matrix in WASM; the kernel's own `PivotPass`
 * never runs on the sparse SSRM path. This converts one to the other so the
 * grid paints a server-computed pivot exactly as it paints a client-computed
 * one.
 *
 * **Perspective's wire shape** (verified against @perspective-dev 4.5.2, not
 * assumed): a view with `group_by: ['desk'], split_by: ['region'],
 * columns: ['pnl']` yields
 *   `column_paths()` → `["AMER|pnl", "APAC|pnl", "EMEA|pnl"]`
 *   `to_json()`      → `[{__ROW_PATH__: [], "AMER|pnl": 26592266.53, …},
 *                        {__ROW_PATH__: ["Credit Trading"], …}, …]`
 * i.e. pivot path segments joined by `|` with the VALUE COLUMN last, and one
 * row per group node with the root (`__ROW_PATH__: []`) carrying grand totals.
 */

/** Perspective's column-path separator. */
const PSP_COLUMN_PATH_SEP = '|';
/** Perspective's group-path field on every `to_json` row. */
const ROW_PATH_FIELD = '__ROW_PATH__';

/** One mounted `split_by` view's output, at a given pivot depth. */
export interface PerspectivePivotViewResult {
  /**
   * `split_by` depth this view was mounted at (1-based). The deepest view
   * (`depth === pivotColIds.length`) defines the column tree; shallower ones
   * exist only to supply the prefix aggregates a collapsed pivot column group
   * reads, which `split_by` never emits for a deeper view.
   */
  depth: number;
  /** `view.column_paths()`. */
  columnPaths: string[];
  /** `view.to_json()` — one row per group node, root first. */
  rows: Array<Record<string, unknown>>;
}

export interface MapPerspectivePivotInput {
  /** One entry per depth 1..pivotColIds.length. Order does not matter. */
  results: PerspectivePivotViewResult[];
  /** Active row-group columns — group keys must match the skeleton's. */
  rowGroupCols: string[];
  /** Active pivot (column-label) columns, in nesting order. */
  pivotColIds: string[];
  /** Value (measure) column ids. */
  valueColIds: string[];
  /**
   * Row totals: rows from the ordinary `group_by`-only view (no `split_by`),
   * which is the aggregate across ALL pivot values for each group. Optional —
   * omit when `pivotRowTotals` is off.
   */
  rowTotalRows?: Array<Record<string, unknown>>;
  /** Mirror of `pivotMaxGeneratedColumns` (kernel default 5000). The kernel
   *  also enforces its own cap on ingest, so this is a cheap early-out. */
  maxGeneratedColumns?: number;
  /**
   * `enableStrictPivotColumnOrder`. Default `true` (strict alphanumeric).
   * `false` is AG's behaviour: previously-seen keys hold their order and new
   * ones append, so a live feed doesn't reshuffle existing pivot columns.
   */
  strictOrder?: boolean;
  /**
   * Per-path key order from the previous call, MUTATED in place to record
   * this call's order. Required for non-strict ordering to have any memory —
   * the caller keeps one map per view (mirrors `PivotPass`'s
   * `previousChildrenByPath`).
   */
  priorKeyOrder?: Map<string, string[]>;
}

/**
 * Split a Perspective column path into `[pivotPath, valueColId]`.
 *
 * Perspective joins with `|`, which can also occur inside a pivot VALUE, so
 * splitting blindly would mis-key those cells. Instead match the known value
 * column as a suffix and require the remainder to hold exactly `depth`
 * segments; anything else is genuinely ambiguous from the string alone and is
 * reported rather than guessed at.
 */
export function parsePerspectiveColumnPath(
  columnPath: string,
  valueColIds: readonly string[],
  depth: number,
): { pivotPath: string[]; valueColId: string } | null {
  for (const valueColId of valueColIds) {
    const suffix = PSP_COLUMN_PATH_SEP + valueColId;
    if (columnPath === valueColId) {
      // No split_by segment at all (depth 0) — not a pivot cell.
      return depth === 0 ? { pivotPath: [], valueColId } : null;
    }
    if (!columnPath.endsWith(suffix)) continue;
    const head = columnPath.slice(0, columnPath.length - suffix.length);
    const parts = head.split(PSP_COLUMN_PATH_SEP);
    // A pivot value containing '|' inflates the count — refuse to guess.
    if (parts.length !== depth) return null;
    return { pivotPath: parts, valueColId };
  }
  return null;
}

/** Depth-first insert of a leaf path into the pivot key tree. */
function insertPath(roots: PivotKeyNode[], path: readonly string[]): void {
  let level = roots;
  const walked: string[] = [];
  for (const value of path) {
    walked.push(value);
    let node = level.find((n) => n.value === value);
    if (node === undefined) {
      node = { value, path: [...walked], children: [] };
      level.push(node);
    }
    level = node.children;
  }
}

/**
 * Order every level of the key tree with the kernel's own policy, and record
 * the resulting order per path so the next call can honour non-strict
 * (append-new-at-end) ordering.
 *
 * Uses the exported `orderPivotKeys` rather than a local sort: the worker's
 * PivotPass orders numerically-aware and respects
 * `enableStrictPivotColumnOrder`, so a local lexicographic sort put `'10'`
 * before `'2'` and reshuffled columns whenever a live feed introduced a key —
 * both visible disagreements with the CSRM path.
 */
function orderTree(
  nodes: PivotKeyNode[],
  prefix: string[],
  priorKeyOrder: Map<string, string[]>,
  strict: boolean,
): PivotKeyNode[] {
  const pathKey = prefix.join(PIVOT_PATH_SEP);
  const byValue = new Map(nodes.map((n) => [n.value, n]));
  const ordered = orderPivotKeys(byValue.keys(), priorKeyOrder.get(pathKey) ?? [], strict);
  priorKeyOrder.set(pathKey, [...ordered]);
  return ordered.map((value) => {
    const node = byValue.get(value)!;
    const path = [...prefix, value];
    return { ...node, children: orderTree(node.children, path, priorKeyOrder, strict) };
  });
}

/** Leaf paths in column-render order — derived from the ORDERED tree so the
 *  two can never disagree (PivotPass derives them the same way). */
function collectLeafPaths(nodes: readonly PivotKeyNode[], out: string[][]): void {
  for (const n of nodes) {
    if (n.children.length === 0) out.push([...n.path]);
    else collectLeafPaths(n.children, out);
  }
}

/**
 * Build the kernel-shaped cross-tab. Returns `null` when there is nothing to
 * pivot (no pivot or value columns), which the caller passes through as a
 * `null` result to clear any previous matrix.
 */
export function mapPerspectivePivot(input: MapPerspectivePivotInput): SsrmPivotResult | null {
  const { results, rowGroupCols, pivotColIds, valueColIds } = input;
  if (pivotColIds.length === 0 || valueColIds.length === 0) return null;

  const depth = pivotColIds.length;
  const deepest = results.find((r) => r.depth === depth);
  if (deepest === undefined) return null;

  // Column tree comes from the deepest view — it alone enumerates full leaf
  // paths. Shallower views only contribute values.
  const unordered: PivotKeyNode[] = [];
  const seenLeaf = new Set<string>();
  let ambiguous = 0;
  for (const columnPath of deepest.columnPaths) {
    const parsed = parsePerspectiveColumnPath(columnPath, valueColIds, depth);
    if (parsed === null) { ambiguous++; continue; }
    const joined = parsed.pivotPath.join(PIVOT_PATH_SEP);
    if (seenLeaf.has(joined)) continue;
    seenLeaf.add(joined);
    insertPath(unordered, parsed.pivotPath);
  }
  const roots = orderTree(
    unordered,
    [],
    input.priorKeyOrder ?? new Map(),
    input.strictOrder !== false,
  );
  const leafPaths: string[][] = [];
  collectLeafPaths(roots, leafPaths);

  if (ambiguous > 0) {
    console.warn(
      `[perspective] ${ambiguous} pivot column path(s) could not be parsed unambiguously — `
      + `a pivot value probably contains '${PSP_COLUMN_PATH_SEP}', which Perspective also uses `
      + 'as its column-path separator. Those columns are omitted rather than mis-keyed.',
    );
  }

  // Mirror PivotPass's cap so a runaway split_by refuses the same way rather
  // than materializing millions of columns.
  const cap = input.maxGeneratedColumns ?? 5000;
  const generatedColumns = leafPaths.length * valueColIds.length;
  if (generatedColumns > cap) {
    return {
      keyTree: [], leafPaths: [], values: new Map(),
      maxColumnsReached: { generatedColumns, cap },
    };
  }

  const values = new Map<string, unknown>();
  const addRow = (
    row: Record<string, unknown>,
    columnPaths: readonly string[],
    atDepth: number,
  ): void => {
    const rowPath = row[ROW_PATH_FIELD];
    if (!Array.isArray(rowPath)) return;
    // `[]` is Perspective's root aggregate row; the kernel keys grand totals
    // with the empty group key, which buildCompositeGroupKey returns for [].
    const groupKey = buildCompositeGroupKey(
      rowGroupCols,
      rowPath.map((v) => String(v ?? '')),
    );
    for (const columnPath of columnPaths) {
      const parsed = parsePerspectiveColumnPath(columnPath, valueColIds, atDepth);
      if (parsed === null) continue;
      const raw = row[columnPath];
      if (raw === undefined) continue;
      values.set(
        encodePivotValueKey(
          groupKey,
          parsed.pivotPath.join(PIVOT_PATH_SEP),
          parsed.valueColId,
        ),
        raw,
      );
    }
  };

  // Every depth contributes: the deepest supplies leaf cells, shallower ones
  // supply the prefix aggregates a collapsed column group reads.
  for (const result of results) {
    for (const row of result.rows) addRow(row, result.columnPaths, result.depth);
  }

  // Row totals — the aggregate across all pivot values, which no split_by view
  // emits. They come from the plain group_by view, keyed under the sentinel.
  if (input.rowTotalRows !== undefined) {
    for (const row of input.rowTotalRows) {
      const rowPath = row[ROW_PATH_FIELD];
      if (!Array.isArray(rowPath)) continue;
      const groupKey = buildCompositeGroupKey(
        rowGroupCols,
        rowPath.map((v) => String(v ?? '')),
      );
      for (const valueColId of valueColIds) {
        const raw = row[valueColId];
        if (raw === undefined) continue;
        values.set(
          encodePivotValueKey(groupKey, PIVOT_ROW_TOTAL_PATH_MARKER, valueColId),
          raw,
        );
      }
    }
  }

  return { keyTree: roots, leafPaths, values };
}
