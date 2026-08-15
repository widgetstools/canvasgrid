/**
 * Cycle 15 / Task 1 — `GroupPass` builds the hierarchical row-grouping
 * tree off the worker's post-filter row set.
 *
 * **Pipeline slot.** GroupPass runs AFTER `FilterPass` (+ quick-filter,
 * external filter, alwaysPass merge) and BEFORE `SortPass`. It consumes
 * the surviving rowIds and produces:
 *   - `roots: GroupNode[]` — the tree partitioned by `rowGroupCols`
 *   - `flatOrder` — depth-first flattening (group entries interleaved
 *     with their descendant row indices) that `ViewportSlicer` (Task 2)
 *     walks honouring `expandedKeys`
 *   - `bypassed: boolean` — `true` when `rowGroupCols.length === 0`, the
 *     fast path that skips every allocation; downstream consumers
 *     short-circuit too.
 *
 * **Implementation.** Single O(N) walk: for every input row we descend
 * `cols.length` levels of the partially-built tree, hashing by the
 * stringified group-column value at each level. Bucket maps are kept
 * alongside the public `GroupNode` so the per-row insertion is O(1)
 * per level — no per-row Map.get into a global hash. After the rows
 * are placed we sort each level's children by composite key (so the
 * tree's flat ordering is deterministic regardless of input order)
 * and convert leaf `number[]` buckets to `Uint32Array`s. Total cost
 * is O(N × depth + G log G) where G is the number of group nodes.
 *
 * **Composite key format.** Per-level: `${colId}:${stringValue}`. Nested
 * keys join levels with `::` — `desk:APAC::region:Rates`. The key is
 * the lookup vocabulary for `expandedKeys: Set<string>` (Task 6) so a
 * client can address any node uniquely. `String(null ?? '')` collapses
 * nullish values to `''`; the canonical "(Blanks)" handling is a
 * follow-up cycle (ag-grid's `groupAllowUnbalanced`).
 *
 * **Separator escaping (Task 4 / A-C7).** `colId` and the stringified
 * value are each run through `escapeGroupKeySegment` (`core/ssrmRowMeta`)
 * before concatenation, so a value containing `:` or `::` can never be
 * misread as the colId/value separator or a level boundary — see that
 * module for the exact scheme. Only called when a NEW bucket is created
 * (never per-row), preserving the hot-path perf characteristic below.
 *
 * **Validation.** `setModel` rejects unknown colIds and duplicate
 * colIds (the closest analogue to ag-grid's "circular groupOrder")
 * with a clear Error so the worker fails loudly instead of silently
 * producing a malformed tree.
 *
 * **No module-level state.** Mutable state lives on the instance
 * (`model`, `colIndex`), not module globals. `apply` is pure given the
 * current state — calling it twice with the same input produces the
 * same output.
 */

import type { RowStore } from '../dataPipeline';
import type { WorkerColumn } from '../protocol';
import { escapeGroupKeySegment } from '../../core/ssrmRowMeta';
import type { GroupModel } from '../../types';
import type { CalcValueSource } from './calcPass';

export interface GroupNode {
  /** Stable composite key — `${colId}:${value}` per level (each segment
   *  escaped via `escapeGroupKeySegment`), joined by `::` for nested
   *  levels. The vocabulary `expandedKeys` looks up; use `splitGroupKey`
   *  / `parseCompositeGroupKey` to decompose, never a raw `.split`. */
  key: string;
  /** The raw value of the grouping cell (pre-stringify). Null/undefined
   *  round-trip as-is so a renderer can decide how to format them. */
  value: unknown;
  /** Depth in the tree, 0 = root group, increasing inward. */
  depth: number;
  /** Source column id that this group level partitions by. */
  colId: string;
  /** For a LEAF node (depth === rowGroupCols.length - 1): indices into
   *  the post-filter row set that fall in this bucket. For a non-leaf
   *  node: empty (the indices live at the leaves). */
  childIndices: Uint32Array;
  /** Nested groups one depth deeper. Empty at leaf depth. */
  childGroups: GroupNode[];
  /** Total descendant LEAF rows under this node (recursive). */
  childCount: number;
}

