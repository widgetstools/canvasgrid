/**
 * Cycle 8 / Task 3 — `SortPass` was originally inline in
 * `worker/dataPipeline.ts`. Cycle 15 / Task 11 extracts it into this
 * file (mirroring the `aggPass.ts` / `groupPass.ts` layout) so the
 * group-aware sort path can live alongside the flat path without
 * inflating `dataPipeline.ts`.
 *
 * **Two entry points.**
 *
 *   - `apply(inputIds)` — the original flat path. Sorts a post-filter
 *     rowId list end-to-end under the current `SortModel`. Identical
 *     behaviour to pre-Task-11. Used when grouping is bypassed
 *     (`rowGroupCols.length === 0`).
 *
 *   - `applyGrouped(groupOutput, postFilterIds)` — Cycle 15 / Task 11.
 *     Sorts the post-`GroupPass` tree in place: within each leaf
 *     bucket's `childIndices` (positions into `postFilterIds`) under
 *     the sort model AND across each level's `childGroups` array.
 *     Rebuilds `flatOrder` from the freshly-sorted tree. Returns a
 *     NEW `GroupPassOutput` value; the input is treated as read-only
 *     so a future re-sort against the same `groupOutput` (e.g. a sort
 *     direction flip while grouping is unchanged) produces predictable
 *     results without a relayered build.
 *
 * **Group-level sort semantics.**
 *
 *   - The default is `GroupPass`'s composite-key sort — alphabetical
 *     by `colId:value::…` across levels. Cheap, deterministic, and
 *     matches the screenshot reference at `09-grouping-three-level-
 *     expanded.png` when nothing is configured.
 *   - When the active sort model targets one of the grouping columns,
 *     the level at that depth respects the direction (asc → composite
 *     key sort; desc → reversed). This mirrors ag-grid's behaviour
 *     where clicking the auto-group header inverts group ordering.
 *   - When the targeted level's column carries a registered
 *     `comparator`, that comparator runs over the group `.value` pair
 *     instead of the composite-key string compare. The default
 *     accented sort is honoured for text-typed group columns.
 *   - `sortGroupRowsByKey: true` on a column FORCES the composite-key
 *     compare for that level even when a `comparator` is registered.
 *     Useful when an app's value comparator is expensive (date parse,
 *     locale-aware string fold) and the cheap key string would order
 *     identically.
 *
 * **Perf gate (worklog).** 100 K post-filter rows, three group levels
 * (≈ 5 K leaf buckets after partitioning), sort under the active
 * model in ≤ 100 ms. Verified by `tests/groupSort.perf.test.ts`.
 */

import type { RowStore } from '../dataPipeline';
import type { WorkerColumn } from '../protocol';
import type { SortModel, SortModelEntry } from '../../types';
import type {
  FlatOrderEntry,
  GroupNode,
  GroupPassOutput,
} from './groupPass';
import { ComparatorRegistry, type ComparatorFn } from '../comparatorRegistry';
import { decodePivotResultColumnId } from '../../core/pivotColumns';
import { encodePivotValueKey, PIVOT_PATH_SEP, type PivotPassOutput } from './pivotPass';

interface ResolvedSortEntry {
  entry: SortModelEntry;
  col: WorkerColumn | undefined;
  /** Resolved row-level comparator: registered → built-in → accented. */
  fn?: ComparatorFn;
}

export class SortPass<TRow = any> {
  private model: SortModel = [];
  private colIndex = new Map<string, WorkerColumn>();
  private comparators: ComparatorRegistry;

  /** `comparators` is optional so existing callers (tests, demos) don't have
   *  to thread a registry through every construction. When omitted the
   *  pass behaves exactly as it did pre-Cycle 8 — every column uses the
   *  built-in text/number `compare()`. Cycle 8 / Task 3. */
  constructor(
    private store: RowStore<TRow>,
    columns: WorkerColumn[],
    comparators?: ComparatorRegistry,
  ) {
    this.setColumns(columns);
    this.comparators = comparators ?? new ComparatorRegistry();
  }