export type FlatOrderEntry =
  | { kind: 'group'; key: string; depth: number }
  | { kind: 'row'; rowIndex: number; depth: number }
  /** Cycle 15 / Task 12 — per-group footer row marker. Emitted at the
   *  END of a group's child traversal when `includeFooter` is on (and
   *  the group hasn't been elided by `removeSingleChildren`). `key` is
   *  the parent group's composite key — the same key `chunk.groupKey[i]`
   *  carries on the footer row so main can look up the per-group totals.
   *  `depth = parent.depth + 1` so the slicer's skip-depth logic drops
   *  the footer entry alongside the group's descendants on collapse
   *  (the parent group at `depth = D` collapses → skipDepth = D →
   *  entries with `depth > D` skip → footer skips). Also enables a
   *  grand-total footer (depth = 0, key = '') at the very end of
   *  `flatOrder` when `includeTotalFooter` is on — it sits OUTSIDE any
   *  group's collapsible scope so the skip-depth logic never drops it. */
  | { kind: 'footer'; key: string; depth: number };

export interface GroupPassOutput {
  /** Root group nodes (one per top-level distinct value). */
  roots: GroupNode[];
  /** Depth-first flattening: each group node is emitted, then its
   *  descendant rows (leaves) or recursive child groups. Rows carry
   *  `depth = rowGroupCols.length` — one deeper than the deepest group
   *  — so a slicer can use depth comparisons to find "next sibling at
   *  the same or shallower depth" when honouring `expandedKeys`. */
  flatOrder: FlatOrderEntry[];
  /** `true` when `rowGroupCols.length === 0`. Downstream consumers
   *  (slicer, sort, renderers) skip the group pipeline entirely. */
  bypassed: boolean;
}

interface BuildBucket {
  node: GroupNode;
  /** Live child lookup during the single-pass build. Discarded after
   *  the tree is finalised — only `node.childGroups` is part of the
   *  public output. */
  childByKey: Map<string, BuildBucket>;
  /** Leaf-only mutable list, transferred into `node.childIndices` as
   *  a `Uint32Array` once the build is complete. `null` for non-leaf. */
  leafIndices: number[] | null;
}

export class GroupPass<TRow = any> {
  private model: GroupModel = { rowGroupCols: [] };
  private colIndex = new Map<string, WorkerColumn>();
  /** Cycle 15 / Task 9 — default-expansion rule. `'all'` is the
   *  "every group expanded" sentinel (the pre-Task-9 behaviour); any
   *  non-negative number `N` expands groups whose `depth <= N`; a
   *  negative number collapses everything. Read by
   *  `computeDefaultExpandedKeys(roots)` on every model swap. */
  private defaultExpanded: number | 'all' = 'all';
  /** Cycle 15 / Task 9 — explicit composite-key list. When non-null
   *  (including the empty array — the canonical "collapse all"
   *  override), takes precedence over `defaultExpanded`. */
  private defaultExpandedKeys: readonly string[] | null = null;
  /** Cycle 15 / Task 10 — `groupRemoveSingleChildren` flag. When `true`,
   *  the flatOrder build skips group entries whose recursive
   *  `childCount === 1` — chains that funnel down to a single leaf row
   *  collapse away entirely (the lone row is emitted at its natural
   *  position with no preceding group entries). The TREE shape stays
   *  intact so the `groupMeta` lookup keeps working for every
   *  non-elided group; only the depth-first flat traversal changes.
   *  Off by default; read by `apply()` on every call. `'leafGroupsOnly'`
   *  restricts elision to leaf-level groups (AG v33
   *  `groupHideParentOfSingleChild: 'leafGroupsOnly'`). */
  private removeSingleChildren: boolean | 'leafGroupsOnly' = false;
  /** Cycle 15 / Task 12 — `groupIncludeFooter` flag. When `true`, the
   *  flatOrder build appends a `kind: 'footer'` entry at the END of
   *  each non-elided group's child traversal. The footer's `key` is
   *  the parent group's composite key; the slicer reads the same key
   *  back via `chunk.groupKey[i]` and main looks up per-group totals
   *  by it. Footers carry `depth = parent.depth + 1` so the existing
   *  skip-depth logic drops them naturally on collapse. Off by default. */
  private includeFooter = false;
  /** Cycle 15 / Task 12 — `groupIncludeTotalFooter` flag. When `true`
   *  AND `includeFooter` is true (the flag is meaningless on its own —
   *  it ADDS the grand-total row to the per-group footers' visual
   *  rhythm), `apply()` appends ONE final footer entry at the very end
   *  of `flatOrder` with `key: ''` and `depth: 0`. Sits outside any
   *  group's collapsible scope so it never drops on collapse. Off by
   *  default. */
  private includeTotalFooter = false;
  /** Cycle 15.5 / Task 6 — per-node expansion callback. When set, called
   *  for every group node in `computeDefaultExpandedKeys`; returning
   *  `true` marks the group open by default. Takes priority over
   *  `defaultExpanded` / `defaultExpandedKeys` when set. Cannot be
   *  threaded through the worker postMessage interface — set by unit tests
   *  directly; runtime evaluation runs on the main thread via
   *  `velocityGrid.ts`'s `applyIsGroupOpenByDefault`. */
  private isGroupOpenByDefaultCb:
    | ((params: { key: string; route: string[] }) => boolean)
    | null = null;
  /** Cycle 21d / Task 11 — CalcPass Stage A/B value seam. `null` when no
   *  calc program is installed — the guard at the bucket-key read is a
   *  null check, not a function call, so the hot build loop pays
   *  nothing on the common no-calc path. */
  private calcSource: CalcValueSource | null = null;

  constructor(private store: RowStore<TRow>, columns: WorkerColumn[]) {
    this.setColumns(columns);
  }

  /** Install (or clear, via `null`) the calc-column value source. */
  setCalcSource(src: CalcValueSource | null): void { this.calcSource = src; }

  /** Replace the group model. Validates colIds against the current
   *  column metadata and rejects duplicates so a malformed model is
   *  caught at the set-site (not deep inside `apply`). */
  setModel(model: GroupModel): void {
    const cols = model.rowGroupCols;
    if (cols.length > 0) {
      const seen = new Set<string>();
      for (const colId of cols) {
        if (!this.colIndex.has(colId)) {
          throw new Error(`[velocity-grid] GroupPass: unknown column id '${colId}' in rowGroupCols`);
        }
        if (seen.has(colId)) {
          throw new Error(
            `[velocity-grid] GroupPass: duplicate column id '${colId}' in rowGroupCols (circular group order)`,
          );
        }
        seen.add(colId);
      }
    }
    this.model = { rowGroupCols: cols.slice() };
  }

  /** Swap column metadata in place. Preserves the current model — the
   *  caller (worker.ts `updateColumns`) is responsible for re-validating
   *  after a column swap if `rowGroupCols` referenced a removed column. */
  setColumns(columns: WorkerColumn[]): void {
    this.colIndex.clear();
    for (const col of columns) this.colIndex.set(col.colId, col);
    // AG `keyCreator` — rebuild per-column functions from their serialized
    // source (same `new Function` contract as comparators / aggFuncs).
    // Compiled once per (colId, source); a bad source logs and disables
    // the creator for that column instead of poisoning the pipeline.
    for (const col of columns) {
      const src = col.keyCreatorSource;
      const cached = this.keyCreatorSrc.get(col.colId);
      if (src === cached) continue;
      this.keyCreatorSrc.set(col.colId, src);
      if (!src) {
        this.keyCreators.delete(col.colId);
        continue;
      }
      try {
        const fn = new Function(`"use strict"; return (${src});`)();
        if (typeof fn === 'function') {
          this.keyCreators.set(col.colId, fn as (p: { value: unknown; data: unknown }) => unknown);
        } else {
          this.keyCreators.delete(col.colId);
        }
      } catch (err) {
        console.error(`[velocity-grid] keyCreator for '${col.colId}' failed to deserialise:`, err);
        this.keyCreators.delete(col.colId);
      }
    }
  }

  /** Compiled `keyCreator` functions by colId (+ source cache for change
   *  detection across `setColumns` swaps). */
  private readonly keyCreators = new Map<string, (p: { value: unknown; data: unknown }) => unknown>();
  private readonly keyCreatorSrc = new Map<string, string | undefined>();

  /** Read-only access for tests + the slicer. */
  getModel(): GroupModel {
    return { rowGroupCols: this.model.rowGroupCols.slice() };
  }

  /** Cycle 15 / Task 9 — install the default-expansion rule. Called
   *  on worker init from the `groupDefaultExpanded` /
   *  `groupDefaultExpandedKeys` payload fields; callers pass
   *  `expanded: undefined` to revert to the all-expanded sentinel
   *  and `keys: undefined` to clear the explicit override.
   *
   *  `keys` (when supplied) is stored as a frozen-shape internal
   *  slice so a downstream mutation on the caller's array can't
   *  silently rewrite the next default. */
  setDefaultExpansion(opts: {
    expanded?: number | 'all';
    keys?: readonly string[];
  }): void {
    this.defaultExpanded = opts.expanded ?? 'all';
    this.defaultExpandedKeys = opts.keys === undefined ? null : opts.keys.slice();
  }