  setModel(model: SortModel): void { this.model = model; }

  setColumns(columns: WorkerColumn[]): void {
    this.colIndex.clear();
    for (const col of columns) this.colIndex.set(col.colId, col);
  }

  apply(inputIds: string[]): string[] {
    if (this.model.length === 0) return inputIds;
    const sorted = inputIds.slice();
    // Pre-resolve the comparator function per sort-model entry so we don't
    // re-walk the registry inside the hot N log N comparator. Unknown names
    // (registration race, dropped registration) fall back to the built-in
    // compare so the sort never crashes mid-pipeline.
    //
    // Cycle 8 / Task 5 — when a text column opts into `accentedSort`,
    // we hand the entry a cached `Intl.Collator.compare` so the hot loop
    // pays one virtual dispatch per cell instead of constructing the
    // collator per call. The collator stays in `accentedCollator` (lazy
    // singleton on the pass) so multiple accented columns share one.
    const resolved = this.resolveSortEntries();
    sorted.sort((aId, bId) => {
      const aRow = this.store.getById(aId);
      const bRow = this.store.getById(bId);
      if (!aRow || !bRow) return 0;
      for (const { entry, col, fn } of resolved) {
        if (!col || !col.field) continue;
        const av = (aRow as Record<string, unknown>)[col.field];
        const bv = (bRow as Record<string, unknown>)[col.field];
        const cmp = fn ? fn(av, bv) : compare(av, bv, col.type);
        if (cmp !== 0) return entry.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return sorted;
  }

  /**
   * Cycle 15 / Task 11 — group-aware sort.
   *
   * Sorts the freshly-built `groupOutput` tree in place: within each
   * leaf bucket the `childIndices` get a stable-by-input-index sort
   * under the current `SortModel`; across each level the `childGroups`
   * array gets re-sorted (default: by composite key — what `GroupPass`
   * already produced; per-level direction flip when the sort model
   * targets a grouping column; per-level comparator when the column
   * has one registered AND `sortGroupRowsByKey !== true`).
   *
   * Returns a NEW `GroupPassOutput` whose `flatOrder` reflects the
   * sorted shape. The input is treated as read-only: leaf
   * `childIndices` arrays and `childGroups` arrays are cloned before
   * mutation so an external reference into `groupOutput` (e.g. a
   * pending descendant-collection request) sees the pre-sort tree.
   *
   * Bypassed input (`bypassed: true` or empty roots) returns the same
   * `groupOutput` value unchanged — no allocation on the cheap path.
   *
   * `postFilterIds` is the rowId array fed into `GroupPass.apply`; the
   * `childIndices` are positions into it. Row-level lookups resolve
   * the rowId → row through this array and `store.getById`.
   */
  applyGrouped(
    groupOutput: GroupPassOutput,
    postFilterIds: readonly string[],
    /** Cycle 15 / Task 12 — flatOrder shape options. Mirror the
     *  GroupPass-level flags so the rebuilt flatOrder keeps the same
     *  contract (footer entries per non-elided group, optional
     *  grand-total footer at the end, elision of single-child funnels).
     *  Defaults match the pre-Task-12 behaviour so existing callers
     *  don't have to be updated. */
    options: {
      includeFooter?: boolean;
      includeTotalFooter?: boolean;
      removeSingleChildren?: boolean;
    } = {},
    /** Cycle 18 / Task 8d — pivot output for the current viewport. When
     *  supplied AND the sort model targets a pivot-result column, each
     *  group level is re-ordered by the corresponding pivot aggregate
     *  (looked up by `(groupKey × pivotPath × valueColId)`). Without
     *  this, pivot-result sort entries silently fall through and the
     *  level keeps the default composite-key order. */
    pivotOut?: PivotPassOutput,
  ): GroupPassOutput {
    if (groupOutput.bypassed || groupOutput.roots.length === 0) {
      return groupOutput;
    }
    const resolved = this.resolveSortEntries();
    // A clone walker — produces a fresh GroupNode subtree so the caller's
    // groupOutput stays untouched. Cheap because the tree's group count
    // (G) is small relative to total leaf rows (N): O(G) clones + the
    // existing O(N log N) within-bucket sort.
    const cloneNode = (node: GroupNode): GroupNode => ({
      key: node.key,
      value: node.value,
      depth: node.depth,
      colId: node.colId,
      childIndices: node.childIndices,
      childGroups: node.childGroups.map(cloneNode),
      childCount: node.childCount,
    });
    const roots = groupOutput.roots.map(cloneNode);

    // Within-bucket sort — only the leaf nodes (childGroups.length === 0)
    // carry indices into postFilterIds. Skip when the sort model is
    // empty: the GroupPass-produced childIndices already follow the
    // input order, which is what callers expect for a no-sort grouped
    // view.
    if (resolved.length > 0) {
      const sortLeaf = (node: GroupNode): void => {
        if (node.childGroups.length > 0) {
          for (const child of node.childGroups) sortLeaf(child);
          return;
        }
        const sortedIdx = this.sortLeafIndices(node.childIndices, postFilterIds, resolved);
        node.childIndices = sortedIdx;
      };
      for (const root of roots) sortLeaf(root);
    }

    // Group-level sort — apply per level. The model can have multiple
    // entries that target different grouping columns; each level inspects
    // its own colId against every entry (first match wins). When no
    // entry matches, the level keeps `GroupPass`'s composite-key sort.
    // Cycle 18 / Task 8d — also passes the pivot output so a pivot-
    // result sort entry can override the per-level grouping sort.
    this.sortGroupLevels(roots, resolved, pivotOut);

    // Rebuild flatOrder DFS — preserves the GroupPass contract: each
    // group entry rides at its node `depth`; row entries ride at
    // `rowDepth = depth-of-deepest-group + 1`. Task 12 — when the
    // upstream GroupPass had `includeFooter` on, the rebuilt flatOrder
    // re-emits footer entries per non-elided group so the slicer can
    // route them to footer chunk slots. Likewise the optional
    // grand-total footer (`includeTotalFooter`) and the elision rule
    // (`removeSingleChildren`) ride through.
    const flatOrder = rebuildFlatOrder(
      roots,
      options.includeFooter === true,
      options.includeTotalFooter === true,
      options.removeSingleChildren === true,
    );
    return { roots, flatOrder, bypassed: false };
  }

  /** Cycle 8 / Task 5 — lazy `Intl.Collator` adapter for `accentedSort`.
   *  The collator instance is constructed on first use and reused for the
   *  lifetime of the pass; the bound `compare` survives `Number`
   *  coercion of nullish values by stringifying first (matches the
   *  default `compare()` semantics). */
  private accentedCollator?: Intl.Collator;
  private accentedCompare = (a: unknown, b: unknown): number => {
    if (!this.accentedCollator) {
      this.accentedCollator = new Intl.Collator(undefined, { sensitivity: 'variant' });
    }
    return this.accentedCollator.compare(String(a ?? ''), String(b ?? ''));
  };

  /** Resolve each sort-model entry into a `{ entry, col, fn }` tuple so
   *  the hot loop doesn't re-walk the registry per cell pair. Shared
   *  between `apply` (flat) and `applyGrouped` (within-bucket). */
  private resolveSortEntries(): ResolvedSortEntry[] {
    return this.model.map((entry): ResolvedSortEntry => {
      const col = this.colIndex.get(entry.colId);
      let fn: ComparatorFn | undefined;
      if (col?.comparator) {
        fn = this.comparators.get(col.comparator);
      } else if (col?.accentedSort && col.type === 'text') {
        fn = this.accentedCompare;
      }
      return { entry, col, fn };
    });
  }

  /** Sort one leaf bucket's `childIndices` under the resolved model.
   *  Resolves each index → rowId → row + per-entry cell value ONCE
   *  up-front so the per-pair comparator stays a tight read against
   *  parallel value caches. For a 4 K-row bucket × O(N log N) sort
   *  this collapses ~50 K Map lookups + ~100 K property reads into
   *  ~4 K Map lookups + ~8 K property reads — measurably under the
   *  per-pass budget on the perf gate.
   *
   *  The cache is one Float64Array per NUMERIC sort entry (avoids the
   *  unbox cost on every compare) and one `unknown[]` per non-numeric
   *  entry. Sorts the `positions[]` array (slot index → original slot)
   *  so the value caches stay static during the sort. Returns a new
   *  `Uint32Array`; the input is not mutated. */
  private sortLeafIndices(
    indices: Uint32Array,
    postFilterIds: readonly string[],
    resolved: readonly ResolvedSortEntry[],
  ): Uint32Array {
    if (indices.length <= 1 || resolved.length === 0) return indices;
    const n = indices.length;
    const store = this.store;
    // Pre-resolve per-entry value caches. Numeric entries with no
    // custom fn use Float64Array (skips boxing); text + custom-fn
    // entries use `unknown[]` (the fn / compare reads the boxed
    // value directly). We pick the cache shape per entry up-front so
    // the sort loop branches on a single boolean per entry.
    const isNumericFast = new Array<boolean>(resolved.length);
    const numCaches = new Array<Float64Array | null>(resolved.length);
    const anyCaches = new Array<unknown[] | null>(resolved.length);
    const dirs = new Array<number>(resolved.length);
    for (let e = 0; e < resolved.length; e++) {
      const r = resolved[e]!;
      dirs[e] = r.entry.direction === 'asc' ? 1 : -1;
      if (r.col?.type === 'number' && !r.fn) {
        isNumericFast[e] = true;
        numCaches[e] = new Float64Array(n);
        anyCaches[e] = null;
      } else {
        isNumericFast[e] = false;
        numCaches[e] = null;
        anyCaches[e] = new Array<unknown>(n);
      }
    }
    for (let i = 0; i < n; i++) {
      const rowId = postFilterIds[indices[i]!];
      const row = rowId === undefined ? undefined : store.getById(rowId);
      const rowRec = row as Record<string, unknown> | undefined;
      for (let e = 0; e < resolved.length; e++) {
        const col = resolved[e]!.col;
        const v = col && col.field && rowRec ? rowRec[col.field] : undefined;
        if (isNumericFast[e]) {
          // NaN handling matches `compare()`: a non-numeric coerces
          // to NaN which sorts to the end (numerically + via the
          // explicit NaN guard in the comparator).
          numCaches[e]![i] = Number(v);
        } else {
          anyCaches[e]![i] = v;
        }
      }
    }
    const positions = new Array<number>(n);
    for (let i = 0; i < n; i++) positions[i] = i;
    positions.sort((a, b) => {
      for (let e = 0; e < resolved.length; e++) {
        if (isNumericFast[e]) {
          const cache = numCaches[e]!;
          const av = cache[a]!;
          const bv = cache[b]!;
          // Manual numeric compare (matches `compare()` semantics):
          // NaN trails finite values; equal values fall through to
          // the next entry.
          const aIsNaN = av !== av;  // self-ne NaN check (faster than Number.isNaN)
          const bIsNaN = bv !== bv;
          if (aIsNaN && bIsNaN) continue;
          if (aIsNaN) return dirs[e]!;
          if (bIsNaN) return -dirs[e]!;
          if (av < bv) return -dirs[e]!;
          if (av > bv) return  dirs[e]!;
          continue;
        }
        const r = resolved[e]!;
        if (!r.col || !r.col.field) continue;
        const av = anyCaches[e]![a];
        const bv = anyCaches[e]![b];
        const cmp = r.fn ? r.fn(av, bv) : compare(av, bv, r.col.type);
        if (cmp !== 0) return dirs[e]! * cmp;
      }
      return 0;
    });
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = indices[positions[i]!]!;
    return out;
  }

  /** Re-sort each level's `childGroups` per the resolved model.
   *
   *  Walks the tree post-order. At each level, if the model targets the
   *  level's `colId`:
   *    - default OR `sortGroupRowsByKey === true` → reverse the
   *      composite-key sort for `desc`; keep it as-is for `asc`
   *      (GroupPass already produced asc-by-key order).
   *    - column has a registered `comparator` AND
   *      `sortGroupRowsByKey !== true` → re-sort by group `.value`
   *      via the comparator, honouring direction.
   *    - column has `accentedSort` AND text type AND no comparator AND
   *      `sortGroupRowsByKey !== true` → re-sort by group `.value`
   *      via the accented collator.
   *  When no entry matches the level, leave the composite-key order. */
  private sortGroupLevels(
    nodes: GroupNode[],
    resolved: readonly ResolvedSortEntry[],
    pivotOut?: PivotPassOutput,
  ): void {
    if (nodes.length === 0) return;
    // Every node at the current `nodes` slot shares the same `colId` —
    // GroupPass partitions level-by-level — so it's safe to look the
    // model entry up once per call.
    const levelColId = nodes[0]!.colId;
    let levelEntry: ResolvedSortEntry | undefined;
    let pivotEntry: ResolvedSortEntry | undefined;
    for (const r of resolved) {
      if (r.entry.colId === levelColId && levelEntry === undefined) {
        levelEntry = r;
      }
      // Cycle 18 / Task 8d — capture any pivot-result entry. The first
      // one wins (matches the existing first-match-wins behaviour for
      // primary entries).
      if (pivotEntry === undefined && decodePivotResultColumnId(r.entry.colId) !== null) {
        pivotEntry = r;
      }
    }
    // Cycle 18 / Task 8d — a pivot-result sort entry takes precedence
    // over the level's primary entry. The user clicked a synthesized
    // pivot column header; that's their explicit intent for the row
    // group order.
    if (pivotEntry !== undefined && pivotOut !== undefined && !pivotOut.bypassed) {
      this.reorderGroupLevelByPivot(nodes, pivotEntry, pivotOut);
    } else if (levelEntry !== undefined) {
      this.reorderGroupLevel(nodes, levelEntry);
    }
    for (const node of nodes) {
      if (node.childGroups.length > 0) {
        this.sortGroupLevels(node.childGroups, resolved, pivotOut);
      }
    }
  }

  /** Cycle 18 / Task 8d — sort child groups by the pivot aggregate at
   *  `(node.key × pivotPath × valueColId)`. The decoded path comes
   *  straight from the synthesized colId via `decodePivotResultColumnId`.
   *  `undefined` aggregates (no rows match the intersection) sort to
   *  the end on `asc`, to the front on `desc` — matching the
   *  null-handling the flat `compare()` already uses. */
  private reorderGroupLevelByPivot(
    nodes: GroupNode[],
    resolved: ResolvedSortEntry,
    pivotOut: PivotPassOutput,
  ): void {
    const decoded = decodePivotResultColumnId(resolved.entry.colId);
    if (decoded === null) return;
    const { pivotPath, valueColId } = decoded;
    const joinedPath = pivotPath.join(PIVOT_PATH_SEP);
    const dir = resolved.entry.direction === 'asc' ? 1 : -1;
    const valueOf = (key: string): unknown =>
      pivotOut.values.get(encodePivotValueKey(key, joinedPath, valueColId));
    nodes.sort((a, b) => {
      const av = valueOf(a.key);
      const bv = valueOf(b.key);
      // Push undefined / null entries to the end on asc (start on desc).
      const aMissing = av === undefined || av === null;
      const bMissing = bv === undefined || bv === null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return  1;
      if (bMissing) return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
      if (Number.isNaN(an)) return  1;
      if (Number.isNaN(bn)) return -1;
      return dir * (an < bn ? -1 : an > bn ? 1 : 0);
    });
  }

  /** Apply the level entry to a single `childGroups` array. Sorts in
   *  place (the array was cloned at the top of `applyGrouped`). */
  private reorderGroupLevel(nodes: GroupNode[], resolved: ResolvedSortEntry): void {
    const { entry, col, fn } = resolved;
    const dir = entry.direction === 'asc' ? 1 : -1;
    // When `sortGroupRowsByKey` is explicitly on, OR when no value-aware
    // function is available, sort by the composite key string (cheap,
    // already what GroupPass built — just flip direction).
    const byKey = col?.sortGroupRowsByKey === true || (fn === undefined && col?.accentedSort !== true);
    if (byKey) {
      // GroupPass already produced asc-by-key order. Reverse for desc;
      // re-sort defensively for asc (the input is the unsorted clone of
      // GroupPass output, which is asc — re-sort is a no-op but stable).
      if (dir === 1) {
        nodes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      } else {
        nodes.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
      }
      return;
    }
    // Value-aware: use the resolved fn (registered comparator) when
    // present; otherwise fall back to the accented collator (text
    // columns with `accentedSort`).
    const cmpFn: ComparatorFn = fn ?? this.accentedCompare;
    nodes.sort((a, b) => dir * cmpFn(a.value, b.value));
  }
}

/** Default value compare for ungrouped rows (`number` or `text` columns).
 *  `null` / `undefined` always trail valid values; `NaN` always trails
 *  numeric values. Kept module-local so the existing pre-Task-11
 *  semantics stay byte-identical. */
function compare(a: unknown, b: unknown, type: 'text' | 'number'): number {
  if (type === 'number') {
    const an = Number(a), bn = Number(b);
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return  1;
    if (Number.isNaN(bn)) return -1;
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  const as = String(a ?? '');
  const bs = String(b ?? '');
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Walk the (just-sorted) tree DFS, emitting each group node followed
 *  by its descendants. Mirrors `GroupPass.apply`'s flatOrder contract:
 *  every group rides at its node `depth`, every row rides at one
 *  deeper than the deepest group (so the slicer's depth comparison
 *  cleanly skips a collapsed group's whole subtree). Module-scope so
 *  the cycle 15 / task 11 perf test can exercise the standalone walk
 *  if a regression triggers. */
function rebuildFlatOrder(
  roots: readonly GroupNode[],
  includeFooter: boolean = false,
  includeTotalFooter: boolean = false,
  removeSingleChildren: boolean = false,
): FlatOrderEntry[] {
  const flatOrder: FlatOrderEntry[] = [];
  let maxGroupDepth = -1;
  const seedMax = (nodes: readonly GroupNode[]): void => {
    for (const n of nodes) {
      if (n.depth > maxGroupDepth) maxGroupDepth = n.depth;
      if (n.childGroups.length > 0) seedMax(n.childGroups);
    }
  };
  seedMax(roots);
  const rowDepth = maxGroupDepth + 1;
  const walk = (nodes: readonly GroupNode[]): void => {
    for (const n of nodes) {
      const skipGroupEntry = removeSingleChildren && n.childCount === 1;
      if (!skipGroupEntry) {
        flatOrder.push({ kind: 'group', key: n.key, depth: n.depth });
      }
      if (n.childGroups.length > 0) {
        walk(n.childGroups);
      } else {
        const idxs = n.childIndices;
        for (let i = 0; i < idxs.length; i++) {
          flatOrder.push({ kind: 'row', rowIndex: idxs[i]!, depth: rowDepth });
        }
      }
      // Cycle 15 / Task 12 — per-group footer entry. Mirrors the
      // GroupPass.apply walk: skipped when the group was elided AND
      // when includeFooter is off. The footer's depth is one deeper
      // than the parent group's so the slicer's skip-depth logic
      // drops it on collapse without any special handling.
      if (includeFooter && !skipGroupEntry) {
        flatOrder.push({ kind: 'footer', key: n.key, depth: n.depth + 1 });
      }
    }
  };
  walk(roots);
  if (includeFooter && includeTotalFooter && roots.length > 0) {
    flatOrder.push({ kind: 'footer', key: '', depth: 0 });
  }
  return flatOrder;
}