  /** Cycle 15 / Task 10 — toggle the single-child elision rule. Called
   *  from the worker init handshake when `groupRemoveSingleChildren` /
   *  `groupHideParentOfSingleChild` is set on `VelocityGridOptions`. Off by
   *  default; `'leafGroupsOnly'` (AG v33
   *  `groupHideParentOfSingleChild: 'leafGroupsOnly'`) elides only
   *  LEAF-level single-child groups, leaving higher levels intact.
   *  Takes effect on the next `apply()`. */
  setRemoveSingleChildren(enabled: boolean | 'leafGroupsOnly'): void {
    this.removeSingleChildren = enabled;
  }

  /** Cycle 15 / Task 10 — read-only access to the elision flag. Used
   *  by the slicer + tests that need to mirror the elision rule on the
   *  main thread (e.g. when threading `showOpenedGroup` data through
   *  the chunk — an elided row's parent group's value should be the
   *  highest non-elided ancestor's value, matching what the renderer
   *  paints). */
  getRemoveSingleChildren(): boolean | 'leafGroupsOnly' {
    return this.removeSingleChildren;
  }

  /** Cycle 15 / Task 12 — toggle per-group footer emission + the
   *  grand-total footer companion. Both default off. Flipping
   *  `includeFooter` on means every non-elided group's traversal ends
   *  with a `kind: 'footer'` entry; `includeTotalFooter` additionally
   *  appends a single grand-total footer at the very end (empty key,
   *  depth 0). `includeTotalFooter` with `includeFooter: false` is a
   *  no-op — the flag is meaningful only as a companion to per-group
   *  footers (apps that want just a grand total use
   *  `totalsRowPosition: 'bottom'` instead). */
  setIncludeFooter(includeFooter: boolean, includeTotalFooter: boolean): void {
    this.includeFooter = includeFooter;
    this.includeTotalFooter = includeTotalFooter;
  }

  /** Cycle 15.5 / Task 6 — install the per-node open-by-default callback.
   *  Pass `null` to clear. Has no effect in the worker (functions cannot
   *  cross the postMessage boundary); used by unit tests and main-thread
   *  evaluation in `velocityGrid.ts`. */
  setIsGroupOpenByDefault(
    cb: ((params: { key: string; route: string[] }) => boolean) | null,
  ): void {
    this.isGroupOpenByDefaultCb = cb;
  }

  /** Cycle 15 / Task 12 — read-only access. Used by `worker.ts` to
   *  decide whether to compute per-group totals during the agg pass. */
  getIncludeFooter(): boolean {
    return this.includeFooter;
  }
  getIncludeTotalFooter(): boolean {
    return this.includeTotalFooter;
  }

  /** Cycle 15 / Task 9 — compute the starting `expandedKeys` set for
   *  the supplied roots under the current default rule.
   *
   *  Resolution order:
   *    1. `defaultExpandedKeys !== null` → explicit list wins; return
   *       a fresh `Set` of those keys. Stale keys (not present in
   *       `roots`) ride along unchanged — the slicer ignores keys
   *       that don't match any group, so a stale entry is harmless.
   *    2. `defaultExpanded === 'all'` (or option absent) → return
   *       `null`, the sentinel that maps to "every group expanded".
   *       The worker stores `state.expandedKeys = null` so
   *       `effectiveExpandedKeys()` derives the all-keys set on
   *       demand; this keeps the cheap-default path allocation-free.
   *    3. `defaultExpanded` is a non-negative number `N` → walk the
   *       tree, include every group whose `depth <= N`.
   *    4. `defaultExpanded` is a negative number → return an empty
   *       `Set`. The set is non-null so the slicer treats it as an
   *       explicit "no groups expanded" set instead of the
   *       all-expanded sentinel. */
  computeDefaultExpandedKeys(roots: readonly GroupNode[]): Set<string> | null {
    // Cycle 15.5 / Task 6 — `isGroupOpenByDefault` callback takes priority.
    // Walk the tree and include every node for which the callback returns true.
    // The route (ancestor value chain) is threaded down the walk.
    if (this.isGroupOpenByDefaultCb !== null) {
      const cb = this.isGroupOpenByDefaultCb;
      const set = new Set<string>();
      const walk = (nodes: readonly GroupNode[], route: string[]): void => {
        for (const node of nodes) {
          const nodeRoute = [...route, String(node.value ?? '')];
          if (cb({ key: node.key, route: nodeRoute })) set.add(node.key);
          if (node.childGroups.length > 0) walk(node.childGroups, nodeRoute);
        }
      };
      walk(roots, []);
      return set;
    }
    if (this.defaultExpandedKeys !== null) {
      return new Set(this.defaultExpandedKeys);
    }
    const expanded = this.defaultExpanded;
    // AG parity (2026-07-21): `-1` (or 'all') expands EVERYTHING; `N >= 0`
    // is the NUMBER OF LEVELS open — `0` opens nothing, `1` opens the
    // first level (depth 0), etc. (cgrid previously used depth <= N,
    // off-by-one from ag-grid). Other negatives collapse everything.
    if (expanded === 'all' || expanded === -1) return null;
    const set = new Set<string>();
    if (expanded <= 0) return set;
    const openLevels = expanded;
    const walk = (nodes: readonly GroupNode[]): void => {
      for (const node of nodes) {
        if (node.depth < openLevels) set.add(node.key);
        if (node.childGroups.length > 0) walk(node.childGroups);
      }
    };
    walk(roots);
    return set;
  }

  /** Build the group tree off `inputIds`. The bypass branch allocates
   *  nothing — the empty-model fast path is free. */
  apply(inputIds: readonly string[]): GroupPassOutput {
    const cols = this.model.rowGroupCols;
    if (cols.length === 0) {
      return { roots: [], flatOrder: [], bypassed: true };
    }

    // Pre-resolve column → field once. A grouping column without a
    // `field` (synthesised column?) still produces a single "" bucket
    // for every row at that level — defensive, matches how the
    // viewport slicer / value-getter chain treats missing fields.
    const fields = new Array<string | null>(cols.length);
    const colIds = cols;
    // AG `keyCreator` — per-level compiled creator (null = raw value key).
    const creators = new Array<((p: { value: unknown; data: unknown }) => unknown) | null>(cols.length);
    for (let d = 0; d < cols.length; d++) {
      fields[d] = this.colIndex.get(cols[d]!)?.field ?? null;
      creators[d] = this.keyCreators.get(cols[d]!) ?? null;
    }

    const deepest = cols.length - 1;
    // Synthetic root bucket — never emitted in the output; it just
    // anchors the level-0 `childByKey` map during the build.
    const root: BuildBucket = {
      node: {
        key: '',
        value: null,
        depth: -1,
        colId: '',
        childIndices: new Uint32Array(0),
        childGroups: [],
        childCount: 0,
      },
      childByKey: new Map(),
      leafIndices: null,
    };

    // Hot path. Two perf-critical shapes:
    //   (a) `childByKey` is keyed by the per-level stringified value
    //       (e.g. `'APAC'`), NOT by the full composite key. Per-row
    //       key construction (string concat) happens ONLY when a new
    //       bucket is created — for a 1 M-row × 3-col tree with ~450
    //       distinct leaf buckets, that's ~450 concats instead of 3 M.
    //   (b) The numeric→string coercion uses `'' + raw` (faster than
    //       `String(raw)` for the primitive case under V8 — saves the
    //       function-call dispatch in the tight loop).
    //
    // Three small per-level Map.gets (~5-char keys) measured faster
    // than one large per-row Map.get (~30-char joined key) on V8 —
    // tiny maps with short keys are the sweet spot for `Map.get`.
    const colCount = cols.length;
    for (let i = 0; i < inputIds.length; i++) {
      const rowId = inputIds[i]!;
      const row = this.store.getById(rowId);
      if (row === undefined) continue;

      let parent: BuildBucket = root;
      for (let d = 0; d < colCount; d++) {
        const field = fields[d]!;
        const colId = colIds[d]!;
        // Cycle 21d / Task 11 — data column → direct field read;
        // fieldless calc column → CalcPass cache; fieldless non-calc
        // column → `undefined` (pre-21d "" bucket for every row).
        let rawValue = field !== null
          ? (row as Record<string, unknown>)[field]
          : (this.calcSource !== null && this.calcSource.isCalcCol(colId)
              ? this.calcSource.valueAt(rowId, colId)
              : undefined);
        // AG `keyCreator` — the creator's return IS the group key (and the
        // displayed group value), enabling grouping over objects / derived
        // buckets. Creator throw → '' bucket (defensive, matches nulls).
        const creator = creators[d] ?? null;
        if (creator !== null) {
          try {
            rawValue = creator({ value: rawValue, data: row });
          } catch {
            rawValue = null;
          }
        }
        const keyPart = rawValue == null ? '' : '' + rawValue;
        const parentMap = parent.childByKey;
        let bucket = parentMap.get(keyPart);
        if (bucket === undefined) {
          const parentKey = parent.node.key;
          // Task 4 (A-C7) — escape only on bucket CREATION (not per-row),
          // preserving the hot-path perf note above.
          const escapedSeg = escapeGroupKeySegment(colId) + ':' + escapeGroupKeySegment(keyPart);
          const myKey = parentKey === ''
            ? escapedSeg
            : parentKey + '::' + escapedSeg;
          const isLeafLevel = d === deepest;
          const node: GroupNode = {
            key: myKey,
            value: rawValue,
            depth: d,
            colId,
            childIndices: new Uint32Array(0),
            childGroups: [],
            childCount: 0,
          };
          bucket = {
            node,
            childByKey: new Map(),
            leafIndices: isLeafLevel ? [] : null,
          };
          parentMap.set(keyPart, bucket);
          parent.node.childGroups.push(node);
        }
        if (d === deepest) {
          bucket.leafIndices!.push(i);
        }
        parent = bucket;
      }
    }

    // Post-process: typed-array conversion + childCount rollup. We
    // PRESERVE data-insertion order for sibling groups (AG-parity:
    // a group's position is determined by the order its first leaf
    // appeared). The SortPass downstream re-sorts when the user has
    // an explicit sort on the row-group column; until then, insertion
    // order is the deterministic default.
    const finalise = (bucket: BuildBucket): number => {
      const node = bucket.node;
      if (bucket.leafIndices !== null) {
        // Leaf — materialise indices into a Uint32Array and report the
        // count back up so the parent can roll it into childCount.
        node.childIndices = Uint32Array.from(bucket.leafIndices);
        node.childCount = bucket.leafIndices.length;
        return node.childCount;
      }
      let total = 0;
      for (const childBucket of bucket.childByKey.values()) {
        total += finalise(childBucket);
      }
      node.childCount = total;
      return total;
    };

    for (const childBucket of root.childByKey.values()) {
      finalise(childBucket);
    }
    const roots = root.node.childGroups;

    // Build the depth-first flat ordering. Rows ride one depth deeper
    // than the deepest group so the slicer can use a depth comparison
    // to find the next sibling at the collapsed group's depth.
    //
    // Cycle 15 / Task 10 — when `removeSingleChildren` is on, a group
    // with `childCount === 1` (only one descendant leaf in its subtree)
    // is ELIDED from the traversal: we skip its `kind: 'group'` entry,
    // recurse into its children regardless, and the lone leaf row gets
    // emitted at its natural depth without a preceding group entry.
    // The tree itself stays intact so the meta lookup still resolves
    // every key — only the flat traversal changes. A chain of
    // single-child groups (e.g. APAC → Rates → Swap → one row) all
    // elide together because every level satisfies `childCount === 1`.
    const flatOrder: FlatOrderEntry[] = [];
    const rowDepth = cols.length;
    const elide = this.removeSingleChildren;
    const footers = this.includeFooter;
    const walk = (nodes: readonly GroupNode[]): void => {
      for (const n of nodes) {
        // 'leafGroupsOnly' elides only leaf-level single-child groups
        // (childGroups empty); `true` elides at every level.
        const skipGroupEntry = n.childCount === 1 && (
          elide === true || (elide === 'leafGroupsOnly' && n.childGroups.length === 0)
        );
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
        // Cycle 15 / Task 12 — per-group footer entry. Skipped when
        // the group itself was elided (a single-child funnel doesn't
        // earn a footer — the lone child IS the only value) AND when
        // `includeFooter` is off. The footer's depth is one deeper
        // than the parent group's so the slicer's skip-depth logic
        // drops it on collapse without any special handling.
        if (footers && !skipGroupEntry) {
          flatOrder.push({ kind: 'footer', key: n.key, depth: n.depth + 1 });
        }
      }
    };
    walk(roots);

    // Cycle 15 / Task 12 — grand-total footer entry. Sits OUTSIDE any
    // group's collapsible scope (depth 0 is never > any group's
    // skip-depth) so it always emits. Empty key signals "this is the
    // grand total, not a per-group footer" — main resolves the lookup
    // through `chunk.totals` (same path the standard TotalsSubgrid
    // uses) instead of `chunk.groupTotals[key]`.
    if (footers && this.includeTotalFooter && roots.length > 0) {
      flatOrder.push({ kind: 'footer', key: '', depth: 0 });
    }

    return { roots, flatOrder, bypassed: false };
  }
}

function byKey(a: GroupNode, b: GroupNode): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
